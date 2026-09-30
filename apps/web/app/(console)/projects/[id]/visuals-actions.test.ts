// @vitest-environment node

import {
  assets,
  claims,
  createScriptVersion,
  deleteCastMember,
  deleteProjectSet,
  FIXTURE_DOSSIER_ID,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  getSocialPost,
  insertCastMember,
  insertProjectSet,
  linkSlotReuse,
  listCastMembers,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  scriptableClaims,
  seed,
  setSlotResolution,
  setProjectStage,
  setSetPlates,
  setSlotRoute,
  setSocialPostManual,
  setVisualsPhase,
  shotSlots,
  slotNeedsResolution,
  socialPosts,
  updateSettings,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import {
  SOCIAL_EXCERPT_NOT_VERBATIM,
  SOCIAL_HIGHLIGHT_OUTSIDE,
  SOCIAL_MISSING_PREFIX,
} from '@boom-busters/compositions/social'
import { fixtureId, NOT_A_POST_ERROR } from '@boom-busters/schemas'
import type { ShotBrief, SlotCandidate } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { headObject } from '@/lib/storage'
import { visualsReviewModel } from '@/lib/visuals-review'
import {
  approvePlanAction,
  attachGraphicLogosAction,
  editBriefAction,
  finaliseOwnUploadAction,
  linkCastHandleAction,
  refetchSlotAction,
  refetchSocialPostAction,
  removeSocialImageAction,
  retypeSlotAction,
  retypeToHeadlineAction,
  retypeToSocialAction,
  reuseSlotShotAction,
  saveHeadlineAction,
  saveSocialCardAction,
  saveSocialPostAction,
  setHeadlineArticleAction,
  setSlotRouteAction,
  setSocialPostAction,
  showSetPhotoAction,
  unlinkCastHandleAction,
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
const storage = vi.hoisted(() => ({
  configured: false,
  getObjectBytes: vi.fn(),
  putObject: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  deleteObject: vi.fn(),
  getObjectBytes: (...args: unknown[]) => storage.getObjectBytes(...args),
  headObject: vi.fn(),
  presignPut: vi.fn(),
  putObject: (...args: unknown[]) => storage.putObject(...args),
  R2_PREFIX: 'boom-busters',
}))
vi.mock('@/lib/remote-image', () => ({ fetchRemoteImage: vi.fn() }))
const socialSource = vi.hoisted(() => ({ refetchPost: vi.fn() }))
vi.mock('@/lib/social-source', () => ({
  refetchPost: (...args: unknown[]) => socialSource.refetchPost(...args),
}))

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

const stillInSet = (coversText: string, prompt: string, setName: string): ShotBrief => ({
  type: 'still',
  coversText,
  description: 'a boardroom, empty',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt,
  set: setName,
})

describeDb('placing a camera on a set shot (decision 275)', () => {
  let ids: { inSet: string; noSet: string; linked: string }

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.\n\nTwo.\n\nThree.',
      estRuntimeSec: 18,
    })
    const rows: NewShotSlot[] = [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'still',
        brief: stillInSet('One.', 'a boardroom, empty', 'The boardroom'),
        startMs: 0,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 1,
        type: 'still',
        brief: still('Two.', 'a plain still, no set'),
        startMs: 6000,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 2,
        type: 'still',
        brief: stillInSet('Three.', 'the same boardroom, another angle', 'The boardroom'),
        startMs: 12000,
        durationMs: 6000,
      },
    ]
    await replaceShotList(db, FIXTURE_PROJECT_ID, rows)
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    ids = { inSet: slots[0]!.id, noSet: slots[1]!.id, linked: slots[2]!.id }
  })

  it('saves a camera on a still in a set, which then owes work (decision 275)', async () => {
    const result = await editBriefAction(FIXTURE_PROJECT_ID, ids.inSet, {
      camera: { facing: 'west', position: 'the corridor glass', lens: '50mm' },
    })
    expect(result.ok).toBe(true)
    const stored = await getShotSlot(db, ids.inSet)
    expect((stored?.brief as { camera?: unknown }).camera).toEqual({
      facing: 'west',
      position: 'the corridor glass',
      lens: '50mm',
    })
    expect(slotNeedsResolution(stored!)).toBe(true)
  })

  it('refuses a camera on a slot that names no set', async () => {
    expect(
      await editBriefAction(FIXTURE_PROJECT_ID, ids.noSet, {
        camera: { facing: 'west', position: 'x y z' },
      }),
    ).toEqual({
      ok: false,
      error: 'Only a still in a set has a camera to place.',
    })
  })

  // Review Focus 5.
  it('refuses a camera on a linked slot', async () => {
    await linkSlotReuse(db, ids.linked, ids.inSet)
    const result = await editBriefAction(FIXTURE_PROJECT_ID, ids.linked, {
      camera: { facing: 'west', position: 'x y z' },
    })
    expect(result.ok).toBe(false)
  })
})

