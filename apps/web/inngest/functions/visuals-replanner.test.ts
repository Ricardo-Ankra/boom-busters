// @vitest-environment node

import {
  createScriptVersion,
  deleteCastMember,
  deleteProjectSet,
  FIXTURE_PROJECT_ID,
  getProject,
  insertCastMember,
  insertProjectSet,
  listCastMembers,
  listProjectNotices,
  listProjectSets,
  listShotSlots,
  replaceNotices,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setCastPhotos,
  setProjectDirection,
  setProjectStage,
  setVisualsJob,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
  updateProjectSet,
  updateSlotBrief,
} from '@boom-busters/db'
import { mockDirectorsBook } from '@boom-busters/providers'
import { newId, noticesFor } from '@boom-busters/schemas'
import type { ShotBrief } from '@boom-busters/schemas'
import type * as Notices from '@/lib/notices'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { forgetRunRows } from '../middleware/run-mirror'
import { bookKept, replannerFailure, visualsReplanner } from './visuals-replanner'

/**
 * The visuals-replanner against the real database, in mock-provider mode
 * (decision 252): `shots` replaces the plan and keeps the owner's book,
 * `direction` replaces the book and leaves the plan alone, and neither runs
 * outside the plan checkpoint.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

// The stop is asserted, not stored; recording an answer's repairs stays real.
const recordStop = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', async (importOriginal) => ({
  ...(await importOriginal<typeof Notices>()),
  recordStop,
}))

describe('replannerFailure (decision 293)', () => {
  it('puts a dead redraft on the Direction card', () => {
    expect(replannerFailure('direction')).toEqual({
      title: 'The redraft failed',
      subject: { subject: 'direction' },
    })
  })

  it('keeps the fix and re-plan titles on the project', () => {
    expect(replannerFailure('repair')).toEqual({ title: 'The fix failed' })
    expect(replannerFailure('shots')).toEqual({ title: 'The re-plan failed' })
  })
})

describe('bookKept (decision 293)', () => {
  it('keeps a reason that ends in the letter s whole', () => {
    expect(bookKept('the plan names no shots')).toBe(
      'the plan names no shots. The book you had is kept.',
    )
  })

  it('drops a trailing full stop and spaces before adding its own', () => {
    expect(bookKept('the answer was cut off. ')).toBe(
      'the answer was cut off. The book you had is kept.',
    )
  })
})

const describeDb = requireTestDatabase() ? describe : describe.skip

function replanEvent(
  op: 'direction' | 'shots' | 'repair',
  jobId?: string,
): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'visuals/replan.requested',
      data: { projectId: FIXTURE_PROJECT_ID, op, ...(jobId ? { jobId } : {}) },
    },
  ]
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

  /**
   * Guards the re-plan side of the production chain (decision 275): op
   * 'shots' loads the project's sets in `load-plan-inputs`
   * (`sets.map(({ name, look, layout }) => ...)` around line 165 of
   * `visuals-replanner.ts`) and carries them through `planChapterSlots` into
   * `chapterShotListRequest`. Only a live-model call actually builds and
   * sends that request; mock mode (the rest of this block) never calls
   * `buildShotListRequest` at all, so it cannot catch a hop that quietly
   * drops `layout` back to `{ name, look }`.
   */
  it("threads a set's room inventory into the live re-plan shot-list request (decision 275)", async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    // A leftover "Boardroom" from an earlier run (project sets are not
    // truncated in `beforeEach`) would fail the insert below with a
    // duplicate-name error.
    for (const existing of await listProjectSets(db, FIXTURE_PROJECT_ID)) {
      if (existing.name === 'Boardroom') await deleteProjectSet(db, existing.id)
    }
    const set = await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Boardroom',
      look: 'dark wood panelling, one window',
    })
    await updateProjectSet(db, set.id, { layout: 'North wall: three tall windows.' })

    try {
      callLlm.mockReset()
      callLlm.mockResolvedValue({
        text: JSON.stringify({
          slots: [
            {
              paragraphIndex: 0,
              seconds: 6,
              brief: {
                type: 'stock',
                coversText: 'By June, the auditors could not find the money.',
                description: 'An empty audit office at dusk.',
                shotSize: 'wide',
                motion: { kind: 'static' },
                transition: 'cut',
                query: 'empty office dusk',
                rejectionCriteria: [],
              },
            },
          ],
        }),
      })

      const { result } = await engine.execute({ events: replanEvent('shots') })
      expect(result).toMatchObject({ outcome: 'replanned' })

      const shotListCall = callLlm.mock.calls.find(
        ([request]) => (request as { task?: string }).task === 'shotlist',
      )
      const prefix =
        (shotListCall?.[0] as { messages?: { content?: string }[] } | undefined)?.messages?.[0]
          ?.content ?? ''
      expect(prefix).toContain('- Boardroom\n  North wall: three tall windows.')
      expect(prefix).not.toContain('dark wood panelling, one window')
    } finally {
      for (const existing of await listProjectSets(db, FIXTURE_PROJECT_ID)) {
        if (existing.name === 'Boardroom') await deleteProjectSet(db, existing.id)
      }
    }
  })

  it('op direction replaces the book and leaves the slots alone', async () => {
    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redrafted' })

    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).not.toMatchObject({
      visualThesis: 'owner edit',
    })
    expect((await listShotSlots(db, FIXTURE_PROJECT_ID))[0]?.brief['description']).toBe('old plan')
  })
  it('op direction: two refused books stop the redraft and keep the stored book (decision 292)', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        ...mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
        motifs: ['the badge', 'the server rack'],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redraft-stopped' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      visualThesis: 'owner edit',
    })
  })

  it('op direction: a redraft cut off twice says why on the Direction card, in the spec words (decision 293)', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'visuals',
      stageStatus: 'awaiting_review',
    })
    recordStop.mockClear()
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: '{"visualThesis": "Half a b', truncated: true })

    const { result } = await engine.execute({ events: replanEvent('direction') })

    expect(result).toMatchObject({ outcome: 'redraft-stopped' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: cut off' })
    expect(recordStop).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'direction', subjectId: null },
      'stopped',
      'The redraft stopped: the answer was cut off at its length limit. The book you had is kept.',
    )
    expect(vi.mocked(notify)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'The redraft stopped',
        body: 'the answer was cut off at its length limit. The book you had is kept.',
      }),
    )
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      visualThesis: 'owner edit',
    })
  })

  it('op direction: a trimmed book leaves its notice for the Direction card (decision 293)', async () => {
    const direction = {
      projectId: FIXTURE_PROJECT_ID,
      subject: 'direction' as const,
      subjectId: null,
    }
    await replaceNotices(db, direction, [])
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({
        ...mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
        eraLocks: [{ span: '1995 to 2008', rules: 'CRT monitors on every desk. '.repeat(30) }],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redrafted' })

    const listed = noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'direction')
    expect(listed.map((notice) => [notice.kind, notice.message])).toEqual([
      ['trimmed', 'Trimmed to fit: era rule 1.'],
    ])
  })

  it('op direction: a clean redraft retires the last notice (decision 293)', async () => {
    const direction = {
      projectId: FIXTURE_PROJECT_ID,
      subject: 'direction' as const,
      subjectId: null,
    }
    await replaceNotices(db, direction, [
      { kind: 'trimmed', message: 'Trimmed to fit: era rule 1.' },
    ])

    // Mock mode: the mock book needs no repair.
    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redrafted' })

    expect(noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'direction')).toEqual([])
  })

  it('refuses outside the plan checkpoint', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    const { result } = await engine.execute({ events: replanEvent('shots') })
    expect(result).toMatchObject({ outcome: 'not-in-plan' })
    expect((await listShotSlots(db, FIXTURE_PROJECT_ID))[0]?.brief['description']).toBe('old plan')
  })

  it('releases its own stamp when the re-plan lands (decision 286)', async () => {
    const jobId = newId()
    await setVisualsJob(db, FIXTURE_PROJECT_ID, {
      op: 'shots',
      jobId,
      startedAt: new Date().toISOString(),
    })
    await engine.execute({ events: replanEvent('shots', jobId) })
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })

  it('releases it on the early return outside the plan checkpoint too', async () => {
    const jobId = newId()
    await setVisualsJob(db, FIXTURE_PROJECT_ID, {
      op: 'shots',
      jobId,
      startedAt: new Date().toISOString(),
    })
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    const { result } = await engine.execute({ events: replanEvent('shots', jobId) })
    expect(result).toMatchObject({ outcome: 'not-in-plan' })
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
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
    // Cleared, so its card carries no Fix note (decision 277).
    expect(slots.find((slot) => slot.id === stillId)?.retype).toBeNull()
  })

  // Decision 277: a rewrite that leaves the finding in place says so on the card.
  it('notes a rewritten slot that is still flagged, naming what is left', async () => {
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({ briefs: [{ ...still, prompt: 'A different server rack.' }] }),
    })

    const { result } = await engine.execute({ events: replanEvent('repair') })

    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 1 })
    const stillNow = (await listShotSlots(db, FIXTURE_PROJECT_ID)).find(
      (slot) => slot.id === stillId,
    )
    expect(stillNow?.retype).toMatchObject({ state: 'fix-note' })
    expect((stillNow?.retype as { note: string }).note).toMatch(
      /^Fix rewrote this brief, but it is still flagged: Emad Mostaque is named here/,
    )
    expect(vi.mocked(notify)).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '0 fixed, 1 rewritten but still flagged. Each card says why.',
      }),
    )
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
    // Kept, and the card says why (decision 277).
    expect(stockNow?.retype).toEqual({
      state: 'fix-note',
      note: 'Fix kept this brief: the answer changed its format.',
    })
  })

  it('keeps every flagged slot with the reason when the repair answer is refused twice (decision 292)', async () => {
    callLlm.mockResolvedValue({ text: 'no json here' })

    const { result } = await engine.execute({ events: replanEvent('repair') })

    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 0 })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    const [stored] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(stored!.brief).toMatchObject({ prompt: still.prompt })
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
