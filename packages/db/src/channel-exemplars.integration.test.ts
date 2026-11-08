import { DEFAULT_SETTINGS, FIRST_CHANNEL_BIBLE, ValidationError } from '@boom-busters/schemas'
import type {
  ExemplarPlan,
  GraphicCode,
  ReferenceFrames,
  TechniqueProposal,
} from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  approveExemplarVersion,
  approvedExemplar,
  channelTechniquesFor,
  copyMotionFromChannel,
  exemplarVersionById,
  insertExemplarVersion,
  listChannelExemplars,
  retireExemplarVersion,
  syncChannelTechniqueInUse,
  updateExemplarDraft,
} from './channel-exemplars'
import { createChannel, ensureFirstChannel, getChannelSettings } from './channels'
import { createDb } from './client'
import {
  insertMotionReference,
  listMotionReferences,
  upsertChannelAsset,
} from './motion-references'
import { assets, channelExemplars, motionReferences } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * A channel's exemplar versions against a real database (spec 2026-11-04,
 * sections 9.3 and 9.4): numbered per technique, one approved at a time,
 * never edited once approved, and copied whole from another channel.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const PLAN: ExemplarPlan = {
  slot: { intent: 'The figure is the story.', words: [{ text: 'one', atMs: 0 }] },
  concept: 'one figure rises',
  storyboard: ['0.0 s the figure rises'],
  mechanisms: ['drum'],
  leansOn: [],
}

const CODE = {
  version: 1,
  source: 'function Graphic() { return null }',
  compiled: 'compiled',
  title: 'One figure',
  facts: [],
  words: [{ text: 'one', atMs: 0 }],
  durationMs: 6000,
  motion: 2,
} as GraphicCode

/** A channel's own technique (spec 8.5), as the derivation proposes it. */
const PROPOSAL: TechniqueProposal = {
  key: 'ledger-wipe',
  name: 'Ledger wipe',
  description: 'a ruled line wipes the old figure away',
  steerPhrases: ['ledger wipe'],
  mechanisms: ['persistent-actor'],
  slot: { durationMs: 6000, words: [{ text: 'one', atMs: 0 }], intent: 'The old figure is gone.' },
  fromReference: 'Ledger scene',
}

const FRAMES: ReferenceFrames = {
  dense: [
    { atMs: 1000, r2Key: 'boom-busters/references/c/h/dense/1000.jpg', width: 640, height: 360 },
  ],
  overview: [
    { atMs: 0, r2Key: 'boom-busters/references/c/h/overview/0.jpg', width: 320, height: 180 },
  ],
}

