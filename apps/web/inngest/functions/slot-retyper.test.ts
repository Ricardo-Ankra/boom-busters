// @vitest-environment node

import {
  claims,
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  retypeShotSlot,
  saveChapter,
  seed,
  setProjectStage,
  setSlotRetype,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { BudgetExceededError, type ShotBrief } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import type * as Notices from '@/lib/notices'
import { forgetRunRows } from '../middleware/run-mirror'
import { slotRetyper } from './slot-retyper'

/**
 * The slot-retyper against the real database, in mock-provider mode — the
 * staged-visuals integration coverage the design doc asked for: mechanical
 * conversions land whole, chart drafts cite real claims, refusals leave the
 * brief alone and say why ON THE ROW, and plan phase never fetches.
 */

const notify = vi.fn()
vi.mock('@/lib/notify', () => ({
  notify: (...args: unknown[]) => notify(...args),
}))

// The stop is asserted, not stored; recording an answer's repairs stays real.
const recordStop = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', async (importOriginal) => ({
  ...(await importOriginal<typeof Notices>()),
  recordStop,
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const stillBrief: ShotBrief = {
  type: 'still',
  coversText: 'By June, the auditors could not find the money.',
  description: 'Deserted open-plan office at dusk.',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'Deserted office at dusk, painterly. Muted palette.',
}

function retypeEvent(
  slotId: string,
  targetType: string,
): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'visuals/retype.requested',
      data: { projectId: FIXTURE_PROJECT_ID, slotId, targetType },
    },
  ]
}

