import { describe, expect, it } from 'vitest'
import {
  ChannelTechniqueKeySchema,
  ChannelTechniqueSchema,
  DerivationProposalSchema,
  PROPOSAL_WHY_MAX,
  SteerPhraseSchema,
  TECHNIQUE_KEY_MAX,
  TechniqueKeySchema,
  TechniqueProposalAnswerSchema,
  TechniqueProposalSchema,
  isHouseTechnique,
} from './channel-techniques'

const proposal = {
  key: 'ledger-wipe',
  name: 'Ledger wipe',
  description:
    'a ruled ledger line wipes the old figure away and the new one is written in its place',
  steerPhrases: ['ledger wipe', 'wipe the ledger'],
  mechanisms: ['persistent-actor', 'door'],
  slot: {
    durationMs: 6000,
    words: [
      { text: 'The', atMs: 200 },
      { text: 'figure', atMs: 650 },
      { text: 'changed.', atMs: 1100 },
    ],
    intent: 'The old figure is gone for good.',
  },
  fromReference: 'Ledger scene',
}

describe('TechniqueKeySchema and the proposal (spec 2026-11-04, section 8.5)', () => {
  it('accepts a kebab key of 3 to 40 characters and refuses the rest', () => {
    expect(TechniqueKeySchema.safeParse('ledger-wipe').success).toBe(true)
    expect(TechniqueKeySchema.safeParse('a1-b2').success).toBe(true)
    for (const bad of ['LedgerWipe', 'wi', '-wipe', 'wipe-', 'ledger--wipe', 'a'.repeat(41)]) {
      expect(TechniqueKeySchema.safeParse(bad).success, bad).toBe(false)
    }
    expect(TECHNIQUE_KEY_MAX).toBe(40)
  })

  it('isHouseTechnique knows the catalogue and ChannelTechniqueKeySchema refuses it', () => {
    expect(isHouseTechnique('stat-counter')).toBe(true)
    expect(isHouseTechnique('ledger-wipe')).toBe(false)
    expect(ChannelTechniqueKeySchema.safeParse('stat-counter').success).toBe(false)
    expect(ChannelTechniqueKeySchema.safeParse('ledger-wipe').success).toBe(true)
  })

  it('a steer phrase is two to four plain words, lower-cased', () => {
    expect(SteerPhraseSchema.parse(' Ledger Wipe ')).toBe('ledger wipe')
    expect(SteerPhraseSchema.safeParse('wipe').success).toBe(false)
    expect(SteerPhraseSchema.safeParse('the ledger wipes across all').success).toBe(false)
    expect(SteerPhraseSchema.safeParse('ledger-wipe').success).toBe(false)
    expect(SteerPhraseSchema.safeParse('ledger  wipe').success).toBe(false)
  })

  it('a proposal holds its slot on the clock and names at least one mechanism', () => {
    expect(TechniqueProposalSchema.safeParse(proposal).success).toBe(true)
    const late = TechniqueProposalSchema.safeParse({
      ...proposal,
      slot: { ...proposal.slot, words: [...proposal.slot.words, { text: 'late', atMs: 6000 }] },
    })
    expect(late.success).toBe(false)
    expect(JSON.stringify(late.error?.issues)).toContain("a word sits past the slot's end")
    const unordered = TechniqueProposalSchema.safeParse({
      ...proposal,
      slot: { ...proposal.slot, words: [...proposal.slot.words].reverse() },
    })
    expect(unordered.success).toBe(false)
    expect(JSON.stringify(unordered.error?.issues)).toContain('not in order on the clock')
    expect(TechniqueProposalSchema.safeParse({ ...proposal, mechanisms: [] }).success).toBe(false)
    const twice = TechniqueProposalSchema.safeParse({
      ...proposal,
      steerPhrases: ['ledger wipe', 'Ledger wipe'],
    })
    expect(twice.success).toBe(false)
    expect(JSON.stringify(twice.error?.issues)).toContain('a phrase is named twice')
    expect(
      TechniqueProposalSchema.safeParse({
        ...proposal,
        slot: { ...proposal.slot, durationMs: 2000 },
      }).success,
    ).toBe(false)
    expect(TechniqueProposalSchema.safeParse({ ...proposal, key: 'bar-chart' }).success).toBe(false)
  })

  it('the answer is a proposal or null with a why', () => {
    expect(
      TechniqueProposalAnswerSchema.safeParse({ proposal: null, why: 'covered' }).success,
    ).toBe(true)
    expect(TechniqueProposalAnswerSchema.safeParse({ proposal, why: 'a new move' }).success).toBe(
      true,
    )
    expect(TechniqueProposalAnswerSchema.safeParse({ proposal: null }).success).toBe(false)
    expect(
      TechniqueProposalAnswerSchema.safeParse({
        proposal: null,
        why: 'a'.repeat(PROPOSAL_WHY_MAX + 1),
      }).success,
    ).toBe(false)
  })

  it('a derivation proposal and a channel technique carry a channel key', () => {
    expect(
      DerivationProposalSchema.safeParse({
        state: 'proposed',
        technique: 'ledger-wipe',
        reason: null,
      }).success,
    ).toBe(true)
    expect(
      DerivationProposalSchema.safeParse({ state: 'none', technique: null, reason: 'covered' })
        .success,
    ).toBe(true)
    expect(
      DerivationProposalSchema.safeParse({ state: 'done', technique: null, reason: null }).success,
    ).toBe(false)
    expect(
      ChannelTechniqueSchema.safeParse({
        technique: 'ledger-wipe',
        description: 'a wipe',
        steerPhrases: ['ledger wipe'],
      }).success,
    ).toBe(true)
    expect(
      ChannelTechniqueSchema.safeParse({
        technique: 'stat-counter',
        description: 'a wipe',
        steerPhrases: ['ledger wipe'],
      }).success,
    ).toBe(false)
  })
})
