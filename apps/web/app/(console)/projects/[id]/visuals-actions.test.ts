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
  setSlotResolution,
  setVisualsPhase,
  shotSlots,
  slotNeedsResolution,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import type { ShotBrief, SlotCandidate } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { refetchSlotAction, reuseSlotShotAction, unlinkSlotReuseAction } from './visuals-actions'

/**
 * Reusing a shot (decision 261) against the test database, with the seams a
 * server action cannot bring to a unit test replaced: session, cache
 * revalidation, Inngest and storage.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const inngest = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/inngest/client', () => ({
  inngest: { send: (...args: unknown[]) => inngest.send(...args) },
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  deleteObject: vi.fn(),
  headObject: vi.fn(),
  presignPut: vi.fn(),
  putObject: vi.fn(),
  R2_PREFIX: 'boom-busters',
}))
vi.mock('@/lib/remote-image', () => ({ fetchRemoteImage: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const stock = (coversText: string, description: string): ShotBrief => ({
  type: 'stock',
  coversText,
  description,
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'q',
  rejectionCriteria: [],
})
const chart: ShotBrief = {
  type: 'chart',
  coversText: 'Four.',
  description: 'a chart',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'line',
  series: [
    {
      label: 'a',
      unit: 'USD',
      points: [
        { x: '2019', y: 1 },
        { x: '2020', y: 2 },
      ],
    },
  ],
  dataRefs: ['01HQ00000000000000000000AA'],
  takeaway: 't',
  reveal: 'none',
}
const candidate = (id: string, chosen = false): SlotCandidate => ({
  id,
  provider: 'pexels',
  kind: 'image',
  sourceUrl: `https://images.pexels.com/${id}.jpg`,
  licence: 'Pexels License',
  ...(chosen ? { chosen } : {}),
})

describeDb('reusing a shot (decision 261)', () => {
  let ids: { a: string; b: string; c: string; chart: string }

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.\n\nTwo.\n\nThree.\n\nFour.',
      estRuntimeSec: 30,
    })
    const rows: NewShotSlot[] = [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: stock('One.', 'the lobby'),
        startMs: 0,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 1,
        type: 'stock',
        brief: stock('Two.', 'the lobby again'),
        startMs: 6000,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 2,
        type: 'stock',
        brief: stock('Three.', 'the car park'),
        startMs: 12000,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 3,
        type: 'chart',
        brief: chart,
        startMs: 18000,
        durationMs: 6000,
      },
    ]
    await replaceShotList(db, FIXTURE_PROJECT_ID, rows)
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    ids = { a: slots[0]!.id, b: slots[1]!.id, c: slots[2]!.id, chart: slots[3]!.id }
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  })

  it('links in plan phase with nothing to copy, and Fetch owes the slot nothing', async () => {
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)).toEqual({ ok: true })
    const b = (await getShotSlot(db, ids.b))!
    expect(b.reuseOfSlotId).toBe(ids.a)
    expect(slotNeedsResolution(b)).toBe(false)
  })

  it('refuses a slot reusing itself, a data slot either way, and another film', async () => {
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.a, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('its own shot'),
    })
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.chart, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Only stock, AI image and real-footage'),
    })
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.a, ids.chart)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Only stock, AI image and real-footage'),
    })
    expect(await reuseSlotShotAction('01J0000000000000000000000Z', ids.b, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('same film'),
    })
  })

  it('never chains: a pick that is itself a dependant re-points to the original', async () => {
    await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.c, ids.b)).toEqual({ ok: true })
    expect((await getShotSlot(db, ids.c))?.reuseOfSlotId).toBe(ids.a)
  })

  it('on the board copies the named shot at once, and refuses a source with none', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('no shot to reuse yet'),
    })
    await setSlotResolution(db, ids.a, {
      candidates: [candidate('p1', true), candidate('p2')],
      status: 'resolved',
    })
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a, 'p2')).toEqual({ ok: true })
    const b = (await getShotSlot(db, ids.b))!
    expect(b.status).toBe('resolved')
    expect((b.candidates as unknown as SlotCandidate[])[0]).toMatchObject({
      id: 'p2',
      chosen: true,
      reusedFrom: { slotId: ids.a },
    })
  })

  it('refuses to fetch for a linked slot, naming where its shot plays', async () => {
    await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)
    expect(await refetchSlotAction(FIXTURE_PROJECT_ID, ids.b, 'Regenerate')).toEqual({
      ok: false,
      error: 'This slot reuses the shot at 0:00. Choose its own shot first.',
    })
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('gives a slot its own shot back', async () => {
    await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)
    expect(await unlinkSlotReuseAction(FIXTURE_PROJECT_ID, ids.b)).toEqual({ ok: true })
    const b = (await getShotSlot(db, ids.b))!
    expect(b.reuseOfSlotId).toBeNull()
    expect(slotNeedsResolution(b)).toBe(true)
  })
})