describeDb('slot-retyper (mock mode)', () => {
  let engine: InngestTestEngine
  let slotId = ''

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: slotRetyper })
    vi.clearAllMocks()
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
        type: 'still',
        brief: stillBrief,
        startMs: 0,
        durationMs: 8000,
      },
    ])
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    slotId = slot!.id
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('converts still → stock mechanically, clearing the old resolution', async () => {
    const { result } = await engine.execute({ events: retypeEvent(slotId, 'stock') })
    expect(result).toMatchObject({ outcome: 'retyped', targetType: 'stock' })

    const slot = await getShotSlot(db, slotId)
    expect(slot?.type).toBe('stock')
    expect(slot?.brief).toMatchObject({
      type: 'stock',
      // The query seeds from the DESCRIPTION, not the tuned still prompt.
      query: stillBrief.description,
      coversText: stillBrief.coversText,
    })
    expect(slot?.status).toBe('unresolved')
    expect(slot?.candidates).toEqual([])
    expect(slot?.resolvedBriefHash).toBeNull()
    expect(slot?.retype).toBeNull()
  })

  it('drafts a chart citing the project’s real claims, and plan phase stays unfetched', async () => {
    const { result } = await engine.execute({ events: retypeEvent(slotId, 'chart') })
    expect(result).toMatchObject({ outcome: 'retyped', targetType: 'chart' })

    const slot = await getShotSlot(db, slotId)
    const brief = slot?.brief as { type: string; dataRefs?: string[] }
    expect(brief.type).toBe('chart')
    // The mock cites the first claim — a ULID that exists on this project,
    // because `resolvePlannedBrief` would refuse anything else.
    expect(brief.dataRefs).toHaveLength(1)
    // Plan phase: the draft LANDS, nothing is fetched for it.
    expect(slot?.status).toBe('unresolved')
    expect(slot?.candidates).toEqual([])
  })

  it('refuses a chart when the project has no claims, on the row, keeping the brief', async () => {
    await db.delete(claims)

    const { result } = await engine.execute({ events: retypeEvent(slotId, 'chart') })
    expect(result).toMatchObject({ outcome: 'refused' })

    const slot = await getShotSlot(db, slotId)
    // The old brief survives, and the reason is visible where the board reads.
    expect((slot?.brief as { type: string }).type).toBe('still')
    expect(slot?.retype).toMatchObject({ state: 'refused', target: 'chart' })
    expect((slot?.retype as { reason: string }).reason).toMatch(/claims/i)
  })

  it('treats a same-type request as a no-op that still clears the drafting marker', async () => {
    // The action stamps `drafting` before it sends; a stale event for the
    // type the slot already has must not leave that marker behind.
    await setSlotRetype(db, slotId, { state: 'drafting', target: 'still' })
    const { result } = await engine.execute({ events: retypeEvent(slotId, 'still') })
    expect(result).toMatchObject({ outcome: 'unchanged' })
    expect((await getShotSlot(db, slotId))?.retype).toBeNull()
  })

  it('designs a slot retyped to a graphic (decision 289)', async () => {
    const { result } = await engine.execute({ events: retypeEvent(slotId, 'graphic') })
    expect(result).toMatchObject({ outcome: 'retyped', targetType: 'graphic' })

    const slot = await getShotSlot(db, slotId)
    expect(slot?.type).toBe('graphic')
    expect(slot?.brief).toMatchObject({
      type: 'graphic',
      intent: '[mock] The figure, large, with the mark beside it.',
      scene: { elements: expect.arrayContaining([expect.objectContaining({ id: 't1' })]) },
    })
    expect(slot?.retype).toBeNull()
  })

  it('holds the drafting marker while the graphic is designed, and clears it after (final review I4)', async () => {
    const design = await import('@/lib/graphic-design')
    const real = design.designGraphic
    let during: unknown = 'not read'
    const spy = vi.spyOn(design, 'designGraphic').mockImplementationOnce(async (...args) => {
      during = (await getShotSlot(db, slotId))?.retype
      return real(...args)
    })
    try {
      const { result } = await engine.execute({ events: retypeEvent(slotId, 'graphic') })
      expect(result).toMatchObject({ outcome: 'retyped', targetType: 'graphic' })
      // The format picker and Redesign stay locked while the call is in flight.
      expect(during).toEqual({ state: 'drafting', target: 'graphic' })
      const slot = await getShotSlot(db, slotId)
      expect(slot?.retype).toBeNull()
      expect(slot?.brief).toHaveProperty('scene')
    } finally {
      spy.mockRestore()
    }
  })

  it('does not write the design over a slot retyped away while it was designed (final review I4)', async () => {
    const design = await import('@/lib/graphic-design')
    const real = design.designGraphic
    const spy = vi.spyOn(design, 'designGraphic').mockImplementationOnce(async (...args) => {
      // A second retype lands while the first one's design call is in flight.
      await retypeShotSlot(db, slotId, 'still', stillBrief)
      return real(...args)
    })
    try {
      await engine.execute({ events: retypeEvent(slotId, 'graphic') })
      const slot = await getShotSlot(db, slotId)
      expect(slot?.type).toBe('still')
      expect(slot?.brief).toEqual(stillBrief)
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps the reason on the brief when the designer refuses a retyped graphic', async () => {
    const design = await import('@/lib/graphic-design')
    const refuse = vi
      .spyOn(design, 'designGraphic')
      .mockResolvedValueOnce({ ok: false, issue: 'no claim holds $5bn' })
    try {
      const { result } = await engine.execute({ events: retypeEvent(slotId, 'graphic') })
      expect(result).toMatchObject({ outcome: 'retyped', targetType: 'graphic' })

      const slot = await getShotSlot(db, slotId)
      expect(slot?.type).toBe('graphic')
      expect(slot?.brief).toMatchObject({ type: 'graphic', designIssue: 'no claim holds $5bn' })
      expect(slot?.brief).not.toHaveProperty('scene')
      expect(slot?.retype).toBeNull()
    } finally {
      refuse.mockRestore()
    }
  })

  it('says why on the brief when a retyped graphic runs out of budget', async () => {
    const design = await import('@/lib/graphic-design')
    const broke = vi.spyOn(design, 'designGraphic').mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.05,
      }),
    )
    try {
      const { result } = await engine.execute({ events: retypeEvent(slotId, 'graphic') })
      expect(result).toMatchObject({ outcome: 'over-budget' })

      const slot = await getShotSlot(db, slotId)
      expect(slot?.type).toBe('graphic')
      const brief = slot?.brief as { designIssue?: string }
      expect(brief.designIssue).toMatch(/\S/)
      expect(slot?.brief).not.toHaveProperty('scene')
      // The drafting marker goes with the budget stop too (final review I4).
      expect(slot?.retype).toBeNull()
    } finally {
      broke.mockRestore()
    }
  })

  it('says why on the slot card when a parked plan runs out of budget designing a retyped graphic (decision 293)', async () => {
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'visuals',
      stageStatus: 'awaiting_review',
    })
    const design = await import('@/lib/graphic-design')
    const broke = vi.spyOn(design, 'designGraphic').mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.05,
      }),
    )
    try {
      const { result } = await engine.execute({ events: retypeEvent(slotId, 'graphic') })
      expect(result).toMatchObject({ outcome: 'over-budget' })
      expect(recordStop).toHaveBeenCalledWith(
        { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: slotId },
        'stopped',
        expect.stringMatching(
          /^The graphic could not be designed: The monthly spend ceiling would be crossed by anthropic llm.graphics/,
        ),
      )
    } finally {
      broke.mockRestore()
    }
  })
})
