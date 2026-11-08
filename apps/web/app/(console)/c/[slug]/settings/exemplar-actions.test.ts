// @vitest-environment node

import {
  approveExemplarVersion,
  approvedExemplar,
  channelExemplars,
  createChannel,
  createDerivation,
  exemplarVersionById,
  finishDerivation,
  getChannelSettings,
  getDerivation,
  insertExemplarVersion,
  insertMotionReference,
  listChannelExemplars,
  listMotionReferences,
  listVerdicts,
  motionDerivations,
  motionReferences,
  motionVerdicts,
  requireTestDatabase,
  retireExemplarVersion,
  seed,
  updateChannelSettings,
  upsertChannelAsset,
} from '@boom-busters/db'
import {
  DEFAULT_SETTINGS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  newId,
} from '@boom-busters/schemas'
import type { ExemplarPlan, GraphicCode, TechniqueProposal } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  approveExemplarVersionAction,
  copyMotionFromChannelAction,
  deriveExemplarsAction,
  keepApprovedAction,
  latestDerivationAction,
  refineExemplarAction,
  restoreExemplarVersionAction,
} from './exemplar-actions'

/**
 * The exemplar actions against the real database (spec 2026-11-04,
 * sections 9.1, 9.3, 9.4 and 11): each launch sends its event, each
 * verdict writes its ledger row, and the copy forks another channel.
 */

