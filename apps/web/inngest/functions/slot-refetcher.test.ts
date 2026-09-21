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
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
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
})
