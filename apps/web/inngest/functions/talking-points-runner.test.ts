// @vitest-environment node

import {
  chapters,
  createCase,
  createChannel,
  createProjectFromCase,
  FIXTURE_PROJECT_ID,
  getProject,
  insertTalkingPointSet,
  latestTalkingPointSet,
  listProjectNotices,
  notices,
  requireTestDatabase,
  scripts,
  seed,
  talkingPointSets,
  truncateRunMirror,
} from '@boom-busters/db'
import { mockTalkingPoints } from '@boom-busters/providers'
import {
  BudgetExceededError,
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  noticesFor,
  talkingPointSetIssues,
} from '@boom-busters/schemas'
import type { TalkingPoint } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FROZEN_BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { talkingPointsRunner } from './talking-points-runner'

/**
 * The talking-points-runner against the real database (design 3.2 and 3.5):
 * a proposal, the redo of one point and an added point each land as a new
 * version of the set and park the Shorts stage at the points review.
 */

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CHAPTER_IDS = [
  '01HQ0000000000000000000CH1',
  '01HQ0000000000000000000CH2',
  '01HQ0000000000000000000CH3',
]
const CHAPTER_ROWS = CHAPTER_IDS.map((id, index) => ({
  id,
  index,
  title: `Chapter ${index + 1}`,
  contentMd: `Narration of chapter ${index + 1}.\n\nA second paragraph.`,
}))

const eventFor = (
  data: Record<string, unknown>,
): [{ name: string; data: Record<string, unknown> }] => [
  { name: 'shorts/points.requested', data: { projectId: FIXTURE_PROJECT_ID, ...data } },
]

