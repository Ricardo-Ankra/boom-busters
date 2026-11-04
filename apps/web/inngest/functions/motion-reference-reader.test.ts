// @vitest-environment node

import {
  assets,
  costLedger,
  insertMotionReference,
  motionReferenceById,
  motionReferences,
  requireTestDatabase,
  seed,
  setReferenceReading,
  truncateRunMirror,
  upsertChannelAsset,
} from '@boom-busters/db'
import { FIRST_CHANNEL_ID, newId } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { motionReferenceReader } from './motion-reference-reader'

/**
 * The reference reader in mock-provider mode against the real database
 * (spec 2026-11-04, section 7.3): a still needs no sheets, the reading is
 * the fixture, the row says read, and nothing is spent.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  R2_PREFIX: 'boom-busters',
  storageConfigured: () => false,
  getObjectBytes: vi.fn(),
  putObject: vi.fn(),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('motion-reference-reader (mock mode)', () => {
  let engine: InngestTestEngine

  const request = (
    referenceId: string,
  ): { events: [{ name: string; data: { channelId: string; referenceId: string } }] } => ({
    events: [
      {
        name: 'motion/reference.ingested',
        data: { channelId: FIRST_CHANNEL_ID, referenceId },
      },
    ],
  })

  async function aStill() {
    const asset = await upsertChannelAsset(db, FIRST_CHANNEL_ID, {
      kind: 'image',
      r2Key: 'mock://references/still.png',
      contentHash: 'still',
      width: 1200,
      height: 800,
      title: 'A board of type',
    })
    return insertMotionReference(db, FIRST_CHANNEL_ID, {
      assetId: asset.id,
      kind: 'image',
      title: 'A board of type',
      sourceUrl: null,
      rights: 'Reference only',
      purpose: 'look',
      negative: false,
      windowStartMs: null,
      windowEndMs: null,
      carryOver: 'borrow the weight, not the words',
      avoid: '',
      frames: {
        dense: [{ atMs: 0, r2Key: 'mock://references/still.png', width: 1200, height: 800 }],
        overview: [],
      },
    })
  }

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    engine = new InngestTestEngine({ function: motionReferenceReader })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(motionReferences)
    await db.delete(assets)
    await db.delete(costLedger)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('reads a still in mock mode: the fixture reading, state read, no spend', async () => {
    const row = await aStill()
    const { result } = await engine.execute(request(row.id))
    expect(result).toEqual({ referenceId: row.id, outcome: 'read' })
    const read = await motionReferenceById(db, row.id)
    expect(read?.readState).toBe('read')
    expect(read?.readError).toBeNull()
    expect(read?.reading?.medium).toMatch(/^\[mock\]/)
    expect(read?.reading?.notes).toContain('borrow the weight')
    expect(read?.reading?.model).toBe('mock/reading')
    expect(read?.contactSheetKey).toBeNull()
    expect(await db.select().from(costLedger)).toHaveLength(0)
  })

  it('a re-read replaces the reading', async () => {
    const row = await aStill()
    await setReferenceReading(db, row.id, {
      medium: 'old',
      palette: [],
      type: 'old',
      enters: 'old',
      exits: 'old',
      motion: 'old',
      absent: 'old',
      notes: 'old',
      readAt: '2026-11-04T10:00:00.000Z',
      model: 'test/model',
    })
    await engine.execute(request(row.id))
    const read = await motionReferenceById(db, row.id)
    expect(read?.reading?.medium).not.toBe('old')
    expect(read?.reading?.readAt).not.toBe('2026-11-04T10:00:00.000Z')
  })

  it('ends quietly when the reference is gone', async () => {
    const { result } = await engine.execute(request(newId()))
    expect(result).toMatchObject({ outcome: 'gone' })
  })
})