const graphicBrief = (entity: string): ShotBrief => ({
  type: 'graphic',
  coversText: 'Four.',
  description: 'a graphic',
  motion: { kind: 'static' },
  transition: 'cut',
  scene: {
    elements: [
      {
        kind: 'logo',
        id: 'l1',
        cell: { col: 0, row: 0, colSpan: 4, rowSpan: 4 },
        enter: { kind: 'fade', atMs: 0 },
        entity,
      },
    ],
  },
})

describeDb('attaching an uploaded mark to a waiting graphic (decision 268, Plan B)', () => {
  let chapterId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'Four.',
      estRuntimeSec: 6,
    })
    chapterId = chapter.id
  })

  /** A graphic slot whose one logo element names `entity` and carries no asset yet. */
  async function seedGraphicSlot(entity: string): Promise<string> {
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId,
        index: 0,
        type: 'graphic',
        brief: graphicBrief(entity),
        startMs: 0,
        durationMs: 6000,
      },
    ])
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    await setSlotResolution(db, slot!.id, { status: 'placeholder', candidates: [] })
    return slot!.id
  }

  it('resolves once a matching mark is in the library, writing back its asset id', async () => {
    const slotId = await seedGraphicSlot('Wirecard AG')
    await db
      .insert(assets)
      .values({
        id: '01HQ00000000000000000000M1',
        kind: 'logo',
        r2Key: 'boom-busters/logos/wirecard.png',
        contentHash: 'fixture-logo-wirecard-ag',
        licence: 'Uploaded by owner',
        title: 'Wirecard AG',
        width: 200,
        height: 200,
      })
      .onConflictDoNothing()

    expect(await attachGraphicLogosAction(FIXTURE_PROJECT_ID, slotId)).toEqual({ ok: true })

    const row = (await getShotSlot(db, slotId))!
    expect(row.status).toBe('resolved')
    const brief = row.brief as unknown as { scene: { elements: { assetId?: string }[] } }
    expect(brief.scene.elements[0]?.assetId).toBe('01HQ00000000000000000000M1')
  })

  it('stays a placeholder without a match, naming the mark that is missing', async () => {
    const slotId = await seedGraphicSlot('Globex Corporation')

    expect(await attachGraphicLogosAction(FIXTURE_PROJECT_ID, slotId)).toEqual({
      ok: false,
      error: 'A mark for "Globex Corporation" is still missing.',
    })

    const row = (await getShotSlot(db, slotId))!
    expect(row.status).toBe('placeholder')
    const brief = row.brief as unknown as { scene: { elements: { assetId?: string }[] } }
    expect(brief.scene.elements[0]?.assetId).toBeUndefined()
  })
})

// Decision 278: a set's photo can be a slot's shot, copied so it outlives the set.
describeDb('showing a set photo in a slot (decision 278)', () => {
  let slotId = ''
  let archivalId = ''
  let setId = ''
  const plate = (contentHash: string, origin: 'uploaded' | 'generated') => ({
    r2Key: `boom-busters/sets/${FIXTURE_PROJECT_ID}/${contentHash}.jpg`,
    contentHash,
    mimeType: 'image/jpeg' as const,
    width: 1600,
    height: 900,
    view: contentHash === 'north' ? ('north' as const) : ('east' as const),
    origin,
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    storage.configured = true
    storage.getObjectBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    })
    storage.putObject.mockResolvedValue(undefined)
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The board',
      contentMd: 'One.\n\nTwo.',
      estRuntimeSec: 20,
    })
    const archival: ShotBrief = {
      type: 'archival',
      coversText: 'Two.',
      description: 'The real room.',
      motion: { kind: 'static' },
      transition: 'cut',
      query: 'q',
      mustShow: 'the room',
    }
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: stock('One.', 'a room'),
        startMs: 0,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 1,
        type: 'archival',
        brief: archival,
        startMs: 6000,
        durationMs: 6000,
      },
    ])
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    slotId = slots[0]!.id
    archivalId = slots[1]!.id
    const set = await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Photo Test Boardroom',
      look: 'glass',
    })
    setId = set.id
    await setSetPlates(db, set.id, [plate('north', 'uploaded'), plate('east', 'generated')])
  })

  afterEach(async () => {
    storage.configured = false
    await deleteProjectSet(db, setId)
  })

  it('copies the photo to the slot and makes it the chosen shot', async () => {
    const result = await showSetPhotoAction({
      projectId: FIXTURE_PROJECT_ID,
      slotId,
      setId,
      contentHash: 'east',
    })
    expect(result).toEqual({ ok: true })
    const key = storage.putObject.mock.calls[0]?.[0] as string
    expect(key).toMatch(
      new RegExp(`^boom-busters/uploads/${FIXTURE_PROJECT_ID}/[0-9a-f]{64}\\.jpg$`),
    )
    const row = await getShotSlot(db, slotId)
    const chosen = (row!.candidates as SlotCandidate[]).find((candidate) => candidate.chosen)
    expect(chosen).toMatchObject({
      r2Key: key,
      summary: 'Photo Test Boardroom, east wall',
      licence: 'Generated set plate',
      sourceUrl: `set://${setId}/east`,
    })
    expect(row!.status).toBe('resolved')
  })

  it('refuses a generated photo on a real-footage slot, and takes an uploaded one', async () => {
    expect(
      await showSetPhotoAction({
        projectId: FIXTURE_PROJECT_ID,
        slotId: archivalId,
        setId,
        contentHash: 'east',
      }),
    ).toEqual({
      ok: false,
      error: 'A real-footage slot takes only a photo you uploaded; this one was generated.',
    })
    expect(
      await showSetPhotoAction({
        projectId: FIXTURE_PROJECT_ID,
        slotId: archivalId,
        setId,
        contentHash: 'north',
      }),
    ).toEqual({ ok: true })
  })

  it('says so when the photo has left the set', async () => {
    expect(
      await showSetPhotoAction({
        projectId: FIXTURE_PROJECT_ID,
        slotId,
        setId,
        contentHash: 'gone',
      }),
    ).toEqual({ ok: false, error: 'That photo is no longer in the set.' })
    expect(storage.putObject).not.toHaveBeenCalled()
  })
})

