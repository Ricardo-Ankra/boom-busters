// @vitest-environment node

import {
  addNotice,
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  listProjectNotices,
  listShotSlots,
  notices,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotJob,
  setSlotRefusal,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { ContentPolicyError, newId, noticesFor } from '@boom-busters/schemas'
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

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

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

  it('releases its own stamp when the redirect lands (decision 286)', async () => {
    const jobId = newId()
    await setSlotJob(db, slotId, { kind: 'redirect', jobId, startedAt: new Date().toISOString() })
    const { result } = await engine.execute({
      events: [
        {
          name: 'visuals/redirect.requested',
          data: { projectId: FIXTURE_PROJECT_ID, slotId, jobId },
        },
      ],
    })
    expect(result).toMatchObject({ outcome: 'redirected' })
    expect((await getShotSlot(db, slotId))!.pendingJob).toBeNull()
  })
})

/** A still refused for a likeness, in plan phase; its id. */
async function seedRefusedLikeness(): Promise<string> {
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
  await setSlotRefusal(db, slot!.id, { reason: 'google: SAFETY', at: new Date().toISOString() })
  await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  return slot!.id
}

describeDb('slot-redirector on the answer helper (decision 293)', () => {
  let engine: InngestTestEngine
  let slotId = ''

  const redirectEvent = (): [{ name: string; data: Record<string, unknown> }] => [
    { name: 'visuals/redirect.requested', data: { projectId: FIXTURE_PROJECT_ID, slotId } },
  ]

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: slotRedirector })
    callLlm.mockReset()
    vi.stubEnv('MOCK_PROVIDERS', '')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(notices)
    slotId = await seedRefusedLikeness()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more with the reason, then keeps the refusal box with it', async () => {
    callLlm.mockResolvedValue({ text: 'not json at all' })

    const { result } = await engine.execute({ events: redirectEvent() })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    const slot = await getShotSlot(db, slotId)
    expect((slot?.refusal as { reason: string }).reason).toBe(
      'Redirect refused: The model returned no JSON for redirected brief. It answered: not json at all',
    )
    expect(slot?.brief).toMatchObject({ depicts: ['Markus Braun'] })
  })

  it("takes the provider's content refusal as final, after one call", async () => {
    callLlm.mockRejectedValue(new ContentPolicyError('google', 'SAFETY'))

    const { result } = await engine.execute({ events: redirectEvent() })

    expect(result).toMatchObject({ outcome: 'refused', reason: 'google: SAFETY' })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(((await getShotSlot(db, slotId))?.refusal as { reason: string }).reason).toBe(
      'Redirect refused: google: SAFETY',
    )
  })

  it("retires the slot's old notice when a clean redirect lands", async () => {
    await addNotice(
      db,
      { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: slotId },
      { kind: 'stopped', message: 'The redirect stopped: over budget.' },
    )
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        brief: {
          type: 'still',
          coversText: likeness.coversText,
          description: 'The podium after the speech.',
          shotSize: 'medium',
          motion: { kind: 'static' },
          transition: 'cut',
          prompt: 'An empty podium under one spotlight, a glass of water half drunk.',
        },
      }),
    })

    const { result } = await engine.execute({ events: redirectEvent() })

    expect(result).toMatchObject({ outcome: 'redirected' })
    expect((await getShotSlot(db, slotId))?.refusal).toBeNull()
    expect(noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'slot', slotId)).toEqual([])
  })
})
