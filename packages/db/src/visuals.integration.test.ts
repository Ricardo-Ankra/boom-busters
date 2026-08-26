import type { ShotBrief, SlotCandidate } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import { createProjectFromCase } from './projects'
import { createScriptVersion, saveChapter } from './scripts'
import { requireTestDatabase } from './test-database'
import {
  chooseSlotCandidate,
  getAsset,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  retypeShotSlot,
  setSlotResolution,
  setSlotRetype,
  shotSlotStatuses,
  unresolvedSlots,
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
    })

    await updateSlotBrief(db, slot!.id, { ...stockBrief, query: 'abandoned trading floor' })

    const stored = await getShotSlot(db, slot!.id)
    expect(stored?.status).toBe('unresolved')
    expect((stored?.brief as { query?: string }).query).toBe('abandoned trading floor')
    expect(stored?.candidates).toHaveLength(1)

    const owed = await unresolvedSlots(db, projectId)
    expect(owed.map((entry) => entry.id)).toContain(slot!.id)
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