// Decision 279: with no run parked on the plan, the approval would wake
// nothing, so Fetch visuals starts a run at the fetch pass instead.
describeDb('Fetch visuals with or without a parked run (decision 279)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    inngest.send.mockResolvedValue(undefined)
    await seed(db)
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  })

  it('wakes the run parked on the plan', async () => {
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'visuals',
      stageStatus: 'awaiting_review',
    })
    expect(await approvePlanAction(FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({ name: 'visuals/plan.approved' })
  })

  it('resumes at the fetch pass when the planning run failed', async () => {
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'visuals', stageStatus: 'failed' })
    expect(await approvePlanAction(FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({
      name: 'visuals/fetch.resume',
      data: { projectId: FIXTURE_PROJECT_ID },
    })
  })
})

// Decision 280: "Headline saved" on a card that stays a placeholder read as
// the card being stuck for no reason, so an incomplete card is refused.
describe('saving a headline card without its date', () => {
  it('names what is missing and saves nothing', async () => {
    const result = await saveHeadlineAction(
      '01J0000000000000000000000A',
      '01J000000000000000000000AA',
      {
        outlet: 'Semafor',
        headline: 'Stability AI is running out of cash',
        author: '',
        publishedAt: '',
        description: '',
        emphasis: '',
        showDeck: false,
      },
    )
    expect(result).toEqual({
      ok: false,
      error: 'A headline card needs the publication, the headline and the date. Missing: the date.',
    })
  })
})

// Decision 280: a card is pointed at an article, never at a front page.
describe("setting a headline card's article address", () => {
  const PROJECT = '01J0000000000000000000000A'
  const SLOT = '01J000000000000000000000AA'

  it('refuses a front page, saying what to paste instead', async () => {
    expect(await setHeadlineArticleAction(PROJECT, SLOT, 'https://www.semafor.com/')).toEqual({
      ok: false,
      error: "That is the site's front page. Paste the address of the article itself.",
    })
  })

  it('refuses something that is not a web address', async () => {
    expect(await setHeadlineArticleAction(PROJECT, SLOT, 'Semafor, October 2023')).toEqual({
      ok: false,
      error: 'That is not a web address.',
    })
  })
})

// ---------------------------------------------------------------------------
// The social post card (decision 284)
// ---------------------------------------------------------------------------

// The address rule refuses before any row is read, exactly like the
// headline card's front-page refusal above.
describe("setting a social post's address", () => {
  const PROJECT = '01J0000000000000000000000A'
  const SLOT = '01J000000000000000000000AA'

  it('refuses a profile address', async () => {
    expect(await setSocialPostAction(PROJECT, SLOT, 'https://x.com/EMostaque')).toEqual({
      ok: false,
      error: NOT_A_POST_ERROR,
    })
  })

  it('refuses plain words', async () => {
    expect(await setSocialPostAction(PROJECT, SLOT, 'Emad announced it on X')).toEqual({
      ok: false,
      error: NOT_A_POST_ERROR,
    })
  })
})