const authMock = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user: { email: string } } | null> => ({
    user: { email: 'owner@example.com' },
  })),
}))
vi.mock('@/auth', () => authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const sent = vi.hoisted(() => ({ send: vi.fn(async (_event: unknown) => ({ ids: ['evt'] })) }))
vi.mock('@/inngest/client', () => ({ inngest: { send: sent.send } }))

const describeDb = requireTestDatabase() ? describe : describe.skip
const channelId = FIRST_CHANNEL_ID

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

/** A channel's own technique (spec 8.5). */
const PROPOSAL: TechniqueProposal = {
  key: 'ledger-wipe',
  name: 'Ledger wipe',
  description: 'a ruled line wipes the old figure away',
  steerPhrases: ['ledger wipe'],
  mechanisms: ['persistent-actor'],
  slot: { durationMs: 6000, words: [{ text: 'one', atMs: 0 }], intent: 'The old figure is gone.' },
  fromReference: 'Ledger scene',
}

describeDb('the exemplar actions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    await db.delete(channelExemplars)
    await db.delete(motionDerivations)
    await db.delete(motionVerdicts)
    await db.delete(motionReferences)
  })

  // The rows are this file's alone and the first channel's motion goes back
  // to the house: another file's test reads both (the shared test database).
  afterEach(async () => {
    await db.delete(channelExemplars)
    await db.delete(motionDerivations)
    await db.delete(motionVerdicts)
    await db.delete(motionReferences)
    await updateChannelSettings(db, channelId, { motion: DEFAULT_SETTINGS.motion })
  })

  const aVersion = (patch: Partial<Parameters<typeof insertExemplarVersion>[1]> = {}) =>
    insertExemplarVersion(db, {
      channelId,
      technique: 'stat-counter',
      plan: PLAN,
      code: CODE,
      ...patch,
    })

  it('launches a derivation with the techniques, rounds and cap, and sends the event', async () => {
    const result = await deriveExemplarsAction(channelId, {
      techniques: ['stat-counter', 'bar-chart'],
      rounds: 2,
      capUsd: 5,
    })
    expect(result.ok).toBe(true)
    expect(result.derivationId).toBeDefined()
    expect(sent.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'motion/exemplars.derive',
        data: { channelId, derivationId: result.derivationId },
      }),
    )
    const latest = await latestDerivationAction(channelId)
    expect(latest.ok).toBe(true)
    expect(latest.derivation).toMatchObject({ state: 'running', rounds: 2, capUsd: 5 })
    expect(latest.derivation?.progress).toHaveLength(2)
    expect(
      await deriveExemplarsAction(channelId, { techniques: [], rounds: 2, capUsd: 5 }),
    ).toMatchObject({
      ok: false,
    })
  })

  it('launches a derivation with the proposal ticked and no technique (spec 8.5)', async () => {
    const result = await deriveExemplarsAction(channelId, {
      techniques: [],
      rounds: 1,
      capUsd: 2,
      propose: true,
    })
    expect(result.ok).toBe(true)
    const row = (await getDerivation(db, result.derivationId!))!
    expect(row.propose).toBe(true)
    expect(row.techniques).toEqual([])
    expect(row.progress).toEqual([])
    const neither = await deriveExemplarsAction(channelId, { techniques: [], rounds: 1, capUsd: 2 })
    expect(neither.ok).toBe(false)
  })

  it('approving a channel-only version puts its key in use (spec 8.5)', async () => {
    const inUse = async () => (await getChannelSettings(db, channelId)).motion.techniques
    const before = await inUse()
    const own = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL })
    expect((await approveExemplarVersionAction(channelId, own.id)).ok).toBe(true)
    expect(await inUse()).toEqual([...before, 'ledger-wipe'])
    const house = await aVersion()
    expect((await approveExemplarVersionAction(channelId, house.id)).ok).toBe(true)
    expect(await inUse()).toEqual([...before, 'ledger-wipe'])
  })

  it('keep on a channel-only draft takes the key out of use when nothing is approved (spec 8.5)', async () => {
    const inUse = async () => (await getChannelSettings(db, channelId)).motion.techniques
    const v1 = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL })
    await approveExemplarVersionAction(channelId, v1.id)
    const v2 = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL, parentId: v1.id })
    await retireExemplarVersion(db, v1.id)
    expect((await keepApprovedAction(channelId, v2.id)).ok).toBe(true)
    expect(await inUse()).not.toContain('ledger-wipe')
    // With an approved version still standing, keep leaves the key in use.
    const v3 = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL })
    await approveExemplarVersionAction(channelId, v3.id)
    const v4 = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL, parentId: v3.id })
    expect((await keepApprovedAction(channelId, v4.id)).ok).toBe(true)
    expect(await inUse()).toContain('ledger-wipe')
    // Restore puts it back.
    const v5 = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL, parentId: v3.id })
    await retireExemplarVersion(db, v3.id)
    expect((await keepApprovedAction(channelId, v5.id)).ok).toBe(true)
    expect(await inUse()).not.toContain('ledger-wipe')
    expect((await restoreExemplarVersionAction(channelId, v3.id)).ok).toBe(true)
    expect(await inUse()).toContain('ledger-wipe')
  })

  it('keep never re-ticks a channel key the owner unticked (final review, issue 1)', async () => {
    const inUse = async () => (await getChannelSettings(db, channelId)).motion.techniques
    const v1 = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL })
    await approveExemplarVersionAction(channelId, v1.id)
    const motion = (await getChannelSettings(db, channelId)).motion
    await updateChannelSettings(db, channelId, {
      motion: { ...motion, techniques: motion.techniques.filter((key) => key !== 'ledger-wipe') },
    })
    const v2 = await aVersion({ technique: 'ledger-wipe', proposal: PROPOSAL, parentId: v1.id })
    expect((await keepApprovedAction(channelId, v2.id)).ok).toBe(true)
    expect(await inUse()).not.toContain('ledger-wipe')
  })

  it('refuses a launch while a derivation runs', async () => {
    await createDerivation(db, { channelId, techniques: ['stat-counter'], rounds: 1, capUsd: 1 })
    const result = await deriveExemplarsAction(channelId, {
      techniques: ['bar-chart'],
      rounds: 1,
      capUsd: 1,
    })
    expect(result).toMatchObject({ ok: false, error: 'A derivation is running on this channel' })
    expect(sent.send).not.toHaveBeenCalled()
    const parent = await aVersion()
    await approveExemplarVersion(db, parent.id)
    expect(await refineExemplarAction(channelId, parent.id, 'slower')).toMatchObject({ ok: false })
  })

  it('refines the approved version with the steer and records the steer verdict', async () => {
    const parent = await aVersion()
    await approveExemplarVersion(db, parent.id)
    const result = await refineExemplarAction(channelId, parent.id, 'slower, darker')
    expect(result.ok).toBe(true)
    expect(sent.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'motion/exemplar.refine',
        data: { channelId, parentId: parent.id, steer: 'slower, darker' },
      }),
    )
    const [verdict] = await listVerdicts(db, channelId)
    expect(verdict).toMatchObject({ kind: 'steer', exemplarId: parent.id, steer: 'slower, darker' })
    expect(await refineExemplarAction(channelId, parent.id, 'a'.repeat(501))).toMatchObject({
      ok: false,
    })
    expect(await refineExemplarAction(channelId, newId(), 'x')).toMatchObject({ ok: false })
  })

  it('approves a draft with a parent as a preference over it', async () => {
    const parent = await aVersion()
    await approveExemplarVersion(db, parent.id)
    const draft = await aVersion({ parentId: parent.id, steer: 'slower' })
    const result = await approveExemplarVersionAction(channelId, draft.id)
    expect(result.ok).toBe(true)
    expect((await approvedExemplar(db, channelId, 'stat-counter'))?.id).toBe(draft.id)
    expect((await exemplarVersionById(db, parent.id))?.status).toBe('retired')
    const [verdict] = await listVerdicts(db, channelId)
    expect(verdict).toMatchObject({
      kind: 'prefer',
      exemplarId: draft.id,
      comparison: { a: draft.id, b: parent.id },
    })
    const first = await aVersion({ technique: 'bar-chart' })
    await approveExemplarVersionAction(channelId, first.id)
    const [plain] = await listVerdicts(db, channelId)
    expect(plain).toMatchObject({ kind: 'approve', exemplarId: first.id, comparison: null })
  })

  it('records the preference against the version approved at the time, not a retired parent (final review, issue 7)', async () => {
    const v1 = await aVersion()
    await approveExemplarVersion(db, v1.id)
    const v2 = await aVersion({ parentId: v1.id, steer: 'slower' })
    const v3 = await aVersion({ parentId: v1.id, steer: 'darker' })
    await approveExemplarVersionAction(channelId, v3.id)
    await approveExemplarVersionAction(channelId, v2.id)
    const [verdict] = await listVerdicts(db, channelId)
    expect(verdict).toMatchObject({
      kind: 'prefer',
      exemplarId: v2.id,
      comparison: { a: v2.id, b: v3.id },
    })
  })

  it('keeps the approved one and retires the draft', async () => {
    const parent = await aVersion()
    await approveExemplarVersion(db, parent.id)
    const draft = await aVersion({ parentId: parent.id, steer: 'slower' })
    const result = await keepApprovedAction(channelId, draft.id)
    expect(result.ok).toBe(true)
    expect((await exemplarVersionById(db, draft.id))?.status).toBe('retired')
    expect((await approvedExemplar(db, channelId, 'stat-counter'))?.id).toBe(parent.id)
    const [verdict] = await listVerdicts(db, channelId)
    expect(verdict).toMatchObject({
      kind: 'keep-approved',
      exemplarId: parent.id,
      comparison: { a: parent.id, b: draft.id },
    })
  })

  it('restores a retired version', async () => {
    const v1 = await aVersion()
    const v2 = await aVersion()
    await approveExemplarVersion(db, v1.id)
    await approveExemplarVersion(db, v2.id)
    const result = await restoreExemplarVersionAction(channelId, v1.id)
    expect(result.ok).toBe(true)
    expect((await approvedExemplar(db, channelId, 'stat-counter'))?.id).toBe(v1.id)
    expect((await exemplarVersionById(db, v2.id))?.status).toBe('retired')
    const [verdict] = await listVerdicts(db, channelId)
    expect(verdict).toMatchObject({ kind: 'approve', exemplarId: v1.id })
  })

  describe('copy from another channel', () => {
    let sourceId = ''

    beforeEach(async () => {
      sourceId = (
        await createChannel(db, {
          name: 'Source',
          handle: null,
          slug: `source-${newId().slice(-8).toLowerCase()}`,
          settings: {
            ...DEFAULT_SETTINGS,
            motion: {
              ...DEFAULT_SETTINGS.motion,
              cameraRule: 'never moves',
              styleGuideMd: 'Dark.',
            },
          },
          bible: FIRST_CHANNEL_BIBLE,
        })
      ).id
      const approved = await insertExemplarVersion(db, {
        channelId: sourceId,
        technique: 'stat-counter',
        plan: PLAN,
        code: CODE,
      })
      await approveExemplarVersion(db, approved.id)
      const asset = (await upsertChannelAsset(db, sourceId, {
        kind: 'image',
        r2Key: `boom-busters/references/${sourceId}/still.png`,
        contentHash: 'still',
        width: 1200,
        height: 800,
        durationMs: null,
        title: 'A still',
      }))!
      await insertMotionReference(db, sourceId, {
        assetId: asset.id,
        kind: 'image',
        title: 'Source still',
        sourceUrl: null,
        rights: 'Reference only',
        purpose: 'look',
        negative: false,
        windowStartMs: null,
        windowEndMs: null,
        carryOver: 'the palette',
        avoid: '',
        frames: { dense: [{ atMs: 0, r2Key: 'k', width: 1200, height: 800 }], overview: [] },
      })
    })

    it('copies the identity, the references and the exemplars from another channel', async () => {
      const result = await copyMotionFromChannelAction(channelId, sourceId)
      expect(result).toMatchObject({
        ok: true,
        note: 'Copied the identity, 1 references and 1 exemplars',
      })
      const settings = await getChannelSettings(db, channelId)
      expect(settings.motion.cameraRule).toBe('never moves')
      expect(settings.motion.styleGuideMd).toBe('Dark.')
      expect((await listMotionReferences(db, channelId)).map((row) => row.title)).toEqual([
        'Source still',
      ])
      const copied = await approvedExemplar(db, channelId, 'stat-counter')
      expect(copied?.copiedFrom).toBeTruthy()
      expect(await copyMotionFromChannelAction(channelId, channelId)).toMatchObject({ ok: false })
    })

    it('refuses to copy into a channel with references', async () => {
      await updateChannelSettings(db, channelId, { motion: { cameraRule: 'drifts' } })
      const asset = (await upsertChannelAsset(db, channelId, {
        kind: 'image',
        r2Key: `boom-busters/references/${channelId}/own.png`,
        contentHash: 'own',
        width: 1200,
        height: 800,
        durationMs: null,
        title: 'Own',
      }))!
      await insertMotionReference(db, channelId, {
        assetId: asset.id,
        kind: 'image',
        title: 'Own still',
        sourceUrl: null,
        rights: 'Reference only',
        purpose: 'look',
        negative: false,
        windowStartMs: null,
        windowEndMs: null,
        carryOver: 'x',
        avoid: '',
        frames: { dense: [{ atMs: 0, r2Key: 'k', width: 1200, height: 800 }], overview: [] },
      })
      const result = await copyMotionFromChannelAction(channelId, sourceId)
      expect(result).toMatchObject({ ok: false, error: "Archive this channel's references first" })
      // Nothing was copied, the identity included.
      expect((await getChannelSettings(db, channelId)).motion.cameraRule).toBe('drifts')
      expect(await listChannelExemplars(db, channelId)).toHaveLength(0)
    })
  })

  it('finishes a derivation the tab can read', async () => {
    const row = await createDerivation(db, {
      channelId,
      techniques: ['stat-counter'],
      rounds: 1,
      capUsd: 2,
    })
    await finishDerivation(db, row.id, { state: 'done', spentUsd: 1.5 })
    const latest = await latestDerivationAction(channelId)
    expect(latest.derivation).toMatchObject({ id: row.id, state: 'done', spentUsd: 1.5 })
    expect(typeof latest.derivation?.createdAt).toBe('string')
  })
})
