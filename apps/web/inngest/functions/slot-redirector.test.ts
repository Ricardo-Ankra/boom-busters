// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotRefusal,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import type { ShotBrief } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { slotRedirector } from './slot-redirector'

/**
 * The slot-redirector against the real database, in mock-provider mode
 * (decision 252): a refused likeness becomes the same beat without the
 * person, the refusal clears with the brief, and plan phase never fetches.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const likeness: ShotBrief = {
  type: 'still',
  coversText: 'Braun took the stage.',
  description: 'The chief executive at the results presentation.',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'Markus Braun at a podium, 50mm, one spotlight.',
  depicts: ['Markus Braun'],
  shotSize: 'medium',
}

describeDb('slot-redirector (mock mode)', () => {
  let engine: InngestTestEngine
  let slotId = ''

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: slotRedirector })
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The stage',
      contentMd: 'Braun took the stage.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'still',
        brief: likeness,
        startMs: 0,
        durationMs: 6000,
      },
    ])
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    slotId = slot!.id
    await setSlotRefusal(db, slotId, { reason: 'google: SAFETY', at: new Date().toISOString() })
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rewrites the still without the person and clears the refusal', async () => {
    const { result } = await engine.execute({
      events: [
        { name: 'visuals/redirect.requested', data: { projectId: FIXTURE_PROJECT_ID, slotId } },
      ],
    })
    expect(result).toMatchObject({ outcome: 'redirected' })

    const slot = await getShotSlot(db, slotId)
    expect(slot?.refusal).toBeNull()
    expect(slot?.status).toBe('unresolved')
    expect(slot?.brief).toMatchObject({
      type: 'still',
      coversText: likeness.coversText,
      shotSize: 'medium',
    })
    expect((slot?.brief as { depicts?: string[] }).depicts).toBeUndefined()
    expect(String(slot?.brief['description'])).toContain('[mock]')
    // Plan phase: nothing fetched.
    expect(slot?.candidates).toEqual([])
  })
})