describe('saving a social post by hand', () => {
  const PROJECT = '01J0000000000000000000000A'
  const SLOT = '01J000000000000000000000AA'

  it('refuses a date that is not YYYY-MM-DD', async () => {
    expect(await saveSocialPostAction(PROJECT, SLOT, { postedAt: '23 March 2024' })).toEqual({
      ok: false,
      error: 'Use a date like 2024-03-23.',
    })
  })

  it('refuses something that is not an X handle', async () => {
    expect(await saveSocialPostAction(PROJECT, SLOT, { handle: '@not a handle' })).toEqual({
      ok: false,
      error: 'That is not an X handle.',
    })
  })

  it('refuses a date the calendar does not have, in the same words', async () => {
    for (const postedAt of ['2024-13-45', '2023-02-30', '2024-00-10']) {
      expect(await saveSocialPostAction(PROJECT, SLOT, { postedAt }), postedAt).toEqual({
        ok: false,
        error: 'Use a date like 2024-03-23.',
      })
    }
  })

  it('refuses a name longer than X allows', async () => {
    expect(await saveSocialPostAction(PROJECT, SLOT, { authorName: 'N'.repeat(51) })).toEqual({
      ok: false,
      error: 'A name on X can be at most 50 characters.',
    })
  })
})

describe('re-typing to a bare social card', () => {
  it('refuses early, since which post to show is the owner’s choice', async () => {
    expect(
      await retypeSlotAction('01J0000000000000000000000A', '01J000000000000000000000AA', 'social'),
    ).toEqual({ ok: false, error: "Choose which claim's post to show." })
  })
})

describe('bad ids on the social board actions', () => {
  it('refuses removeSocialImageAction', async () => {
    expect(await removeSocialImageAction('not-an-id', 'not-an-id', 'avatar')).toEqual({
      ok: false,
      error: 'Unknown id',
    })
  })

  it('refuses linkCastHandleAction', async () => {
    expect(await linkCastHandleAction('not-an-id', 'not-an-id', 'emostaque')).toEqual({
      ok: false,
      error: 'Unknown id',
    })
  })

  it('refuses unlinkCastHandleAction', async () => {
    expect(await unlinkCastHandleAction('not-an-id', 'not-an-id', 'not-an-id')).toEqual({
      ok: false,
      error: 'Unknown id',
    })
  })
})

const social = (coversText: string, postUrl: string): ShotBrief => ({
  type: 'social',
  coversText,
  description: 'a post card',
  motion: { kind: 'static' },
  transition: 'cut',
  sourceClaimId: fixtureId('CLAIM', 30),
  postUrl,
})

