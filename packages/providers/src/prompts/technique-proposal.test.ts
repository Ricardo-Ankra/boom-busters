import { DEFAULT_MOTION_IDENTITY, ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { MANIFEST } from '../exemplars/manifest'
import type { ReadingForDraft } from './motion'
import {
  TECHNIQUE_PROPOSAL_OUTPUT_TOKENS,
  buildTechniqueProposalRequest,
  mockTechniqueProposal,
  parseTechniqueProposal,
  type TechniqueProposalInput,
} from './technique-proposal'

/**
 * The technique proposal (spec 2026-11-04, section 8.5, second paragraph):
 * one call that reads the mechanism references and answers a technique of
 * the channel's own, or none. Text only; no bible, so not a lift case of
 * the bible's, though it has a lift fixture of its own.
 */

const mechanismReading: ReadingForDraft = {
  title: 'Ledger scene',
  purpose: 'mechanism',
  negative: false,
  carryOver: 'the ruled line that wipes the old figure away',
  avoid: '',
  reading: {
    medium: 'flat typography over paper',
    palette: ['#111', '#eee'],
    type: 'grotesk, heavy',
    enters: 'written in',
    exits: 'wiped by a rule',
    motion: 'one line travels and the figure behind it changes',
    absent: 'no glow',
    notes: '',
    readAt: '2026-11-04T00:00:00.000Z',
    model: 'test/model',
  },
}

const INPUT: TechniqueProposalInput = {
  motion: { ...DEFAULT_MOTION_IDENTITY, styleGuideMd: 'Dark, slow, one figure at a time.' },
  readings: [mechanismReading],
  catalogue: MANIFEST.map((entry) => ({
    technique: entry.technique,
    description: entry.description,
    mechanisms: entry.mechanisms,
  })),
  channelTechniques: [
    { technique: 'ink-blot', description: 'an ink blot spreads', steerPhrases: ['ink blot'] },
  ],
}

const proposal = {
  key: 'ledger-wipe',
  name: 'Ledger wipe',
  description: 'a ruled line wipes the old figure away and the new one is written behind it',
  steerPhrases: ['ledger wipe'],
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

describe('buildTechniqueProposalRequest (spec 8.5)', () => {
  it('asks for one technique or none from the mechanism readings, with the catalogue and the channel keys', () => {
    const request = buildTechniqueProposalRequest(INPUT)
    expect(request.task).toBe('graphics')
    expect(request.maxTokens).toBeGreaterThanOrEqual(TECHNIQUE_PROPOSAL_OUTPUT_TOKENS)
    const text = request.messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    for (const entry of MANIFEST) expect(text).toContain(`- ${entry.technique}:`)
    expect(text).toContain('ink-blot')
    expect(text).toContain("'ink blot'")
    expect(text).toContain('"Ledger scene"')
    expect(text).toContain('Carry over:')
    expect(text).toContain('Dark, slow, one figure at a time.')
    expect(JSON.stringify(request)).not.toContain('"image"')
    expect(request.system).toContain('"proposal": null')
  })

  it('retries with the rejection first', () => {
    const request = buildTechniqueProposalRequest({ ...INPUT, rejection: 'The key is taken' })
    const last = request.messages.at(-1)!
    expect(
      typeof last.content === 'string' && last.content.startsWith('The previous proposal'),
    ).toBe(true)
    expect(JSON.stringify(request)).toContain('The key is taken')
  })

  it('writes no dash a reader would see', () => {
    const request = buildTechniqueProposalRequest(INPUT)
    expect(JSON.stringify(request)).not.toMatch(/[–—]/)
  })
})

describe('parseTechniqueProposal', () => {
  it('parses a proposal and a null answer', () => {
    const answer = parseTechniqueProposal(JSON.stringify({ proposal, why: 'a new move' }), {
      keys: ['ink-blot'],
    })
    expect(answer.proposal?.key).toBe('ledger-wipe')
    const none = parseTechniqueProposal(JSON.stringify({ proposal: null, why: 'covered' }), {
      keys: [],
    })
    expect(none.proposal).toBeNull()
    expect(none.why).toBe('covered')
  })

  it('refuses a house key, a held key and a phrase the house list claims', () => {
    const parse =
      (patch: Record<string, unknown>, keys: string[] = []) =>
      () =>
        parseTechniqueProposal(JSON.stringify({ proposal: { ...proposal, ...patch }, why: 'x' }), {
          keys,
        })
    expect(parse({ key: 'stat-counter' })).toThrow(ValidationError)
    expect(parse({ key: 'stat-counter' })).toThrow(/already a technique/)
    expect(parse({}, ['ledger-wipe'])).toThrow(/already a technique/)
    expect(parse({ steerPhrases: ['word stack'] })).toThrow(/already reaches kinetic-word-stack/)
    expect(parse({ steerPhrases: ['ledger wipe', 'pie chart'] })).toThrow(
      /"pie chart" already reaches donut-chart/,
    )
  })

  it('mocks a proposal from the first read mechanism reference and none without one', () => {
    const mocked = mockTechniqueProposal([
      { ...mechanismReading, purpose: 'look' },
      mechanismReading,
      { ...mechanismReading, title: 'Second' },
    ])
    expect(mocked.proposal?.key).toBe('mock-move')
    expect(mocked.proposal?.fromReference).toBe('Ledger scene')
    expect(mocked.proposal?.steerPhrases).toEqual(['mock move'])
    expect(mocked.proposal?.slot.words.length).toBeGreaterThan(0)
    expect(mocked.why).toMatch(/^\[mock\]/)
    const none = mockTechniqueProposal([
      { ...mechanismReading, negative: true },
      { ...mechanismReading, reading: null },
    ])
    expect(none.proposal).toBeNull()
    expect(none.why).toMatch(/^\[mock\]/)
  })
})
