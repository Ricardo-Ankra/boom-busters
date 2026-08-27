// @vitest-environment node

import {
  claims,
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotRetype,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import type { ShotBrief } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
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
})
