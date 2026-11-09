// @vitest-environment node

import {
  approveExemplarVersion,
  channelExemplars,
  ensureFirstChannel,
  insertExemplarVersion,
  requireTestDatabase,
} from '@boom-busters/db'
import { MANIFEST, exemplarFor } from '@boom-busters/providers'
import { DEFAULT_MOTION_IDENTITY } from '@boom-busters/schemas'
import type { ChannelExemplarRow } from '@boom-busters/db'
import type { ExemplarPlan, GraphicCode, TechniqueProposal } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import {
  channelTechniquesInUse,
  exemplarFromApproved,
  pinnedExemplarFor,
  techniqueEntryFor,
} from './exemplar-entries'

/**
 * The entry a derivation designs from, for a house key or a channel's own
 * (spec 2026-11-04, section 8.5): the catalogue for the former, the newest
 * version's proposal for the latter; the exemplar the loop pins; and the
 * channel's own techniques the board honours.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

const PROPOSAL: TechniqueProposal = {
  key: 'ledger-wipe',
  name: 'Ledger wipe',
  description: 'a ruled line wipes the old figure away',
  steerPhrases: ['ledger wipe'],
  mechanisms: ['persistent-actor'],
  slot: { durationMs: 6000, words: [{ text: 'one', atMs: 0 }], intent: 'The old figure is gone.' },
  fromReference: 'Ledger scene',
}
const PLAN: ExemplarPlan = {
  slot: { intent: 'The figure is the story.', words: [{ text: 'one', atMs: 0 }] },
  concept: 'one figure rises',
  storyboard: ['0.0 s the figure rises'],
  mechanisms: ['persistent-actor'],
  leansOn: [],
}
const CODE = {
  version: 1,
  source: 'function Graphic() { return null }',
  compiled: 'compiled',
  title: 'The ledger',
  facts: [],
  words: [{ text: 'one', atMs: 0 }],
  durationMs: 6000,
  motion: 2,
} as GraphicCode

describeDb('exemplar entries (spec 8.5)', () => {
  let channelId = ''
  beforeEach(async () => {
    await db.delete(channelExemplars)
    channelId = (await ensureFirstChannel(db)).id
  })

  const aVersion = (proposal: TechniqueProposal, title = CODE.title) =>
    insertExemplarVersion(db, {
      channelId,
      technique: proposal.key,
      plan: PLAN,
      code: { ...CODE, title },
      proposal,
    })

  it('reads a house key from the catalogue and a channel key from its newest version', async () => {
    expect(await techniqueEntryFor(db, channelId, 'stat-counter')).toBe(
      MANIFEST.find((entry) => entry.technique === 'stat-counter'),
    )
    expect(await techniqueEntryFor(db, channelId, 'ledger-wipe')).toBeNull()
    await aVersion(PROPOSAL)
    await aVersion({ ...PROPOSAL, description: 'the newer words' })
    const entry = await techniqueEntryFor(db, channelId, 'ledger-wipe')
    expect(entry?.technique).toBe('ledger-wipe')
    expect(entry?.description).toBe('the newer words')
    expect(entry?.slot.durationMs).toBe(6000)
    expect(entry?.chart).toBeUndefined()
  })

  it('pins the channel approved version for a channel key and nothing before one', async () => {
    expect(await pinnedExemplarFor(db, channelId, 'stat-counter')).toEqual(
      exemplarFor('stat-counter'),
    )
    const draft = await aVersion(PROPOSAL)
    expect(await pinnedExemplarFor(db, channelId, 'ledger-wipe')).toBeNull()
    await approveExemplarVersion(db, draft.id)
    const pinned = await pinnedExemplarFor(db, channelId, 'ledger-wipe')
    expect(pinned?.technique).toBe('ledger-wipe')
    expect(pinned?.description).toBe(PROPOSAL.description)
    expect(pinned?.title).toBe('The ledger')
    expect(pinned?.mechanisms).toEqual(['persistent-actor'])
  })

  it('lists only approved keys in use', async () => {
    const draft = await aVersion(PROPOSAL)
    await approveExemplarVersion(db, draft.id)
    expect(await channelTechniquesInUse(db, channelId, DEFAULT_MOTION_IDENTITY)).toEqual([])
    const inUse = {
      ...DEFAULT_MOTION_IDENTITY,
      techniques: [...DEFAULT_MOTION_IDENTITY.techniques, 'ledger-wipe'],
    }
    expect(await channelTechniquesInUse(db, channelId, inUse)).toEqual([
      {
        technique: 'ledger-wipe',
        description: PROPOSAL.description,
        steerPhrases: ['ledger wipe'],
      },
    ])
  })
})

describe('exemplarFromApproved (deferred minor: one rule for the board and the loop)', () => {
  const row = (technique: string, proposal: TechniqueProposal | null) =>
    ({ technique, proposal, plan: PLAN, code: CODE }) as unknown as ChannelExemplarRow

  it('describes a house key from the catalogue, a channel key from its proposal, else by its key', () => {
    expect(exemplarFromApproved(row('stat-counter', null))).toEqual({
      technique: 'stat-counter',
      description: MANIFEST.find((entry) => entry.technique === 'stat-counter')!.description,
      mechanisms: PLAN.mechanisms,
      title: CODE.title,
      source: CODE.source,
    })
    expect(exemplarFromApproved(row('ledger-wipe', PROPOSAL)).description).toBe(
      PROPOSAL.description,
    )
    expect(exemplarFromApproved(row('ledger-wipe', null)).description).toBe('ledger-wipe')
  })
})