suite('channel exemplars', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''
  let otherId = ''

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${channelExemplars} restart identity cascade`)
    await db.execute(dsql`truncate table ${motionReferences} restart identity cascade`)
    await db.execute(dsql`truncate table ${assets} restart identity cascade`)
    channelId = (await ensureFirstChannel(db)).id
    // A slug of its own per test: a channel is never deleted (its bible refers to it).
    otherId = (
      await createChannel(db, {
        name: 'Other',
        handle: null,
        slug: `other-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        settings: DEFAULT_SETTINGS,
        bible: FIRST_CHANNEL_BIBLE,
      })
    ).id
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  const aVersion = (input: Partial<Parameters<typeof insertExemplarVersion>[1]> = {}) =>
    insertExemplarVersion(db, {
      channelId,
      technique: 'stat-counter',
      plan: PLAN,
      code: CODE,
      ...input,
    })

  it('numbers versions per channel and technique from one', async () => {
    const first = await aVersion()
    const second = await aVersion()
    const bar = await aVersion({ technique: 'bar-chart' })
    expect([first.version, second.version, bar.version]).toEqual([1, 2, 1])
    expect(first.status).toBe('draft')
    const listed = await listChannelExemplars(db, channelId)
    expect(listed.map((row) => [row.technique, row.version])).toEqual([
      ['bar-chart', 1],
      ['stat-counter', 2],
      ['stat-counter', 1],
    ])
  })

  it('refuses to edit an approved version in place', async () => {
    const draft = await aVersion()
    const edited = await updateExemplarDraft(db, draft.id, { costUsd: 1.25 })
    expect(edited.costUsd).toBe('1.2500')
    await approveExemplarVersion(db, draft.id)
    await expect(updateExemplarDraft(db, draft.id, { costUsd: 2 })).rejects.toThrow(ValidationError)
  })

  it('approves a version and retires the one approved before it', async () => {
    const v1 = await aVersion()
    const v2 = await aVersion({ parentId: v1.id, steer: 'slower' })
    await approveExemplarVersion(db, v1.id)
    const { approved, retired } = await approveExemplarVersion(db, v2.id)
    expect(approved.status).toBe('approved')
    expect(approved.approvedAt).toBeInstanceOf(Date)
    expect(retired?.id).toBe(v1.id)
    expect((await exemplarVersionById(db, v1.id))?.status).toBe('retired')
    expect((await approvedExemplar(db, channelId, 'stat-counter'))?.id).toBe(v2.id)
    expect(await approvedExemplar(db, channelId, 'bar-chart')).toBeNull()
  })

  it('approves a draft whose parent has already retired', async () => {
    const v1 = await aVersion()
    await approveExemplarVersion(db, v1.id)
    const v2 = await aVersion({ parentId: v1.id, steer: 'slower' })
    const v3 = await aVersion({ parentId: v2.id, steer: 'darker' })
    await approveExemplarVersion(db, v2.id)
    const v4 = await aVersion({ parentId: v2.id, steer: 'louder' })
    await approveExemplarVersion(db, v4.id)
    const { approved, retired } = await approveExemplarVersion(db, v3.id)
    expect(approved.id).toBe(v3.id)
    expect(retired?.id).toBe(v4.id)
    expect((await exemplarVersionById(db, v2.id))?.status).toBe('retired')
  })

  it('restores a retired version by approving it again', async () => {
    const v1 = await aVersion()
    const v2 = await aVersion()
    await approveExemplarVersion(db, v1.id)
    await approveExemplarVersion(db, v2.id)
    const { approved, retired } = await approveExemplarVersion(db, v1.id)
    expect(approved.id).toBe(v1.id)
    expect(retired?.id).toBe(v2.id)
    const draft = await aVersion()
    expect((await retireExemplarVersion(db, draft.id)).status).toBe('retired')
  })

  it("copies approved exemplars as approved, retiring the target's own", async () => {
    const source = await aVersion({ technique: 'stat-counter' })
    await approveExemplarVersion(db, source.id)
    await aVersion({ technique: 'bar-chart' })
    const own = await insertExemplarVersion(db, {
      channelId: otherId,
      technique: 'stat-counter',
      plan: PLAN,
      code: CODE,
    })
    await approveExemplarVersion(db, own.id)

    const copied = await copyMotionFromChannel(db, otherId, channelId)
    expect(copied).toEqual({ references: 0, exemplars: 1 })
    const approved = await approvedExemplar(db, otherId, 'stat-counter')
    expect(approved?.copiedFrom).toBe(source.id)
    expect(approved?.version).toBe(2)
    expect((await exemplarVersionById(db, own.id))?.status).toBe('retired')
    expect(await approvedExemplar(db, otherId, 'bar-chart')).toBeNull()
  })

  it('copies the live references with their readings and shares the asset rows', async () => {
    const asset = (await upsertChannelAsset(db, channelId, {
      kind: 'video',
      r2Key: `boom-busters/references/${channelId}/hash.mp4`,
      contentHash: 'hash',
      width: 1920,
      height: 1080,
      durationMs: 10_000,
      title: 'A clip',
    }))!
    const reference = await insertMotionReference(db, channelId, {
      assetId: asset.id,
      kind: 'video',
      title: 'Reference 1',
      sourceUrl: null,
      rights: 'Reference only',
      purpose: 'look',
      negative: false,
      windowStartMs: 1000,
      windowEndMs: 3000,
      carryOver: 'borrow the hold',
      avoid: '',
      frames: FRAMES,
    })
    const copied = await copyMotionFromChannel(db, otherId, channelId)
    expect(copied).toEqual({ references: 1, exemplars: 0 })
    const [row] = await listMotionReferences(db, otherId)
    expect(row?.assetId).toBe(asset.id)
    expect(row?.title).toBe('Reference 1')
    expect(row?.position).toBe(1)
    expect(row?.frames).toEqual(FRAMES)
    expect(row?.id).not.toBe(reference.id)
  })

  it('refuses to copy into a channel with live references', async () => {
    const asset = (await upsertChannelAsset(db, otherId, {
      kind: 'image',
      r2Key: `boom-busters/references/${otherId}/still.png`,
      contentHash: 'still',
      width: 1920,
      height: 1080,
      durationMs: null,
      title: 'A still',
    }))!
    await insertMotionReference(db, otherId, {
      assetId: asset.id,
      kind: 'image',
      title: 'Own still',
      sourceUrl: null,
      rights: 'Reference only',
      purpose: 'look',
      negative: false,
      windowStartMs: null,
      windowEndMs: null,
      carryOver: 'the palette',
      avoid: '',
      frames: FRAMES,
    })
    await expect(copyMotionFromChannel(db, otherId, channelId)).rejects.toThrow(
      /Archive this channel's references first/,
    )
  })

  it('stores a proposal on a version and lists it as a channel technique (spec 8.5)', async () => {
    const draft = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL })
    expect(draft.proposal).toEqual(PROPOSAL)
    expect(await channelTechniquesFor(db, channelId)).toEqual([])
    await approveExemplarVersion(db, draft.id)
    expect(await channelTechniquesFor(db, channelId)).toEqual([
      {
        technique: 'ledger-wipe',
        description: PROPOSAL.description,
        steerPhrases: ['ledger wipe'],
      },
    ])
    // A house technique never lists, proposal or not.
    const house = await aVersion({ technique: 'stat-counter' })
    await approveExemplarVersion(db, house.id)
    expect((await channelTechniquesFor(db, channelId)).map((t) => t.technique)).toEqual([
      'ledger-wipe',
    ])
  })

  it('syncs the key into use on approval and out of use when nothing is approved', async () => {
    const inUse = async () => (await getChannelSettings(db, channelId)).motion.techniques
    expect(await inUse()).not.toContain('ledger-wipe')
    const version = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL })
    expect(await syncChannelTechniqueInUse(db, channelId, 'ledger-wipe')).toBe('unchanged')
    await approveExemplarVersion(db, version.id)
    expect(await syncChannelTechniqueInUse(db, channelId, 'ledger-wipe')).toBe('added')
    expect(await inUse()).toContain('ledger-wipe')
    expect(await syncChannelTechniqueInUse(db, channelId, 'ledger-wipe')).toBe('unchanged')
    await retireExemplarVersion(db, version.id)
    expect(await syncChannelTechniqueInUse(db, channelId, 'ledger-wipe')).toBe('removed')
    expect(await inUse()).not.toContain('ledger-wipe')
    expect(await syncChannelTechniqueInUse(db, channelId, 'stat-counter')).toBe('unchanged')
  })

  it('copies a channel-only technique with its proposal', async () => {
    const source = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL })
    await approveExemplarVersion(db, source.id)
    await copyMotionFromChannel(db, otherId, channelId)
    const copied = await approvedExemplar(db, otherId, 'ledger-wipe')
    expect(copied?.proposal).toEqual(PROPOSAL)
    expect(copied?.copiedFrom).toBe(source.id)
  })
})
