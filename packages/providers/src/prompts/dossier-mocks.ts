import type { CaseBrief, ResearchAnswers, ResearchClaim, Scene } from '@boom-busters/schemas'
import type { CaseContext } from './dossier'

/**
 * Deterministic mock research over `mockCorpusDocuments()`. Says loudly that
 * it researched nothing, for the same reason the mock case suggestions do: a
 * dossier that reads plausibly is one somebody will eventually approve by
 * accident.
 *
 * The mocks cite the four mock documents by number so grounding exercises
 * every check: a claim found in two documents on different hosts, a claim
 * whose quote is in no document (it stays unverified, which keeps the e2e
 * fixture parked at the gate), a figure series printed in the press release,
 * a ruling on the regulator page, a scene in the transcript with a time, and
 * one beat an earlier video told.
 */
export function mockBrief(input: CaseContext): CaseBrief {
  return {
    summary:
      `MOCK DOSSIER for "${input.title}". No research was performed and no provider was ` +
      'called: the documents cited are fixture text written for mock mode. Every statement ' +
      'below is placeholder text generated locally. Do not approve this dossier expecting it ' +
      'to describe anything that happened.',
    turningPoint: 'The mock turning point, which is that this is not a real dossier.',
    cast: [
      {
        name: 'Placeholder Person',
        role: 'mock chief executive',
        wanted: 'Wanted the mock growth story to outlast the mock ledger.',
        scene: { doc: 1, quote: 'said the mock growth would continue' },
      },
    ],
    toldAlready: [
      {
        beat: 'Existing mock videos say the cash simply vanished overnight.',
        doc: 3,
        quote: 'the cash simply vanished overnight',
      },
    ],
    openQuestions: [
      'What did the mock regulator decide about the mock ledger?',
      'Everything else. Nothing here was researched.',
    ],
  }
}

export function mockScenes(): Scene[] {
  return [
    {
      when: 'Mock June 2018',
      who: 'Two mock auditors',
      what: 'Declined to sign the mock accounts.',
      why: 'The first mock sign that the mock ledger did not add up.',
      doc: 2,
      quote: 'Two mock auditors declined to sign the accounts',
    },
    {
      when: 'Mock 2019',
      who: 'Placeholder Person',
      what: 'Promised on a mock stage that the mock growth would never stop.',
      why: 'The mock high point the mock collapse falls from.',
      doc: 3,
      quote: 'promised the mock growth would never stop',
    },
  ]
}

export function mockClaims(): ResearchClaim[] {
  return [
    {
      text: 'MOCK CLAIM: the mock ledger listed cash that could not be confirmed.',
      supports: [
        { doc: 2, quote: 'the mock ledger listed cash that no bank could confirm' },
        { doc: 4, quote: 'mock ledger listed cash that did not exist' },
      ],
      legal: null,
      series: null,
    },
    {
      // Deliberately not in document 2: this claim stays unverified, so the
      // e2e fixture parks at the gate as a real dossier with a gap would.
      text: 'MOCK CLAIM: this quote is in no document, so the claim stays unverified.',
      supports: [{ doc: 2, quote: 'a sentence the mock article never printed' }],
      legal: null,
      series: null,
    },
    {
      text: 'MOCK CLAIM: Mockco reported mock revenue rising from 2017 to 2018.',
      supports: [{ doc: 1, quote: 'Revenue for 2018 was MOCK EUR 2,000,000,000' }],
      legal: null,
      series: {
        label: 'Mock revenue',
        unit: 'EUR',
        currency: 'EUR',
        points: [
          { at: '2017', value: 1_200_000_000, asWritten: 'MOCK EUR 1,200,000,000' },
          { at: '2018', value: 2_000_000_000, asWritten: 'MOCK EUR 2,000,000,000' },
        ],
      },
    },
    {
      text: 'MOCK CLAIM: the mock regulator ruled against Mockco in February 2019.',
      supports: [{ doc: 4, quote: 'the mock regulator ruled that Mockco' }],
      legal: { status: 'ruled', date: '2019-02', doc: 4 },
      series: null,
    },
  ]
}

/**
 * Mock answers: the first question answered from the regulator page, the
 * rest honestly null, so the review shows both an answered and an open
 * question without anything that reads like real research.
 */
export function mockAnswers(brief: CaseBrief): ResearchAnswers {
  return {
    answers: brief.openQuestions.map((question, at) =>
      at === 0
        ? {
            index: 1,
            question,
            answer:
              'MOCK ANSWER: the mock regulator ruled in February 2019 that the mock ledger ' +
              'listed cash that did not exist.',
            doc: 4,
          }
        : { index: at + 1, question, answer: null },
    ),
    claims: [],
  }
}
