import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ReferenceFrames, ReferenceReading } from '@boom-busters/schemas'
import { ensureFirstChannel } from './channels'
import { insertLogo } from './logos'
import { createDb } from './client'
import {
  archiveMotionReference,
  insertMotionReference,
  listMotionReferences,
  motionReferenceById,
  referencesUsingAsset,
  remarkMotionReference,
  setReferenceReading,
  setReferenceReadState,
  setReferenceSheets,
  upsertChannelAsset,
} from './motion-references'
import { assets, motionReferences } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * The reference pack against a real database (spec 2026-11-04, section 7.1):
 * positions in insertion order among live rows, the cap of twelve, a re-mark
 * that clears what was read of the old window, and the per-channel asset
 * dedupe the uploads ride on.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const FRAMES: ReferenceFrames = {
  dense: [
    { atMs: 1000, r2Key: 'boom-busters/references/c/h/dense/1000.jpg', width: 640, height: 360 },
  ],
  overview: [
    { atMs: 0, r2Key: 'boom-busters/references/c/h/overview/0.jpg', width: 320, height: 180 },
  ],
}

const READING: ReferenceReading = {
  medium: 'flat typography',
  palette: ['#111', '#eee'],
  type: 'grotesk, heavy',
  enters: 'rises',
  exits: 'cuts',
  motion: 'one numeral holds',
  absent: 'no glow',
  notes: '',
  readAt: new Date().toISOString(),
  model: 'test/model',
}

suite('motion references', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${motionReferences} restart identity cascade`)
    await db.execute(dsql`truncate table ${assets} restart identity cascade`)
    channelId = (await ensureFirstChannel(db)).id
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  async function anAsset(hash = 'hash-a', title = 'A clip') {
    return upsertChannelAsset(db, channelId, {
      kind: 'video',
      r2Key: `boom-busters/references/${channelId}/${hash}.mp4`,
      contentHash: hash,
      width: 1920,
      height: 1080,
      durationMs: 10_000,
      title,
    })
  }

  async function aReference(n: number) {
    const asset = (await anAsset(`hash-${n}`))!
    return insertMotionReference(db, channelId, {
      assetId: asset.id,
      kind: 'video',
      title: `Reference ${n}`,
      sourceUrl: null,
      rights: 'Reference only',
      purpose: 'mechanism',
      negative: false,
      windowStartMs: 1000,
      windowEndMs: 3000,
      carryOver: 'borrow the hold',
      avoid: '',
      frames: FRAMES,
    })
  }

  it('numbers references in insertion order and lists live ones only', async () => {
    const first = await aReference(1)
    const second = await aReference(2)
    expect(first.position).toBe(1)
    expect(second.position).toBe(2)
    expect(first.readState).toBe('unread')
    await archiveMotionReference(db, first.id)
    const live = await listMotionReferences(db, channelId)
    expect(live.map((row) => row.id)).toEqual([second.id])
    expect((await motionReferenceById(db, first.id))?.archivedAt).not.toBeNull()
  })

  it('refuses a thirteenth live reference', async () => {
    for (let n = 1; n <= 12; n += 1) await aReference(n)
    await expect(aReference(13)).rejects.toThrow(/twelve references/)
    const [first] = await listMotionReferences(db, channelId)
    await archiveMotionReference(db, first!.id)
    const next = await aReference(14)
    expect(next.position).toBe(13)
  })

  it('a re-mark clears the reading, the sheets and the read state', async () => {
    const row = await aReference(1)
    await setReferenceReading(db, row.id, READING)
    await setReferenceSheets(db, row.id, { contactSheetKey: 'c.jpg', denseSheetKey: 'd.jpg' })
    const frames: ReferenceFrames = { dense: [{ ...FRAMES.dense[0]!, atMs: 2000 }], overview: [] }
    const marked = await remarkMotionReference(db, row.id, {
      windowStartMs: 2000,
      windowEndMs: 4000,
      frames,
    })
    expect(marked?.reading).toBeNull()
    expect(marked?.contactSheetKey).toBeNull()
    expect(marked?.denseSheetKey).toBeNull()
    expect(marked?.readState).toBe('unread')
    expect(marked?.windowEndMs).toBe(4000)
    expect(marked?.frames).toEqual(frames)
  })

  it('stores the same bytes once per channel and refreshes the title', async () => {
    const one = await anAsset('same', 'First name')
    const two = await anAsset('same', 'Second name')
    expect(two!.id).toBe(one!.id)
    expect(two!.title).toBe('Second name')
    expect(two!.kind).toBe('video')
    expect(two!.durationMs).toBe(10_000)
  })

  it('never turns a mark into a reference: the same bytes as a logo come back null (final review, issue 3)', async () => {
    const logo = await insertLogo(db, channelId, {
      r2Key: 'boom-busters/logos/mark.png',
      contentHash: 'mark',
      title: 'Acme',
      width: 100,
      height: 40,
    })
    const asset = await upsertChannelAsset(db, channelId, {
      kind: 'image',
      r2Key: 'boom-busters/references/c/mark.png',
      contentHash: 'mark',
      width: 100,
      height: 40,
      title: 'A reference',
    })
    expect(asset).toBeNull()
    const [row] = await db.select().from(assets)
    expect(row?.id).toBe(logo!.id)
    expect(row?.title).toBe('Acme')
    expect(row?.kind).toBe('logo')
  })

  it('counts the references that hold an asset, archived ones included', async () => {
    const asset = (await anAsset('shared'))!
    expect(await referencesUsingAsset(db, asset.id)).toBe(0)
    const first = await insertMotionReference(db, channelId, {
      assetId: asset.id,
      kind: 'video',
      title: 'A',
      sourceUrl: null,
      rights: 'Reference only',
      purpose: 'look',
      negative: false,
      windowStartMs: 0,
      windowEndMs: 2000,
      carryOver: 'x',
      avoid: '',
      frames: FRAMES,
    })
    await archiveMotionReference(db, first.id)
    expect(await referencesUsingAsset(db, asset.id)).toBe(1)
  })

  it('a reading sets the state read and clears an old error', async () => {
    const row = await aReference(1)
    await setReferenceReadState(db, row.id, 'failed', 'over budget')
    expect((await motionReferenceById(db, row.id))?.readError).toBe('over budget')
    const read = await setReferenceReading(db, row.id, READING)
    expect(read?.readState).toBe('read')
    expect(read?.readError).toBeNull()
    expect(read?.reading?.medium).toBe('flat typography')
  })
})
