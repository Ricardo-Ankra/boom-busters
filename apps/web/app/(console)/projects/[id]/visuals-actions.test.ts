// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  linkSlotReuse,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotResolution,
  setSlotRoute,
  setVisualsPhase,
  shotSlots,
  slotNeedsResolution,
  updateSettings,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import type { ShotBrief, SlotCandidate } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { visualsReviewModel } from '@/lib/visuals-review'
import {
  finaliseOwnUploadAction,
  refetchSlotAction,
  retypeToHeadlineAction,
  reuseSlotShotAction,
  setSlotRouteAction,
  unlinkSlotReuseAction,
} from './visuals-actions'

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

  it('refuses to link a slot that other slots already show', async () => {
    await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.a, ids.c)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Other slots show this slot'),
    })
    expect((await getShotSlot(db, ids.a))?.reuseOfSlotId).toBeNull()
  })

  it('on the board copies the named shot at once, and refuses a source with none', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('no shot to reuse yet'),
    })
    const sourceRow = (await getShotSlot(db, ids.a))!
    await setSlotResolution(db, ids.a, {
      candidates: [candidate('p1', true), candidate('p2')],
      status: 'resolved',
      answered: { brief: sourceRow.brief, route: sourceRow.route },
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
    const refusal = {
      ok: false,
      error: 'This slot reuses the shot at 0:00. Choose its own shot first.',
    }
    expect(await refetchSlotAction(FIXTURE_PROJECT_ID, ids.b, 'Regenerate')).toEqual(refusal)
    // A re-type to a headline card and the second half of an upload refuse
    // the same way: both run past a valid id onto a slot that owns no shot.
    expect(
      await retypeToHeadlineAction(FIXTURE_PROJECT_ID, ids.b, '01HQ00000000000000000000AA'),
    ).toEqual(refusal)
    expect(
      await finaliseOwnUploadAction({
        projectId: FIXTURE_PROJECT_ID,
        slotId: ids.b,
        fileType: 'image/png',
        fileName: 'shot.png',
        contentHash: 'a'.repeat(64),
      }),
    ).toEqual(refusal)
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

const still = (coversText: string, prompt: string): ShotBrief => ({
  type: 'still',
  coversText,
  description: 'a boardroom, empty',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt,
})
const hero: ShotBrief = {
  type: 'hero',
  coversText: 'Five.',
  description: 'the walkout, in motion',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'p',
  cameraMovement: 'push in',
  loop: false,
}

describeDb('the model select on a shot (decision 264)', () => {
  let ids: { still: string; linked: string; hero: string; stock: string }

  /** Resolve a slot against the brief and route the row currently holds. */
  async function resolveAsRead(slotId: string): Promise<void> {
    const row = (await getShotSlot(db, slotId))!
    await setSlotResolution(db, slotId, {
      status: 'resolved',
      candidates: [],
      answered: { brief: row.brief, route: row.route },
    })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.',
      estRuntimeSec: 30,
    })
    const rows: NewShotSlot[] = [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'still',
        brief: still('One.', 'a boardroom, empty'),
        startMs: 0,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 1,
        type: 'still',
        brief: still('Two.', 'a boardroom, from another angle'),
        startMs: 6000,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 2,
        type: 'hero',
        brief: hero,
        startMs: 12000,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 3,
        type: 'stock',
        brief: stock('Four.', 'the car park'),
        startMs: 18000,
        durationMs: 6000,
      },
    ]
    await replaceShotList(db, FIXTURE_PROJECT_ID, rows)
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    ids = { still: slots[0]!.id, linked: slots[1]!.id, hero: slots[2]!.id, stock: slots[3]!.id }
  })

  it('stores a route on a still slot and makes it owe work again', async () => {
    await resolveAsRead(ids.still)
    expect(slotNeedsResolution((await getShotSlot(db, ids.still))!)).toBe(false)

    expect(
      await setSlotRouteAction(FIXTURE_PROJECT_ID, ids.still, {
        provider: 'google',
        model: 'gemini-3-pro-image',
      }),
    ).toEqual({ ok: true })

    const slot = (await getShotSlot(db, ids.still))!
    expect(slot.route).toEqual({ provider: 'google', model: 'gemini-3-pro-image' })
    expect(slotNeedsResolution(slot)).toBe(true)
  })

  it('falls back to the planned default when the stored model has been retired', async () => {
    // A provider drops a model and the id stays on the row. Reading it
    // unguarded threw, which took the whole project page down over one
    // dead slot (decision 264).
    await updateSettings(db, {
      modelRouting: {
        stills: { provider: 'google', model: 'gemini-3.1-flash-image' },
        stillsLikeness: null,
      },
    })
    await setSlotRoute(db, ids.still, { provider: 'google', model: 'retired-model' })

    const board = await visualsReviewModel(db, FIXTURE_PROJECT_ID)
    const view = board.chapters.flatMap((chapter) => chapter.slots).find((s) => s.id === ids.still)
    expect(view?.route).toBeNull()
    expect(view?.derivedRoute).toEqual({ provider: 'google', model: 'gemini-3.1-flash-image' })
    // And it prices on that derived route rather than throwing on a model
    // no adapter offers any more.
    expect(board.fetchEstimateUsd).toBeGreaterThan(0)
  })

  it('clears the route back to the derived one', async () => {
    await setSlotRouteAction(FIXTURE_PROJECT_ID, ids.still, {
      provider: 'google',
      model: 'gemini-3-pro-image',
    })
    await resolveAsRead(ids.still)
    expect(slotNeedsResolution((await getShotSlot(db, ids.still))!)).toBe(false)

    expect(await setSlotRouteAction(FIXTURE_PROJECT_ID, ids.still, null)).toEqual({ ok: true })

    const slot = (await getShotSlot(db, ids.still))!
    expect(slot.route).toBeNull()
    expect(slotNeedsResolution(slot)).toBe(true)
  })

  it('refuses a model the provider does not offer, in words', async () => {
    expect(
      await setSlotRouteAction(FIXTURE_PROJECT_ID, ids.still, {
        provider: 'google',
        model: 'not-a-real-model',
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('does not offer') })
    expect((await getShotSlot(db, ids.still))?.route).toBeNull()
  })

  it('refuses a route on a slot that is not a still or hero', async () => {
    expect(
      await setSlotRouteAction(FIXTURE_PROJECT_ID, ids.stock, {
        provider: 'google',
        model: 'gemini-3-pro-image',
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('still or AI-video') })
    expect((await getShotSlot(db, ids.stock))?.route).toBeNull()
  })

  it('refuses a linked slot, which shows another slot’s shot', async () => {
    await linkSlotReuse(db, ids.linked, ids.still)
    expect(
      await setSlotRouteAction(FIXTURE_PROJECT_ID, ids.linked, {
        provider: 'google',
        model: 'gemini-3-pro-image',
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('reuses the shot') })
    expect((await getShotSlot(db, ids.linked))?.route).toBeNull()
  })

  it('refuses a slot in another project', async () => {
    expect(
      await setSlotRouteAction('01J0000000000000000000000Z', ids.still, {
        provider: 'google',
        model: 'gemini-3-pro-image',
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('another film') })
    expect((await getShotSlot(db, ids.still))?.route).toBeNull()
  })
})