describeDb('editing a social post card (decision 284)', () => {
  const POST_URL = 'https://x.com/i/status/1740000000000000001'
  let slotId: string
  let stockId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    inngest.send.mockResolvedValue(undefined)
    storage.configured = false
    await seed(db)
    await db.delete(shotSlots)
    await db.delete(socialPosts)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The post',
      contentMd: 'One.\n\nTwo.',
      estRuntimeSec: 12,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'social',
        brief: social('One.', POST_URL),
        startMs: 0,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 1,
        type: 'stock',
        brief: stock('Two.', 'a newsroom'),
        startMs: 6000,
        durationMs: 6000,
      },
    ])
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    slotId = slots[0]!.id
    stockId = slots[1]!.id
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
  })

  it('writes the new address and clears the old excerpt and highlight, then re-fetches', async () => {
    await setSocialPostManual(db, POST_URL, {
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text: 'As my notifications are RIP some notes: I decided to step down to fix this.',
      postedAt: '2024-01-01',
    })
    expect(
      await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, {
        excerpt: 'I decided to step down to fix this.',
      }),
    ).toEqual({ ok: true })
    inngest.send.mockClear()

    const other = 'https://x.com/AnotherHandle/status/9990000000000000009'
    expect(await setSocialPostAction(FIXTURE_PROJECT_ID, slotId, other)).toEqual({ ok: true })

    const row = (await getShotSlot(db, slotId))!
    const brief = row.brief as unknown as { postUrl: string; excerpt?: string; emphasis?: string }
    expect(brief.postUrl).toBe('https://x.com/i/status/9990000000000000009')
    expect(brief.excerpt).toBeUndefined()
    expect(brief.emphasis).toBeUndefined()
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({
      name: 'visuals/refetch.requested',
      data: { projectId: FIXTURE_PROJECT_ID, slotId, note: 'Post address changed' },
    })
  })

  it('saves the owner’s own correction to the post record and re-fetches', async () => {
    expect(
      await saveSocialPostAction(FIXTURE_PROJECT_ID, slotId, {
        authorName: 'Emad Mostaque',
        handle: '@EMostaque',
        text: 'The corrected words.',
        postedAt: '2024-03-23',
      }),
    ).toEqual({ ok: true })

    const record = await getSocialPost(db, POST_URL)
    expect(record).toMatchObject({
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text: 'The corrected words.',
      postedAt: '2024-03-23',
      status: 'manual',
    })
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({
      name: 'visuals/refetch.requested',
      data: { note: 'Post details edited' },
    })
  })

  it('refuses excerpt and highlight edits with no post text yet, in the missing-fields wording', async () => {
    expect(await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, { excerpt: 'anything' })).toEqual(
      {
        ok: false,
        error: `${SOCIAL_MISSING_PREFIX}the name, the handle, the text, the date.`,
      },
    )
  })

  it('refuses an excerpt that is not word for word, and a highlight outside it', async () => {
    await setSocialPostManual(db, POST_URL, {
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text: 'As my notifications are RIP some notes: I decided to step down to fix this.',
      postedAt: '2024-01-01',
    })

    expect(
      await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, {
        excerpt: 'I resigned from the company today',
      }),
    ).toEqual({ ok: false, error: SOCIAL_EXCERPT_NOT_VERBATIM })

    expect(
      await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, {
        excerpt: 'I decided to step down to fix this.',
        emphasis: 'RIP some notes',
      }),
    ).toEqual({ ok: false, error: SOCIAL_HIGHLIGHT_OUTSIDE })
  })

  it('saves a verbatim excerpt and a highlight found inside it', async () => {
    await setSocialPostManual(db, POST_URL, {
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text: 'As my notifications are RIP some notes: I decided to step down to fix this.',
      postedAt: '2024-01-01',
    })

    expect(
      await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, {
        excerpt: 'I decided to step down to fix this.',
        emphasis: 'step down',
      }),
    ).toEqual({ ok: true })

    const row = (await getShotSlot(db, slotId))!
    const brief = row.brief as unknown as { excerpt?: string; emphasis?: string }
    expect(brief.excerpt).toBe('I decided to step down to fix this.')
    expect(brief.emphasis).toBe('step down')
  })

  it('refuses a highlight longer than a brief may hold, in plain words, and writes nothing', async () => {
    const phrase = 'word '.repeat(24) + 'end.'
    expect(phrase.length).toBe(124)
    const highlight = phrase.slice(0, 121)
    await setSocialPostManual(db, POST_URL, {
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text: `Before it: ${phrase} After it.`,
      postedAt: '2024-01-01',
    })

    expect(await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, { emphasis: highlight })).toEqual(
      { ok: false, error: 'A highlight can be at most 120 characters.' },
    )
    // The slot is still readable, so nothing short of a re-plan is needed.
    const row = (await getShotSlot(db, slotId))!
    expect((row.brief as { emphasis?: string }).emphasis).toBeUndefined()
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('refuses an excerpt longer than a brief may hold, in plain words', async () => {
    const text = 'All of these words are the post. '.repeat(70).trim()
    expect(text.length).toBeGreaterThan(2000)
    await setSocialPostManual(db, POST_URL, {
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text,
      postedAt: '2024-01-01',
    })

    expect(await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, { excerpt: text })).toEqual({
      ok: false,
      error: 'An excerpt can be at most 2,000 characters.',
    })
    const row = (await getShotSlot(db, slotId))!
    expect((row.brief as { excerpt?: string }).excerpt).toBeUndefined()
  })

  it('drops both pictures when the address moves to another account’s post', async () => {
    await setSocialPostManual(db, POST_URL, { handle: 'EMostaque' })
    await finaliseUpload(slotId, 'social-avatar')
    await finaliseUpload(slotId, 'social-image')
    inngest.send.mockClear()

    const other = 'https://x.com/AnotherHandle/status/9990000000000000009'
    expect(await setSocialPostAction(FIXTURE_PROJECT_ID, slotId, other)).toEqual({ ok: true })

    const brief = (await getShotSlot(db, slotId))!.brief as {
      avatarAssetId?: string
      mediaAssetId?: string
    }
    expect(brief.mediaAssetId).toBeUndefined()
    expect(brief.avatarAssetId).toBeUndefined()
  })

  it('keeps the profile picture, but not the image, for another post by the same account', async () => {
    await setSocialPostManual(db, POST_URL, { handle: 'EMostaque' })
    await finaliseUpload(slotId, 'social-avatar')
    await finaliseUpload(slotId, 'social-image')
    const avatarAssetId = ((await getShotSlot(db, slotId))!.brief as { avatarAssetId?: string })
      .avatarAssetId
    expect(avatarAssetId).toBeDefined()

    // The same account, typed in a different case.
    const sameAccount = 'https://x.com/emostaque/status/9990000000000000010'
    expect(await setSocialPostAction(FIXTURE_PROJECT_ID, slotId, sameAccount)).toEqual({
      ok: true,
    })

    const brief = (await getShotSlot(db, slotId))!.brief as {
      avatarAssetId?: string
      mediaAssetId?: string
    }
    expect(brief.mediaAssetId).toBeUndefined()
    expect(brief.avatarAssetId).toBe(avatarAssetId)
  })

  it('unlinks a cast member’s handle and judges the slot again', async () => {
    for (const existing of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, existing.id)
    }
    const member = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    expect(await linkCastHandleAction(FIXTURE_PROJECT_ID, member.id, 'EMostaque')).toEqual({
      ok: true,
    })
    inngest.send.mockClear()

    expect(await unlinkCastHandleAction(FIXTURE_PROJECT_ID, member.id, slotId)).toEqual({
      ok: true,
    })
    const row = (await listCastMembers(db, FIXTURE_PROJECT_ID)).find(({ id }) => id === member.id)
    expect(row?.xHandle).toBeNull()
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({
      name: 'visuals/refetch.requested',
      data: { projectId: FIXTURE_PROJECT_ID, slotId, note: 'Cast link removed' },
    })
    await deleteCastMember(db, member.id)
  })

  it('refuses a patch that would leave the stored highlight outside the new excerpt, and writes nothing', async () => {
    const text =
      'As my notifications are RIP some notes: I decided to step down. My shares were worth $101m at the peak.'
    await setSocialPostManual(db, POST_URL, {
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text,
      postedAt: '2024-01-01',
    })
    expect(await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, { emphasis: '$101m' })).toEqual({
      ok: true,
    })

    // Touches only the excerpt; the stored highlight is left in place by the
    // patch, but it does not survive inside this excerpt.
    const excerptWithoutFigure = 'As my notifications are RIP some notes: I decided to step down.'
    expect(
      await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, { excerpt: excerptWithoutFigure }),
    ).toEqual({ ok: false, error: SOCIAL_HIGHLIGHT_OUTSIDE })

    const row = (await getShotSlot(db, slotId))!
    const brief = row.brief as unknown as { excerpt?: string; emphasis?: string }
    expect(brief.excerpt).toBeUndefined()
    expect(brief.emphasis).toBe('$101m')
  })

  it('clears the excerpt while a stored highlight still fits the full text', async () => {
    const text =
      'As my notifications are RIP some notes: I decided to step down. My shares were worth $101m at the peak.'
    await setSocialPostManual(db, POST_URL, {
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text,
      postedAt: '2024-01-01',
    })
    expect(
      await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, {
        excerpt: 'As my notifications are RIP some notes: I decided to step down.',
        emphasis: 'RIP some notes',
      }),
    ).toEqual({ ok: true })

    expect(await saveSocialCardAction(FIXTURE_PROJECT_ID, slotId, { excerpt: null })).toEqual({
      ok: true,
    })

    const row = (await getShotSlot(db, slotId))!
    const brief = row.brief as unknown as { excerpt?: string; emphasis?: string }
    expect(brief.excerpt).toBeUndefined()
    expect(brief.emphasis).toBe('RIP some notes')
  })

  it('surfaces the reason a re-read refuses, leaving the stored post untouched', async () => {
    await setSocialPostManual(db, POST_URL, {
      authorName: 'Emad Mostaque',
      handle: 'EMostaque',
      text: 'Original words nobody has corrected away.',
      postedAt: '2024-01-01',
    })
    socialSource.refetchPost.mockRejectedValueOnce(
      new Error('X says this post does not exist or is not public.'),
    )

    expect(await refetchSocialPostAction(FIXTURE_PROJECT_ID, slotId)).toEqual({
      ok: false,
      error: 'X says this post does not exist or is not public.',
    })
    expect((await getSocialPost(db, POST_URL))?.text).toBe(
      'Original words nobody has corrected away.',
    )
  })

  it('re-fetches through the board’s own resolve path on a successful re-read', async () => {
    socialSource.refetchPost.mockResolvedValueOnce({
      url: POST_URL,
      platform: 'x',
      postId: '1740000000000000001',
      handle: 'EMostaque',
      authorName: 'Emad Mostaque',
      text: 'Freshly read words.',
      postedAt: '2024-01-01',
      endedWithMediaLink: false,
      provenance: { authorName: 'oembed', handle: 'oembed', text: 'oembed', postedAt: 'oembed' },
      status: 'fetched',
      failureReason: null,
    })

    expect(await refetchSocialPostAction(FIXTURE_PROJECT_ID, slotId)).toEqual({ ok: true })
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({
      name: 'visuals/refetch.requested',
      data: { projectId: FIXTURE_PROJECT_ID, slotId, note: 'Post re-read' },
    })
  })

  // The old bug: `postIsRenderable` only checks for missing fields, so a
  // "Read again" on a post too long for the card, with no excerpt, used to
  // stamp the slot resolved on the strength of those fields alone. The fix
  // hands readiness entirely to the board's own resolve path instead, so no
  // status is written here at all.
  it('does not mark a too-long, excerpt-less post resolved on the strength of its fields alone', async () => {
    const tooLong = 'A long word. '.repeat(200).trim()
    socialSource.refetchPost.mockResolvedValueOnce({
      url: POST_URL,
      platform: 'x',
      postId: '1740000000000000001',
      handle: 'EMostaque',
      authorName: 'Emad Mostaque',
      text: tooLong,
      postedAt: '2024-01-01',
      endedWithMediaLink: false,
      provenance: { authorName: 'oembed', handle: 'oembed', text: 'oembed', postedAt: 'oembed' },
      status: 'fetched',
      failureReason: null,
    })

    expect(await refetchSocialPostAction(FIXTURE_PROJECT_ID, slotId)).toEqual({ ok: true })
    expect((await getShotSlot(db, slotId))?.status).not.toBe('resolved')
  })

  it('removes the avatar image without touching anything else on the brief, re-resolving both the upload and the removal', async () => {
    await finaliseUpload(slotId, 'social-avatar')
    expect(
      ((await getShotSlot(db, slotId))!.brief as { avatarAssetId?: string }).avatarAssetId,
    ).toBeDefined()
    // The uploaded image changes the room left for the post's text, so the
    // slot is judged again rather than left at whatever it said before.
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({
      name: 'visuals/refetch.requested',
      data: { projectId: FIXTURE_PROJECT_ID, slotId, note: 'Post image uploaded' },
    })
    inngest.send.mockClear()

    expect(await removeSocialImageAction(FIXTURE_PROJECT_ID, slotId, 'avatar')).toEqual({
      ok: true,
    })
    const row = (await getShotSlot(db, slotId))!
    expect((row.brief as { avatarAssetId?: string }).avatarAssetId).toBeUndefined()
    expect((row.brief as { postUrl: string }).postUrl).toBe(POST_URL)
    // Removing it is the same kind of change, the other way.
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({
      name: 'visuals/refetch.requested',
      data: { projectId: FIXTURE_PROJECT_ID, slotId, note: 'Post image removed' },
    })
  })

  async function finaliseUpload(
    id: string,
    purpose: 'social-avatar' | 'social-image',
  ): Promise<void> {
    storage.configured = true
    vi.mocked(headObject).mockResolvedValue({ size: 12_345, contentType: 'image/png' })
    const result = await finaliseOwnUploadAction({
      projectId: FIXTURE_PROJECT_ID,
      slotId: id,
      fileType: 'image/png',
      fileName: 'avatar.png',
      contentHash: 'c'.repeat(64),
      purpose,
    })
    expect(result).toEqual({ ok: true })
  }

  it('writes the uploaded avatar and attached image onto the brief, never the candidate strip', async () => {
    await finaliseUpload(slotId, 'social-avatar')
    const withAvatar = (await getShotSlot(db, slotId))!
    expect((withAvatar.brief as { avatarAssetId?: string }).avatarAssetId).toBeDefined()
    expect(withAvatar.candidates).toEqual([])

    await finaliseUpload(slotId, 'social-image')
    const withMedia = (await getShotSlot(db, slotId))!
    expect((withMedia.brief as { mediaAssetId?: string }).mediaAssetId).toBeDefined()
    expect(withMedia.candidates).toEqual([])
  })

  it('refuses a social-purpose upload on a slot that is not a post card', async () => {
    storage.configured = true
    vi.mocked(headObject).mockResolvedValue({ size: 12_345, contentType: 'image/png' })
    expect(
      await finaliseOwnUploadAction({
        projectId: FIXTURE_PROJECT_ID,
        slotId: stockId,
        fileType: 'image/png',
        fileName: 'avatar.png',
        contentHash: 'd'.repeat(64),
        purpose: 'social-avatar',
      }),
    ).toEqual({ ok: false, error: 'This is not a post slot.' })
  })
})

