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
  setSlotJob,
  setSlotResolution,
  shotSlots,
  truncateRunMirror,
  updateSettings,
  updateSlotBrief,
  upsertAssetByHash,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import { newId } from '@boom-busters/schemas'
import type { ShotBrief, SlotCandidate } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { slotRefetcher } from './slot-refetcher'

/**
 * The slot-refetcher against the real database in mock-provider mode. Its
 * one rule of its own (decision 261): a linked slot shows another slot's
 * shot, so a refetch event for it is skipped and the copy stays.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const stock = (coversText: string): ShotBrief => ({
  type: 'stock',
  coversText,
  description: 'the lobby',
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'lobby',
  rejectionCriteria: [],
})

const candidate = (id: string, chosen = false): SlotCandidate => ({
  id,
  provider: 'pexels',
  kind: 'image',
  sourceUrl: `https://images.pexels.com/${id}.jpg`,
  licence: 'Pexels License',
  ...(chosen ? { chosen } : {}),
})

describeDb('slot-refetcher (mock mode)', () => {
  let source = ''
  let dependant = ''

  beforeEach(async () => {
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
      contentMd: 'One.\n\nTwo.',
      estRuntimeSec: 30,
    })
    const rows: NewShotSlot[] = [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: stock('One.'),
        startMs: 0,
        durationMs: 6000,
      },
      {
        chapterId: chapter.id,
        index: 1,
        type: 'stock',
        brief: stock('Two.'),
        startMs: 6000,
        durationMs: 6000,
      },
    ]
    await replaceShotList(db, FIXTURE_PROJECT_ID, rows)
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    source = slots[0]!.id
    dependant = slots[1]!.id
    const sourceRow = (await getShotSlot(db, source))!
    await setSlotResolution(db, source, {
      candidates: [candidate('p1', true)],
      status: 'resolved',
      answered: { brief: sourceRow.brief, route: sourceRow.route },
    })
    await linkSlotReuse(db, dependant, source, 'p1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('skips a linked slot and leaves its copy untouched (decision 261)', async () => {
    const engine = new InngestTestEngine({ function: slotRefetcher })
    const { result } = await engine.execute({
      events: [
        {
          name: 'visuals/refetch.requested',
          data: { projectId: FIXTURE_PROJECT_ID, slotId: dependant, note: 'Regenerate' },
        },
      ],
    })
    expect(result).toMatchObject({
      outcome: 'refetched',
      status: 'skipped',
      candidates: 0,
      reused: source,
    })
    const after = await getShotSlot(db, dependant)
    const [copy] = (after?.candidates ?? []) as unknown as SlotCandidate[]
    expect(copy).toMatchObject({ id: 'p1', chosen: true, reusedFrom: { slotId: source } })
  })

  it('still re-fetches an ordinary slot', async () => {
    const engine = new InngestTestEngine({ function: slotRefetcher })
    const { result } = await engine.execute({
      events: [
        {
          name: 'visuals/refetch.requested',
          data: { projectId: FIXTURE_PROJECT_ID, slotId: source, note: 'Regenerate' },
        },
      ],
    })
    expect(result).toMatchObject({ outcome: 'refetched', status: 'resolved' })
  })

  const refetch = (
    slotId: string,
    jobId?: string,
  ): { events: [{ name: string; data: Record<string, unknown> }] } => ({
    events: [
      {
        name: 'visuals/refetch.requested',
        data: {
          projectId: FIXTURE_PROJECT_ID,
          slotId,
          note: 'Regenerate',
          ...(jobId ? { jobId } : {}),
        },
      },
    ],
  })
  const stamp = () => ({
    kind: 'refetch' as const,
    jobId: newId(),
    startedAt: new Date().toISOString(),
  })

  it('releases its own stamp when it lands (decision 286)', async () => {
    const own = stamp()
    await setSlotJob(db, source, own)
    await new InngestTestEngine({ function: slotRefetcher }).execute(refetch(source, own.jobId))
    expect((await getShotSlot(db, source))!.pendingJob).toBeNull()
  })

  it('leaves a newer press’s stamp when it lands late', async () => {
    const late = stamp()
    const newer = stamp()
    await setSlotJob(db, source, newer)
    await new InngestTestEngine({ function: slotRefetcher }).execute(refetch(source, late.jobId))
    expect((await getShotSlot(db, source))!.pendingJob).toEqual(newer)
  })

  it('releases on the linked-slot skip too, the early return', async () => {
    const own = stamp()
    await setSlotJob(db, dependant, own)
    const { result } = await new InngestTestEngine({ function: slotRefetcher }).execute(
      refetch(dependant, own.jobId),
    )
    expect(result).toMatchObject({ status: 'skipped' })
    expect((await getShotSlot(db, dependant))!.pendingJob).toBeNull()
  })

  it('runs an event sent before job ids existed and releases nothing', async () => {
    const other = stamp()
    await setSlotJob(db, source, other)
    const { result } = await new InngestTestEngine({ function: slotRefetcher }).execute(
      refetch(source),
    )
    expect(result).toMatchObject({ outcome: 'refetched' })
    expect((await getShotSlot(db, source))!.pendingJob).toEqual(other)
  })
})

describeDb('slot-refetcher on a still: Regenerate adds, an edit replaces (decision 324)', () => {
  let slotId = ''
  // Real asset rows: the slot's chosen asset is a foreign key.
  const assetIds: Record<string, string> = {}

  const still = (prompt: string): ShotBrief => ({
    type: 'still',
    coversText: 'One.',
    description: 'the boardroom',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt,
  })

  const generated = (id: string, chosen = false): SlotCandidate => ({
    id,
    provider: 'google',
    kind: 'image',
    sourceUrl: `generated://google/${id}`,
    assetId: assetIds[id]!,
    licence: 'Generated (Gemini 3.1 Flash Image)',
    ...(chosen ? { chosen } : {}),
  })

  const regenerate = (): { events: [{ name: string; data: Record<string, unknown> }] } => ({
    events: [
      {
        name: 'visuals/refetch.requested',
        data: { projectId: FIXTURE_PROJECT_ID, slotId, note: 'Regenerate' },
      },
    ],
  })

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await updateSettings(db, { budgets: { monthlyCeilingUsd: 100, approvedOverage: null } })
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'still',
        brief: still('a boardroom at dusk'),
        startMs: 0,
        durationMs: 6000,
      },
    ])
    slotId = (await listShotSlots(db, FIXTURE_PROJECT_ID))[0]!.id
    for (const id of ['old-1', 'old-2']) {
      const asset = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: `stills/${id}.png`,
        licence: 'Generated (Gemini 3.1 Flash Image)',
        contentHash: `${id}-${newId()}`,
      })
      assetIds[id] = asset.id
    }
    const row = (await getShotSlot(db, slotId))!
    await setSlotResolution(db, slotId, {
      candidates: [generated('old-1', true), generated('old-2')],
      status: 'resolved',
      chosenAssetId: assetIds['old-1']!,
      answered: { brief: row.brief, route: row.route },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('adds the new image beside the ones already bought and keeps the pick', async () => {
    const { result } = await new InngestTestEngine({ function: slotRefetcher }).execute(
      regenerate(),
    )
    expect(result).toMatchObject({ outcome: 'refetched', status: 'resolved', candidates: 3 })

    const after = (await getShotSlot(db, slotId))!
    const candidates = after.candidates as unknown as SlotCandidate[]
    // One image a press now (STILL_GENERATIONS), ahead of the older two.
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      expect.stringMatching(/-mock-1$/),
      'old-1',
      'old-2',
    ])
    expect(candidates.filter((candidate) => candidate.chosen).map((c) => c.id)).toEqual(['old-1'])
    expect(after.chosenAssetId).toBe(assetIds['old-1'])
  })

  it('replaces images that answered words the brief no longer carries', async () => {
    await updateSlotBrief(db, slotId, still('a boardroom at dawn'))
    await new InngestTestEngine({ function: slotRefetcher }).execute(regenerate())

    const candidates = (await getShotSlot(db, slotId))!.candidates as unknown as SlotCandidate[]
    expect(candidates.map((candidate) => [candidate.id, candidate.chosen ?? false])).toEqual([
      [expect.stringMatching(/-mock-1$/), true],
    ])
  })
})
