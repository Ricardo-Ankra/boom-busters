// @vitest-environment node

import {
  createScriptVersion,
  deleteCastMember,
  FIXTURE_PROJECT_ID,
  getProject,
  insertCastMember,
  listCastMembers,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setCastPhotos,
  setProjectDirection,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
  updateSlotBrief,
} from '@boom-busters/db'
import { mockDirectorsBook } from '@boom-busters/providers'
import type { ShotBrief } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { visualsReplanner } from './visuals-replanner'

/**
 * The visuals-replanner against the real database, in mock-provider mode
 * (decision 252): `shots` replaces the plan and keeps the owner's book,
 * `direction` replaces the book and leaves the plan alone, and neither runs
 * outside the plan checkpoint.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

function replanEvent(
  op: 'direction' | 'shots' | 'repair',
): [{ name: string; data: Record<string, unknown> }] {
  return [{ name: 'visuals/replan.requested', data: { projectId: FIXTURE_PROJECT_ID, op } }]
}

describeDb('visuals-replanner (mock mode)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: visualsReplanner })
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: {
          type: 'stock',
          coversText: 'old',
          description: 'old plan',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'old',
          rejectionCriteria: [],
        },
        startMs: 0,
        durationMs: 5000,
      },
    ])
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    await setProjectDirection(db, FIXTURE_PROJECT_ID, {
      ...mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
      visualThesis: 'owner edit',
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('op shots replaces the slots and keeps the owner’s book', async () => {
    const { result } = await engine.execute({ events: replanEvent('shots') })
    expect(result).toMatchObject({ outcome: 'replanned' })

    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot.brief['description'] !== 'old plan')).toBe(true)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      visualThesis: 'owner edit',
    })
  })

  it('op direction replaces the book and leaves the slots alone', async () => {
    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redrafted' })

    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).not.toMatchObject({
      visualThesis: 'owner edit',
    })
    expect((await listShotSlots(db, FIXTURE_PROJECT_ID))[0]?.brief['description']).toBe('old plan')
  })

  it('refuses outside the plan checkpoint', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    const { result } = await engine.execute({ events: replanEvent('shots') })
    expect(result).toMatchObject({ outcome: 'not-in-plan' })
    expect((await listShotSlots(db, FIXTURE_PROJECT_ID))[0]?.brief['description']).toBe('old plan')
  })
})

describeDb('visuals-replanner op repair (decision 271)', () => {
  const SENTENCE = 'Mostaque told the investors the money was there.'
  const still = {
    type: 'still' as const,
    coversText: SENTENCE,
    description: 'A server rack.',
    shotSize: 'close' as const,
    prompt: 'A server rack in the dark.',
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
  }
  const stock = {
    type: 'stock' as const,
    coversText: 'The money was gone.',
    description: 'An empty office.',
    shotSize: 'wide' as const,
    query: 'empty office',
    rejectionCriteria: [],
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
  }
  let engine: InngestTestEngine
  let memberId: string
  let stillId: string
  let stockId: string

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: visualsReplanner })
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The exit',
      contentMd: SENTENCE,
      estRuntimeSec: 30,
    })
    // Another suite can leave a cast row behind for this project (its own
    // afterEach clears state that belongs to the next test's beforeEach
    // instead), and the name is unique per project, so `insertCastMember`
    // below would throw on a leftover "Emad Mostaque".
    for (const existing of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, existing.id)
    }
    const member = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    memberId = member.id
    await setCastPhotos(db, member.id, [
      {
        r2Key: `boom-busters/cast/${FIXTURE_PROJECT_ID}/a.jpg`,
        contentHash: 'a',
        mimeType: 'image/jpeg',
        width: 1000,
        height: 1200,
        view: 'front',
      },
    ])
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'still',
        brief: still,
        startMs: 0,
        durationMs: 5000,
      },
      {
        chapterId: chapter.id,
        index: 1,
        type: 'stock',
        brief: stock,
        startMs: 5000,
        durationMs: 5000,
      },
    ])
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    stillId = slots[0]!.id
    stockId = slots[1]!.id
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    await setProjectDirection(
      db,
      FIXTURE_PROJECT_ID,
      mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
    )
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await deleteCastMember(db, memberId)
  })

  it('rewrites only the flagged slot, with the photographed person put in', async () => {
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({
        briefs: [
          { ...still, prompt: 'Emad Mostaque at the boardroom table.', depicts: ['Emad Mostaque'] },
        ],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('repair') })

    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 1 })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(callLlm.mock.calls[0]?.[0]?.messages?.at(-1)?.content).toContain(
      'Emad Mostaque is named here and photographed',
    )
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.find((slot) => slot.id === stillId)?.brief).toMatchObject({
      depicts: ['Emad Mostaque'],
    })
    expect(slots.find((slot) => slot.id === stockId)?.brief).toMatchObject({
      description: 'An empty office.',
    })
  })

  it('may turn a stock slot naming the person into a still, since the producer pressed the button', async () => {
    await updateSlotBrief(db, stillId, { ...still, depicts: ['Emad Mostaque'] })
    await updateSlotBrief(db, stockId, { ...stock, coversText: SENTENCE })
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({
        briefs: [{ ...still, prompt: 'Emad Mostaque at the table.', depicts: ['Emad Mostaque'] }],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('repair') })

    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 1 })
    const stockNow = (await listShotSlots(db, FIXTURE_PROJECT_ID)).find(
      (slot) => slot.id === stockId,
    )
    expect(stockNow?.type).toBe('still')
  })

  it('keeps a stock slot stock when its only finding is not a person or a set, even if answered with a still', async () => {
    // Three wide pictures in a row: the stock slot is the third, so its one
    // finding is a size run, which never clears it to become a paid still.
    const chapterId = (await listShotSlots(db, FIXTURE_PROJECT_ID))[0]!.chapterId
    const wideStill = { ...still, shotSize: 'wide' as const, depicts: ['Emad Mostaque'] }
    const ledger = {
      ...still,
      shotSize: 'wide' as const,
      coversText: 'The money was there.',
      description: 'A ledger.',
      prompt: 'A ledger open on a desk.',
    }
    const row = (index: number, brief: ShotBrief) => ({
      chapterId,
      index,
      type: brief.type,
      brief,
      startMs: index * 5000,
      durationMs: 5000,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      row(0, wideStill),
      row(1, ledger),
      row(2, stock),
    ])
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({
        briefs: [{ ...still, shotSize: 'close', coversText: stock.coversText }],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('repair') })

    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 0 })
    const stockNow = (await listShotSlots(db, FIXTURE_PROJECT_ID)).find((slot) => slot.index === 2)
    expect(stockNow?.type).toBe('stock')
  })

  it('refuses outside the plan checkpoint', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    const { result } = await engine.execute({ events: replanEvent('repair') })
    expect(result).toMatchObject({ outcome: 'not-in-plan' })
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('makes no model call in mock mode', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    const { result } = await engine.execute({ events: replanEvent('repair') })
    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 0 })
    expect(callLlm).not.toHaveBeenCalled()
  })
})