describeDb('re-typing to a social post card (decision 284)', () => {
  let stockId: string
  const POST_CLAIM_ID = fixtureId('CLAIM', 40)

  beforeEach(async () => {
    vi.clearAllMocks()
    inngest.send.mockResolvedValue(undefined)
    await seed(db)
    await db.delete(shotSlots)
    await db
      .insert(claims)
      .values({
        id: POST_CLAIM_ID,
        dossierId: FIXTURE_DOSSIER_ID,
        text: 'Emad Mostaque announced his resignation on X.',
        sourceUrl: 'https://x.com/EMostaque/status/1740000000000000002',
        sourceType: 'other',
        confidence: 'sourced',
      })
      .onConflictDoNothing()
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The resignation',
      contentMd: 'One.',
      estRuntimeSec: 6,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: stock('One.', 'a phone screen'),
        startMs: 0,
        durationMs: 6000,
      },
    ])
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    stockId = slots[0]!.id
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
  })

  it('refuses a claim with no X post behind it', async () => {
    // fixtureId('CLAIM', 2) is the Wirecard FT article claim seed() writes.
    expect(await retypeToSocialAction(FIXTURE_PROJECT_ID, stockId, fixtureId('CLAIM', 2))).toEqual({
      ok: false,
      error: 'That claim has no X post behind it, so a card cannot show it.',
    })
  })

  it('converts the slot and re-fetches the post', async () => {
    expect(await retypeToSocialAction(FIXTURE_PROJECT_ID, stockId, POST_CLAIM_ID)).toEqual({
      ok: true,
    })
    const row = (await getShotSlot(db, stockId))!
    expect(row.type).toBe('social')
    const brief = row.brief as unknown as { sourceClaimId: string; postUrl: string }
    expect(brief.sourceClaimId).toBe(POST_CLAIM_ID)
    expect(brief.postUrl).toBe('https://x.com/i/status/1740000000000000002')
    expect(inngest.send.mock.calls[0]?.[0]).toMatchObject({ name: 'visuals/refetch.requested' })
  })

  // Amended 2026-09-30: a pasted post may be filed under any claim, and the
  // claim keeps the source it was verified against.
  it('shows a pasted post under a claim sourced to an article, leaving that source alone', async () => {
    const articleClaim = fixtureId('CLAIM', 2)
    const before = (await scriptableClaims(db, FIXTURE_PROJECT_ID)).find(
      (row) => row.id === articleClaim,
    )!
    expect(
      await retypeToSocialAction(
        FIXTURE_PROJECT_ID,
        stockId,
        articleClaim,
        'https://twitter.com/EMostaque/status/1771400218170519741?s=20',
      ),
    ).toEqual({ ok: true })

    const row = (await getShotSlot(db, stockId))!
    expect(row.type).toBe('social')
    const brief = row.brief as unknown as { sourceClaimId: string; postUrl: string }
    expect(brief.sourceClaimId).toBe(articleClaim)
    expect(brief.postUrl).toBe('https://x.com/i/status/1771400218170519741')

    const after = (await scriptableClaims(db, FIXTURE_PROJECT_ID)).find(
      (row) => row.id === articleClaim,
    )!
    expect(after.sourceUrl).toBe(before.sourceUrl)
  })

  it('refuses a pasted address that is not a post, before touching the slot', async () => {
    expect(
      await retypeToSocialAction(
        FIXTURE_PROJECT_ID,
        stockId,
        fixtureId('CLAIM', 2),
        'https://x.com/EMostaque',
      ),
    ).toEqual({ ok: false, error: NOT_A_POST_ERROR })
    expect((await getShotSlot(db, stockId))!.type).toBe('stock')
  })

  it('refuses a claim that is not in this project', async () => {
    expect(
      await retypeToSocialAction(
        FIXTURE_PROJECT_ID,
        stockId,
        fixtureId('CLAIM', 99),
        'https://x.com/EMostaque/status/1771400218170519741',
      ),
    ).toEqual({ ok: false, error: 'That claim is no longer in this project’s dossier.' })
  })

  it('moves a card to a different pasted post under the same claim', async () => {
    await retypeToSocialAction(FIXTURE_PROJECT_ID, stockId, POST_CLAIM_ID)
    expect(
      await retypeToSocialAction(
        FIXTURE_PROJECT_ID,
        stockId,
        POST_CLAIM_ID,
        'https://x.com/jack/status/20',
      ),
    ).toEqual({ ok: true })
    const brief = (await getShotSlot(db, stockId))!.brief as unknown as { postUrl: string }
    expect(brief.postUrl).toBe('https://x.com/i/status/20')
  })
})

