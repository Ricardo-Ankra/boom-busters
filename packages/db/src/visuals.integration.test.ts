import type { DirectorsBook, ShotBrief, SlotCandidate } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import { createProjectFromCase, getProject, setProjectDirection } from './projects'
import { createScriptVersion, saveChapter } from './scripts'
import { requireTestDatabase } from './test-database'
import {
  chooseSlotCandidate,
  copyReusedShots,
  getAsset,
  getShotSlot,
  linkSlotReuse,
  listShotSlots,
  listSlotDependants,
  replaceShotList,
  retypeShotSlot,
  setSlotRefusal,
  setSlotResolution,
  setSlotRetype,
  setSlotRoute,
  shotBriefHash,
  shotSlotStatuses,
  slotNeedsResolution,
  unlinkSlotReuse,
  updateSlotBrief,
  upsertAssetByHash,
} from './visuals'

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('shot slots', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''
  let chapterA = ''
  let chapterB = ''

  /**
   * The snapshot a resolved outcome carries (decision 264): the slot as the
   * resolver read it before it went to work. Read from the row here, the way
   * every production caller does.
   */
  async function answering(slotId: string): Promise<{ brief: unknown; route: unknown }> {
    const row = (await getShotSlot(db, slotId))!
    return { brief: row.brief, route: row.route }
  }

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncateCases(db)
    const source = await createCase(db, { title: 'Wirecard', category: 'con' })
    const project = await createProjectFromCase(db, { caseId: source.id, title: 'Wirecard' })
    projectId = project.id
    const script = await createScriptVersion(db, projectId)
    // Chapter B saved FIRST so listing order provably follows chapter index,
    // not insertion order or ULID order.
    chapterB = (
      await saveChapter(db, {
        scriptId: script.id,
        index: 1,
        title: 'The collapse',
        contentMd: 'Second chapter.',
        estRuntimeSec: 30,
      })
    ).id
    chapterA = (
      await saveChapter(db, {
        scriptId: script.id,
        index: 0,
        title: 'The audit',
        contentMd: 'First chapter.',
        estRuntimeSec: 30,
      })
    ).id
  })

  const stockBrief: ShotBrief = {
    type: 'stock',
    coversText: 'By June, the auditors could not find the money.',
    description: 'Deserted open-plan office at dusk.',
    motion: { kind: 'static' },
    transition: 'cut',
    query: 'empty office dusk',
    rejectionCriteria: [],
  }

  function slots() {
    return [
      {
        chapterId: chapterB,
        index: 0,
        type: 'stock' as const,
        brief: stockBrief,
        startMs: 0,
        durationMs: 8000,
      },
      {
        chapterId: chapterA,
        index: 0,
        type: 'stock' as const,
        brief: stockBrief,
        startMs: 0,
        durationMs: 6000,
      },
      {
        chapterId: chapterA,
        index: 1,
        type: 'stock' as const,
        brief: stockBrief,
        startMs: 6000,
        durationMs: 5000,
      },
    ]
  }

  const candidate = (id: string, extra: Partial<SlotCandidate> = {}): SlotCandidate => ({
    id,
    provider: 'pexels',
    kind: 'image',
    sourceUrl: `https://images.pexels.com/${id}.jpg`,
    licence: 'Pexels License',
    ...extra,
  })

  it('lists the board in script order — chapter index, then slot index', async () => {
    await replaceShotList(db, projectId, slots())
    const board = await listShotSlots(db, projectId)

    expect(board.map((slot) => [slot.chapterIndex, slot.index])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ])
    expect(board[0]?.chapterTitle).toBe('The audit')
    expect(board.every((slot) => slot.status === 'unresolved')).toBe(true)
  })

  it('replaces the whole board on a re-run, never interleaving plans', async () => {
    await replaceShotList(db, projectId, slots())
    await replaceShotList(db, projectId, [
      {
        chapterId: chapterA,
        index: 0,
        type: 'still',
        brief: stockBrief,
        startMs: 0,
        durationMs: 4000,
      },
    ])

    const board = await listShotSlots(db, projectId)
    expect(board).toHaveLength(1)
    expect(board[0]?.type).toBe('still')
  })

  it('stores a resolution: candidates, status, and the chosen flag', async () => {
    await replaceShotList(db, projectId, slots())
    const [slot] = await listShotSlots(db, projectId)

    await setSlotResolution(db, slot!.id, {
      candidates: [candidate('a1', { score: 90, chosen: true }), candidate('b2', { score: 40 })],
      status: 'resolved',
      answered: await answering(slot!.id),
    })

    const stored = await getShotSlot(db, slot!.id)
    expect(stored?.status).toBe('resolved')
    const stateful = stored?.candidates as unknown as SlotCandidate[]
    expect(stateful.find((entry) => entry.chosen)?.id).toBe('a1')
  })

  it('swaps the choice with one call and keeps exactly one candidate chosen', async () => {
    await replaceShotList(db, projectId, slots())
    const [slot] = await listShotSlots(db, projectId)
    await setSlotResolution(db, slot!.id, {
      candidates: [candidate('a1', { chosen: true }), candidate('b2')],
      status: 'resolved',
      answered: await answering(slot!.id),
    })

    const updated = await chooseSlotCandidate(db, slot!.id, 'b2')
    const stateful = updated?.candidates as unknown as SlotCandidate[]
    expect(stateful.filter((entry) => entry.chosen).map((entry) => entry.id)).toEqual(['b2'])
  })

  it('refuses to choose a candidate the slot does not hold', async () => {
    await replaceShotList(db, projectId, slots())
    const [slot] = await listShotSlots(db, projectId)
    expect(await chooseSlotCandidate(db, slot!.id, 'nope')).toBeUndefined()
  })

  it('re-opens a slot when its brief is edited, keeping the stale candidates visible', async () => {
    await replaceShotList(db, projectId, slots())
    const [slot] = await listShotSlots(db, projectId)
    await setSlotResolution(db, slot!.id, {
      candidates: [candidate('a1', { chosen: true })],
      status: 'resolved',
      answered: await answering(slot!.id),
    })

    await updateSlotBrief(db, slot!.id, { ...stockBrief, query: 'abandoned trading floor' })

    const stored = await getShotSlot(db, slot!.id)
    expect(stored?.status).toBe('unresolved')
    expect((stored?.brief as { query?: string }).query).toBe('abandoned trading floor')
    expect(stored?.candidates).toHaveLength(1)
  })

  it('stores a refusal, and a brief edit clears it (decision 252)', async () => {
    await replaceShotList(db, projectId, slots())
    const [slot] = await listShotSlots(db, projectId)
    await setSlotRefusal(db, slot!.id, {
      reason: 'google: SAFETY',
      at: new Date().toISOString(),
    })
    expect((await getShotSlot(db, slot!.id))?.refusal).toMatchObject({ reason: 'google: SAFETY' })

    await updateSlotBrief(db, slot!.id, { ...stockBrief, query: 'the empty podium' })
    expect((await getShotSlot(db, slot!.id))?.refusal).toBeNull()
  })

  it('stores, replaces and clears the Director’s Book on the project (decision 252)', async () => {
    const book: DirectorsBook = {
      visualThesis: 'Solid from the street, hollow inside.',
      eraLocks: [{ span: '2011 to 2020', rules: 'flat screens, glass offices' }],
      palette: { accent: '#c9a227', temperature: 'cold', note: 'gold on money only' },
      motifs: ['dark glass', 'empty chairs', 'pages under lamplight'],
      anchorObject: 'a bound annual report',
      neverShow: [],
      principals: [],
      locations: [],
      chapters: [
        {
          chapter: 1,
          dominantShotFamily: 'environment',
          moodShift: 'confident to uneasy',
          keyImage: 'the empty stage',
        },
      ],
      finalImage: 'one lit floor at night',
    }
    await setProjectDirection(db, projectId, book)
    expect((await getProject(db, projectId))?.direction).toMatchObject({ motifs: book.motifs })

    await setProjectDirection(db, projectId, null)
    expect((await getProject(db, projectId))?.direction).toBeNull()
  })

  it('counts statuses without loading briefs', async () => {
    await replaceShotList(db, projectId, slots())
    const board = await listShotSlots(db, projectId)
    await setSlotResolution(db, board[0]!.id, { candidates: [], status: 'placeholder' })

    const statuses = await shotSlotStatuses(db, projectId)
    expect(statuses.filter((row) => row.status === 'placeholder')).toHaveLength(1)
    expect(statuses.filter((row) => row.status === 'unresolved')).toHaveLength(2)
  })

  it('stamps, replaces and clears a re-type state', async () => {
    await replaceShotList(db, projectId, slots())
    const [slot] = await listShotSlots(db, projectId)

    await setSlotRetype(db, slot!.id, { state: 'drafting', target: 'chart' })
    expect((await getShotSlot(db, slot!.id))?.retype).toEqual({
      state: 'drafting',
      target: 'chart',
    })

    await setSlotRetype(db, slot!.id, {
      state: 'refused',
      target: 'chart',
      reason: 'No usable numbers in the claims.',
    })
    expect((await getShotSlot(db, slot!.id))?.retype).toMatchObject({ state: 'refused' })

    await setSlotRetype(db, slot!.id, null)
    expect((await getShotSlot(db, slot!.id))?.retype).toBeNull()
  })

  it('a re-type clears the pending state along with the old resolution', async () => {
    await replaceShotList(db, projectId, slots())
    const [slot] = await listShotSlots(db, projectId)
    await setSlotResolution(db, slot!.id, {
      candidates: [candidate('a1', { chosen: true })],
      status: 'resolved',
      answered: await answering(slot!.id),
    })
    await setSlotRetype(db, slot!.id, { state: 'drafting', target: 'still' })

    await retypeShotSlot(db, slot!.id, 'still', {
      type: 'still',
      coversText: stockBrief.coversText,
      description: stockBrief.description,
      motion: { kind: 'static' },
      transition: 'cut',
      prompt: 'Deserted office at dusk, painterly.',
    })

    const stored = await getShotSlot(db, slot!.id)
    expect(stored?.type).toBe('still')
    expect(stored?.status).toBe('unresolved')
    expect(stored?.candidates).toEqual([])
    expect(stored?.chosenAssetId).toBeNull()
    expect(stored?.resolvedBriefHash).toBeNull()
    // The write IS the pending re-type's answer — nothing left to show.
    expect(stored?.retype).toBeNull()
  })

  describe('reusing a shot (decision 261)', () => {
    const stillBrief: ShotBrief = {
      type: 'still',
      coversText: 'Braun stood at the podium.',
      description: 'A podium, one light.',
      motion: { kind: 'static' },
      transition: 'cut',
      prompt: 'Markus Braun at a podium, 35mm.',
      depicts: ['Markus Braun'],
    }

    async function twoSlots() {
      await replaceShotList(db, projectId, slots())
      const [source, dependant] = await listShotSlots(db, projectId)
      return { source: source!, dependant: dependant! }
    }

    it('links before Fetch, and the fetch guard owes the linked slot nothing', async () => {
      const { source, dependant } = await twoSlots()
      expect(await linkSlotReuse(db, dependant.id, source.id)).toEqual({ copied: false })
      const linked = (await getShotSlot(db, dependant.id))!
      expect(linked.reuseOfSlotId).toBe(source.id)
      expect(linked.status).toBe('unresolved')
      expect(linked.candidates).toEqual([])
      expect(slotNeedsResolution(linked)).toBe(false)
    })

    it('copies the source’s chosen shot after the pass, once, pointing at its asset', async () => {
      const { source, dependant } = await twoSlots()
      await linkSlotReuse(db, dependant.id, source.id)
      const asset = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: 'boom-busters/stills/p1.png',
        licence: 'Generated',
        contentHash: 'c'.repeat(64),
      })
      await setSlotResolution(db, source.id, {
        candidates: [
          candidate('p1', { chosen: true, assetId: asset.id, score: 91, scoreReason: 'fits' }),
          candidate('p2'),
        ],
        status: 'resolved',
        chosenAssetId: asset.id,
        answered: await answering(source.id),
      })

      expect(await copyReusedShots(db, projectId)).toEqual({ copied: 1, placeholders: 0 })
      const after = (await getShotSlot(db, dependant.id))!
      expect(after.status).toBe('resolved')
      expect(after.chosenAssetId).toBe(asset.id)
      expect(after.resolvedBriefHash).toBe(shotBriefHash(after.brief))
      const [copy, ...rest] = after.candidates as unknown as SlotCandidate[]
      expect(rest).toEqual([])
      expect(copy).toMatchObject({
        id: 'p1',
        chosen: true,
        assetId: asset.id,
        reusedFrom: { slotId: source.id },
      })
      // The score was against the source's brief, so it does not travel.
      expect(copy?.score).toBeUndefined()
      // Idempotent: a second pass leaves the copy alone.
      expect(await copyReusedShots(db, projectId)).toEqual({ copied: 0, placeholders: 0 })
    })

    it('carries who a reused still depicts, for the altered-content label', async () => {
      const { source, dependant } = await twoSlots()
      await retypeShotSlot(db, source.id, 'still', stillBrief)
      await setSlotResolution(db, source.id, {
        candidates: [candidate('g1', { provider: 'google', chosen: true })],
        status: 'resolved',
        answered: await answering(source.id),
      })
      expect(await linkSlotReuse(db, dependant.id, source.id, 'g1')).toEqual({ copied: true })
      const [copy] = (await getShotSlot(db, dependant.id))!.candidates as unknown as SlotCandidate[]
      expect(copy?.reusedFrom).toEqual({ slotId: source.id, depicts: ['Markus Braun'] })
    })

    it('leaves a dependant a placeholder when its source has nothing chosen', async () => {
      const { source, dependant } = await twoSlots()
      await linkSlotReuse(db, dependant.id, source.id)
      await setSlotResolution(db, source.id, { candidates: [], status: 'placeholder' })
      expect(await copyReusedShots(db, projectId)).toEqual({ copied: 0, placeholders: 1 })
      expect((await getShotSlot(db, dependant.id))?.status).toBe('placeholder')
    })

    it('copies at once when a candidate is named, and refuses one the source does not hold', async () => {
      const { source, dependant } = await twoSlots()
      await setSlotResolution(db, source.id, {
        candidates: [candidate('p1', { chosen: true }), candidate('p2')],
        status: 'resolved',
        answered: await answering(source.id),
      })
      expect(await linkSlotReuse(db, dependant.id, source.id, 'nope')).toBeNull()
      expect(await linkSlotReuse(db, dependant.id, source.id, 'p2')).toEqual({ copied: true })
      const after = (await getShotSlot(db, dependant.id))!
      expect(after.status).toBe('resolved')
      expect((after.candidates as unknown as SlotCandidate[])[0]).toMatchObject({
        id: 'p2',
        chosen: true,
        reusedFrom: { slotId: source.id },
      })
    })

    it('a brief edit keeps a linked slot resolved, and still re-opens an ordinary one', async () => {
      const { source, dependant } = await twoSlots()
      await setSlotResolution(db, source.id, {
        candidates: [candidate('p1', { chosen: true })],
        status: 'resolved',
        answered: await answering(source.id),
      })
      await linkSlotReuse(db, dependant.id, source.id, 'p1')
      await updateSlotBrief(db, dependant.id, { ...stockBrief, description: 'new words' })
      await updateSlotBrief(db, source.id, { ...stockBrief, description: 'new words' })
      expect((await getShotSlot(db, dependant.id))?.status).toBe('resolved')
      expect((await getShotSlot(db, source.id))?.status).toBe('unresolved')
    })

    it('fills a two-step chain in one pass, whatever order the rows arrive in', async () => {
      await replaceShotList(db, projectId, slots())
      const [a, b, c] = await listShotSlots(db, projectId)
      await setSlotResolution(db, c!.id, {
        candidates: [candidate('p1', { chosen: true })],
        status: 'resolved',
        answered: await answering(c!.id),
      })
      // Built directly, past the action layer's refusal, so the write is
      // proved right on its own.
      await linkSlotReuse(db, b!.id, a!.id)
      await linkSlotReuse(db, a!.id, c!.id)

      expect(await copyReusedShots(db, projectId)).toEqual({ copied: 2, placeholders: 0 })
      for (const id of [a!.id, b!.id]) {
        const row = (await getShotSlot(db, id))!
        expect(row.status).toBe('resolved')
        expect((row.candidates as unknown as SlotCandidate[])[0]).toMatchObject({
          id: 'p1',
          chosen: true,
        })
      }
      expect(await listSlotDependants(db, a!.id)).toHaveLength(1)
      expect(await listSlotDependants(db, b!.id)).toHaveLength(0)
    })

    it('unlinking gives the slot its own fetch back', async () => {
      const { source, dependant } = await twoSlots()
      await setSlotResolution(db, source.id, {
        candidates: [candidate('p1', { chosen: true })],
        status: 'resolved',
        answered: await answering(source.id),
      })
      await linkSlotReuse(db, dependant.id, source.id, 'p1')
      await unlinkSlotReuse(db, dependant.id)
      const after = (await getShotSlot(db, dependant.id))!
      expect(after).toMatchObject({
        reuseOfSlotId: null,
        status: 'unresolved',
        chosenAssetId: null,
        resolvedBriefHash: null,
        candidates: [],
      })
      expect(slotNeedsResolution(after)).toBe(true)
    })
  })

  async function onlySlot() {
    await replaceShotList(db, projectId, [
      {
        chapterId: chapterA,
        index: 0,
        type: 'still' as const,
        brief: {
          type: 'still',
          coversText: stockBrief.coversText,
          description: stockBrief.description,
          motion: { kind: 'static' },
          transition: 'cut',
          prompt: 'Deserted office at dusk, painterly.',
        },
        startMs: 0,
        durationMs: 6000,
      },
    ])
    const [slot] = await listShotSlots(db, projectId)
    return slot!
  }

  describe('the route a slot generates on', () => {
    it('changing the route makes a resolved slot owe work again', async () => {
      const slot = await onlySlot()
      await setSlotResolution(db, slot.id, {
        status: 'resolved',
        candidates: [],
        answered: await answering(slot.id),
      })
      expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(false)

      await setSlotRoute(db, slot.id, { provider: 'google', model: 'gemini-3-pro-image' })
      expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(true)
    })

    it('clearing the route back to null makes it owe work again too', async () => {
      const slot = await onlySlot()
      await setSlotRoute(db, slot.id, { provider: 'google', model: 'gemini-3-pro-image' })
      await setSlotResolution(db, slot.id, {
        status: 'resolved',
        candidates: [],
        answered: await answering(slot.id),
      })
      expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(false)

      await setSlotRoute(db, slot.id, null)
      expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(true)
    })

    it('a brief edit leaves the route alone', async () => {
      const slot = await onlySlot()
      const route = { provider: 'google' as const, model: 'gemini-3-pro-image' }
      await setSlotRoute(db, slot.id, route)
      await updateSlotBrief(db, slot.id, { ...(slot.brief as ShotBrief), description: 'new words' })
      expect((await getShotSlot(db, slot.id))?.route).toEqual(route)
    })

    it('a resolve that answers an older brief leaves the slot owing work', async () => {
      // The snapshot is the caller's, not the row's (decision 264): a brief
      // edited while the candidates were being fetched must not be stamped
      // as answered by a fetch that never saw it.
      const slot = await onlySlot()
      const answeredBefore = await answering(slot.id)
      await updateSlotBrief(db, slot.id, {
        ...(slot.brief as ShotBrief),
        description: 'the owner changed it mid-fetch',
      })

      await setSlotResolution(db, slot.id, {
        status: 'resolved',
        candidates: [],
        answered: answeredBefore,
      })
      expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(true)
    })

    it('a slot with no route hashes exactly as it did before routes existed', () => {
      const brief = { type: 'still', prompt: 'p' }
      expect(shotBriefHash(brief)).toBe(shotBriefHash(brief, null))
      expect(shotBriefHash(brief)).not.toBe(
        shotBriefHash(brief, { provider: 'google', model: 'gemini-3-pro-image' }),
      )
    })
  })
})

suite('assets', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('dedupes on contentHash — same bytes, one row, metadata refreshed', async () => {
    const first = await upsertAssetByHash(db, {
      kind: 'image',
      r2Key: 'boom-busters/stills/abc.png',
      licence: 'generated',
      contentHash: 'hash-abc',
    })
    const second = await upsertAssetByHash(db, {
      kind: 'image',
      r2Key: 'boom-busters/stills/abc-again.png',
      licence: 'generated (FLUX.1 dev)',
      contentHash: 'hash-abc',
    })

    expect(second.id).toBe(first.id)
    // The bytes are identical, so the original key survives; the licence
    // string was better the second time and is kept.
    expect(second.r2Key).toBe('boom-busters/stills/abc.png')
    expect(second.licence).toBe('generated (FLUX.1 dev)')
    expect((await getAsset(db, first.id))?.licence).toBe('generated (FLUX.1 dev)')
  })
})