/** A project frozen to an empty bible, on its own channel. */
async function blankProject(): Promise<string> {
  const channel = await createChannel(db, {
    name: 'Blank channel',
    handle: null,
    slug: `blank-${Math.random().toString(36).slice(2, 8)}`,
    settings: DEFAULT_SETTINGS,
    bible: EMPTY_BIBLE,
  })
  const kase = await createCase(db, { channelId: channel.id, title: 'T', category: 'collapse' })
  return (await createProjectFromCase(db, { caseId: kase.id, title: 'T' })).id
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** A stored set built from the mock proposal, so a redo has something to replace. */
async function storeMockSet(count = 3): Promise<TalkingPoint[]> {
  const drafts = mockTalkingPoints(CHAPTER_ROWS)
  const types = ['forensic-breakdown', 'contrarian-thesis', 'result-first'] as const
  const points: TalkingPoint[] = Array.from({ length: count }, (_, i) => ({
    ...drafts[i % 3]!,
    id: `01HQ0000000000000000000P0${i + 1}`,
    question: `Stored question number ${i + 1}: what happened?`,
    // Spread the lead chapters so five points still pass the two-per-chapter rule.
    sourceChapters: [i % 3],
    type: types[i % 3]!,
    order: i + 1,
  }))
  await insertTalkingPointSet(db, {
    projectId: FIXTURE_PROJECT_ID,
    scriptVersion: 1,
    points,
    note: null,
  })
  return points
}

describeDb('talking-points-runner', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: talkingPointsRunner })
    vi.clearAllMocks()
    callLlm.mockReset()
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(notices)
    await db.delete(talkingPointSets)
    await db.delete(scripts)
    const [script] = await db
      .insert(scripts)
      .values({ projectId: FIXTURE_PROJECT_ID, version: 1, outline: null })
      .returning({ id: scripts.id })
    await db.insert(chapters).values(CHAPTER_ROWS.map((c) => ({ ...c, scriptId: script!.id })))
  })

  it('proposes three points as version 1 and parks the stage at the points review', async () => {
    const { result } = await engine.execute({ events: eventFor({ mode: 'all', note: null }) })

    expect(result).toMatchObject({ outcome: 'proposed', version: 1 })
    const set = await latestTalkingPointSet(db, FIXTURE_PROJECT_ID)
    expect(set?.version).toBe(1)
    expect(set?.scriptVersion).toBe(1)
    expect(set?.points).toHaveLength(3)
    expect(set?.points.map((p) => p.order)).toEqual([1, 2, 3])
    for (const point of set!.points) expect(point.id).toMatch(ULID)
    const project = await getProject(db, FIXTURE_PROJECT_ID)
    expect(project).toMatchObject({
      stage: 'shorts',
      stageStatus: 'awaiting_review',
      shortsPhase: 'points',
    })
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('refuses a project frozen to an incomplete bible before any prompt is built', async () => {
    const blank = await blankProject()
    const [script] = await db
      .insert(scripts)
      .values({ projectId: blank, version: 1, outline: null })
      .returning({ id: scripts.id })
    await db.insert(chapters).values(
      CHAPTER_ROWS.map((c, index) => ({
        ...c,
        id: `01HQ0000000000000000000B${index}1`,
        scriptId: script!.id,
      })),
    )

    for (const stub of ['1', '']) {
      vi.stubEnv('MOCK_PROVIDERS', stub)
      const { error } = await engine.execute({
        events: [
          {
            name: 'shorts/points.requested',
            data: { projectId: blank, mode: 'all', note: null },
          },
        ],
      })
      expect(error).toMatchObject({ message: FROZEN_BIBLE_INCOMPLETE_MESSAGE })
    }
    expect(callLlm).not.toHaveBeenCalled()
    expect(await latestTalkingPointSet(db, blank)).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('redoes one point as version 2, changing only that point and keeping its order', async () => {
    const before = await storeMockSet()
    const target = before[1]!

    const { result } = await engine.execute({
      events: eventFor({ mode: 'one', pointId: target.id, note: 'the auditors' }),
    })

    expect(result).toMatchObject({ outcome: 'proposed', version: 2 })
    const set = await latestTalkingPointSet(db, FIXTURE_PROJECT_ID)
    expect(set?.version).toBe(2)
    expect(set?.note).toBe('the auditors')
    const after = set!.points
    expect(after).toHaveLength(3)
    expect(after[0]).toEqual(before[0])
    expect(after[2]).toEqual(before[2])
    expect(after[1]).toMatchObject({ order: target.order })
    expect(after[1]!.id).toMatch(ULID)
    expect(after[1]!.id).not.toBe(target.id)
    expect(after[1]!.title).not.toBe(target.title)
    expect(talkingPointSetIssues(after, 3)).toEqual([])
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.shortsPhase).toBe('points')
  })

  it('adds a point at the end with the next order', async () => {
    const before = await storeMockSet()

    const { result } = await engine.execute({ events: eventFor({ mode: 'add', note: null }) })

    expect(result).toMatchObject({ outcome: 'proposed', version: 2 })
    const after = (await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))!.points
    expect(after).toHaveLength(4)
    expect(after.slice(0, 3)).toEqual(before)
    expect(after[3]!.order).toBe(4)
    expect(talkingPointSetIssues(after, 3)).toEqual([])
  })

  it('refuses to add a sixth point, with a points notice, and writes nothing', async () => {
    await storeMockSet(5)

    const { result } = await engine.execute({ events: eventFor({ mode: 'add', note: null }) })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
    const [notice] = noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'points')
    expect(notice).toMatchObject({ kind: 'stopped' })
    expect(notice?.message).toMatch(/already has 5 talking points/)
    // The set the owner had is still there to review.
    expect(await getProject(db, FIXTURE_PROJECT_ID)).toMatchObject({
      stageStatus: 'awaiting_review',
      shortsPhase: 'points',
    })
  })

  it('refuses a sixth point before any LLM call on the live path', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    try {
      await storeMockSet(5)

      const { result } = await engine.execute({ events: eventFor({ mode: 'add', note: null }) })

      expect(result).toMatchObject({ outcome: 'refused' })
      expect(callLlm).not.toHaveBeenCalled()
      expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('still proposes when the script has no usable outline, passing no tension', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    try {
      await db.update(scripts).set({ outline: { nonsense: true } })
      callLlm.mockResolvedValueOnce({
        text: JSON.stringify({ points: mockTalkingPoints(CHAPTER_ROWS) }),
      })

      const { result } = await engine.execute({ events: eventFor({ mode: 'all', note: null }) })

      expect(result).toMatchObject({ outcome: 'proposed', version: 1 })
      expect(callLlm).toHaveBeenCalledTimes(1)
      expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.points).toHaveLength(3)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('fails the stage with the gate when the proposal is over budget, writing nothing', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    try {
      callLlm.mockRejectedValueOnce(
        new BudgetExceededError({
          provider: 'anthropic',
          operation: 'llm.scripting',
          budgetUsd: 5,
          monthSpendUsd: 5,
          estimateUsd: 0.05,
        }),
      )

      const { result } = await engine.execute({ events: eventFor({ mode: 'all', note: null }) })

      expect(result).toMatchObject({ outcome: 'over-budget' })
      expect(await latestTalkingPointSet(db, FIXTURE_PROJECT_ID)).toBeUndefined()
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
