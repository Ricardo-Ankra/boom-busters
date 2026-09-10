// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getShort,
  insertShort,
  renders,
  requireTestDatabase,
  seed,
  shorts,
  truncateRunMirror,
  updateSettings,
  updateShort,
} from '@boom-busters/db'
import type { SlotCandidate, TeaserFetchesRecord } from '@boom-busters/schemas'
import { TEASER_CHAPTER_ID } from '@boom-busters/timeline'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { mockTeaserShotKey } from '@/lib/teaser-fetch'
import { forgetRunRows } from '../middleware/run-mirror'
import { teaserShotFetcher } from './teaser-shot-fetcher'

/**
 * The teaser studio's new-material runner (decision 231), against the real
 * test database in mock-provider mode. What matters: a stock search REPLACES
 * the beat's free results while keeping every paid still; a still generation
 * APPENDS; an ingest pick writes the slot snapshot into the beat's choice and
 * clears the state; and every op leaves `state` as words or null, never a
 * spinner that nothing will ever clear.
 */

vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
  stillKey: vi.fn(),
  stockKey: vi.fn(),
  takeStorage: () => 'regenerated' as const,
}))

const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notify }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const STORED_SCRIPT = {
  title: 'The audit that said no',
  paragraphs: [
    { text: 'One number was missing, and it was billions.', chapterIndex: 0 },
    { text: 'The auditors finally refused to sign anything at all.', chapterIndex: 0 },
  ],
  scriptVersion: 1,
}

function stillCandidate(id: string): SlotCandidate {
  return {
    id,
    provider: 'fal',
    kind: 'image',
    sourceUrl: `generated://fal/${id}`,
    r2Key: `boom-busters/stills/${id}.png`,
    licence: 'Generated ([mock])',
    width: 1344,
    height: 768,
  }
}

function stockCandidate(id: string): SlotCandidate {
  return {
    id,
    provider: 'pexels',
    kind: 'image',
    sourceUrl: `mock://pexels/${id}`,
    thumbUrl: 'data:image/svg+xml;base64,AAAA',
    licence: '[mock] Free to use',
  }
}

function fetchEvent(
  shortId: string,
  data: Record<string, unknown>,
): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'teaser/shots.requested',
      data: { projectId: FIXTURE_PROJECT_ID, shortId, ...data },
    },
  ]
}

async function insertTeaser(fetches?: TeaserFetchesRecord) {
  const short = await insertShort(db, {
    projectId: FIXTURE_PROJECT_ID,
    title: 'Curated by hand',
    segmentRef: { chapterId: TEASER_CHAPTER_ID, fromParagraph: 0, toParagraph: 1 },
    kind: 'teaser',
    teaserScript: STORED_SCRIPT,
  })
  if (fetches) {
    await updateShort(db, short.id, {
      teaserFetches: fetches as unknown as Record<string, unknown>,
    })
  }
  return short
}

describeDb('teaser-shot-fetcher', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: teaserShotFetcher })
    vi.clearAllMocks()
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await updateSettings(db, { budgets: { monthlyCeilingUsd: 100, approvedOverage: null } })
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(renders)
    await db.delete(shorts)
  })

  it('a stock search replaces the free results and keeps every paid still', async () => {
    const teaser = await insertTeaser({
      beats: [
        {
          state: { state: 'fetching', what: 'stock' },
          candidates: [stillCandidate('fal-old'), stockCandidate('pexels-old')],
        },
      ],
    })

    const { result } = await engine.execute({
      events: fetchEvent(teaser.id, { beatIndex: 0, op: 'stock', query: 'auditors office dusk' }),
    })

    expect(result).toMatchObject({ outcome: 'fetched' })
    const stored = (await getShort(db, teaser.id))?.teaserFetches as TeaserFetchesRecord
    const beat = stored.beats[0]!
    expect(beat.state).toBeNull()
    const ids = beat.candidates.map((candidate) => candidate.id)
    expect(ids).toContain('fal-old') // paid pixels survive
    expect(ids).not.toContain('pexels-old') // free results re-earned
    // The mock adapters answered for both providers.
    expect(beat.candidates.filter((candidate) => candidate.provider !== 'fal')).not.toHaveLength(0)
  })

  it('a still generation appends and clears the state', async () => {
    const teaser = await insertTeaser({
      beats: [null, { state: { state: 'fetching', what: 'still' }, candidates: [] }],
    })

    const { result } = await engine.execute({
      events: fetchEvent(teaser.id, {
        beatIndex: 1,
        op: 'still',
        prompt: 'a ledger page dissolving into static',
      }),
    })

    expect(result).toMatchObject({ outcome: 'generated', made: 2 })
    const stored = (await getShort(db, teaser.id))?.teaserFetches as TeaserFetchesRecord
    const beat = stored.beats[1]!
    expect(beat.state).toBeNull()
    expect(beat.candidates).toHaveLength(2)
    // Beat 0 was never touched.
    expect(stored.beats[0]).toBeNull()
  })

  it('an ingest pick stores the slot snapshot as the beat’s choice', async () => {
    const teaser = await insertTeaser({
      beats: [
        {
          state: { state: 'fetching', what: 'ingest' },
          candidates: [stockCandidate('pexels-42')],
        },
      ],
    })

    const { result } = await engine.execute({
      events: fetchEvent(teaser.id, { beatIndex: 0, op: 'ingest', candidateId: 'pexels-42' }),
    })

    expect(result).toMatchObject({ outcome: 'picked' })
    const stored = await getShort(db, teaser.id)
    const shotsRecord = stored?.teaserShots as { choices: unknown[] }
    expect(shotsRecord.choices[0]).toMatchObject({
      type: 'stock',
      payload: { kind: 'image', src: { r2Key: mockTeaserShotKey('pexels-42') } },
    })
    const fetches = stored?.teaserFetches as TeaserFetchesRecord
    expect(fetches.beats[0]?.state).toBeNull()
  })

  it('an unknown pick fails in words and notifies, never a dead spinner', async () => {
    const teaser = await insertTeaser({
      beats: [{ state: { state: 'fetching', what: 'ingest' }, candidates: [] }],
    })

    const { result } = await engine.execute({
      events: fetchEvent(teaser.id, { beatIndex: 0, op: 'ingest', candidateId: 'gone-1' }),
    })

    expect(result).toMatchObject({ outcome: 'failed' })
    const fetches = (await getShort(db, teaser.id))?.teaserFetches as TeaserFetchesRecord
    expect(fetches.beats[0]?.state).toMatchObject({ state: 'failed', what: 'ingest' })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'run-failed', title: expect.stringContaining('teaser') }),
    )
  })
})