describeDb("linking a cast member's X handle (decision 284)", () => {
  let memberId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    for (const member of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, member.id)
    }
    const member = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    memberId = member.id
  })

  it('saves the handle on a member of this project', async () => {
    expect(await linkCastHandleAction(FIXTURE_PROJECT_ID, memberId, '@EMostaque')).toEqual({
      ok: true,
    })
    const [row] = await listCastMembers(db, FIXTURE_PROJECT_ID)
    expect(row?.xHandle).toBe('emostaque')
  })

  it('refuses a member from another project', async () => {
    expect(await linkCastHandleAction('01J0000000000000000000000Z', memberId, 'EMostaque')).toEqual(
      { ok: false, error: 'This cast member belongs to another film.' },
    )
  })

  it('refuses something that is not an X handle', async () => {
    expect(await linkCastHandleAction(FIXTURE_PROJECT_ID, memberId, 'not a handle')).toEqual({
      ok: false,
      error: 'That is not a valid X handle.',
    })
  })

  describe('unlinking', () => {
    const SLOT = '01J000000000000000000000AA'

    beforeEach(async () => {
      await linkCastHandleAction(FIXTURE_PROJECT_ID, memberId, 'EMostaque')
    })

    it('clears the handle on a member of this project', async () => {
      expect(await unlinkCastHandleAction(FIXTURE_PROJECT_ID, memberId, SLOT)).toEqual({
        ok: true,
      })
      const [row] = await listCastMembers(db, FIXTURE_PROJECT_ID)
      expect(row?.xHandle).toBeNull()
    })

    it('refuses a member from another project, leaving the link alone', async () => {
      expect(await unlinkCastHandleAction('01J0000000000000000000000Z', memberId, SLOT)).toEqual({
        ok: false,
        error: 'This cast member belongs to another film.',
      })
      const [row] = await listCastMembers(db, FIXTURE_PROJECT_ID)
      expect(row?.xHandle).toBe('emostaque')
    })

    it('refuses a member that no longer exists', async () => {
      expect(
        await unlinkCastHandleAction(FIXTURE_PROJECT_ID, '01J0000000000000000000000Y', SLOT),
      ).toEqual({ ok: false, error: 'This cast member no longer exists.' })
    })
  })
})
