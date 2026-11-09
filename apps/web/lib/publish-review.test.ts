import { describe, expect, it } from 'vitest'
import {
  deriveIngredients,
  liveSearchReport,
  livePublishedAt,
  openingIsStale,
  syntheticLikenesses,
} from './publish-review'

/**
 * The label rule (decision 252): a generated still that depicts a real
 * person sets YouTube's altered-content flag; an uploaded real photograph of
 * the same person does not, and neither does a still nobody chose.
 */

const stillBrief = (depicts: string[]) => ({
  type: 'still',
  coversText: 'x',
  description: 'x',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'p',
  depicts,
})

const candidate = (provider: string, chosen: boolean) => ({
  id: `${provider}-1`,
  provider,
  kind: 'image',
  sourceUrl: 'generated://x',
  licence: 'Generated',
  chosen,
})

describe('syntheticLikenesses', () => {
  it('lists the people shown by a chosen, generated still, once each', () => {
    const slots = [
      { brief: stillBrief(['Markus Braun']), candidates: [candidate('google', true)] },
      { brief: stillBrief(['Markus Braun', 'Jan Marsalek']), candidates: [candidate('fal', true)] },
    ]
    expect(syntheticLikenesses(slots)).toEqual(['Markus Braun', 'Jan Marsalek'])
  })

  it('ignores an uploaded real photograph, an unchosen generation and a brief with no depicts', () => {
    const slots = [
      { brief: stillBrief(['Jan Marsalek']), candidates: [candidate('upload', true)] },
      { brief: stillBrief(['Markus Braun']), candidates: [candidate('google', false)] },
      { brief: stillBrief([]), candidates: [candidate('google', true)] },
      {
        brief: {
          type: 'stock',
          coversText: 'x',
          description: 'x',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'q',
          rejectionCriteria: [],
        },
        candidates: [candidate('pexels', true)],
      },
    ]
    expect(syntheticLikenesses(slots)).toEqual([])
  })

  it('survives a brief or candidate list that no longer parses', () => {
    expect(
      syntheticLikenesses([{ brief: { type: 'nonsense' }, candidates: 'not a list' }]),
    ).toEqual([])
  })

  it("counts a likeness reused into a stock slot, through the copy's own record (decision 261)", () => {
    const slots = [
      {
        brief: {
          type: 'stock',
          coversText: 'x',
          description: 'x',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'q',
          rejectionCriteria: [],
        },
        candidates: [
          {
            ...candidate('google', true),
            reusedFrom: { slotId: '01J000000000000000000000AA', depicts: ['Jan Marsalek'] },
          },
        ],
      },
    ]
    expect(syntheticLikenesses(slots)).toEqual(['Jan Marsalek'])
  })
})

describe('syntheticLikenesses with the cast', () => {
  it('reports an entry that names a member with their role as the member, once', () => {
    const slots = [
      { brief: stillBrief(['Emad Mostaque']), candidates: [candidate('google', true)] },
      {
        brief: stillBrief([
          'Emad Mostaque, founder and former CEO of Stability AI',
          'Nobody Known',
        ]),
        candidates: [candidate('fal', true)],
      },
    ]
    expect(syntheticLikenesses(slots, ['Emad Mostaque'])).toEqual(['Emad Mostaque', 'Nobody Known'])
  })
})

/**
 * Decision 303: a source line says what it backs, read from the claims and
 * the article records already on file; and an opening saved for an earlier
 * script is flagged rather than published under a rewritten film.
 */
describe('deriveIngredients sources (decision 303)', () => {
  const claim = (text: string, sourceUrl: string | null, confidence = 'sourced') => ({
    text,
    sourceUrl,
    confidence,
    quarantined: false,
  })

  it("labels each source with the outlet's own headline on file, else the outlet or host alone", () => {
    const { sources } = deriveIngredients({
      format: { introLine: '', outroLine: '' },
      master: null,
      scriptChapters: [],
      claims: [
        claim(
          'Forbes reported that Mostaque overstated his role.',
          'https://www.forbes.com/sites/x/2023/06/04/y',
        ),
        claim(
          'Mostaque disputed parts of the reporting.',
          'https://www.forbes.com/sites/x/2023/06/04/y',
        ),
        claim('Stability AI announced a 101 million dollar round.', 'https://stability.ai/news'),
        claim('Unverified gossip.', 'https://gossip.example/a', 'unverified'),
      ],
      articles: new Map([
        [
          'https://forbes.com/sites/x/2023/06/04/y',
          {
            outlet: 'Forbes',
            headline: "Stable Diffusion's Founder Has A Track Record Of Exaggeration",
          },
        ],
      ]),
    })
    expect(sources).toEqual([
      {
        url: 'https://www.forbes.com/sites/x/2023/06/04/y',
        label: 'Forbes, "Stable Diffusion\'s Founder Has A Track Record Of Exaggeration"',
      },
      { url: 'https://stability.ai/news', label: 'stability.ai' },
    ])
  })
})

describe('openingIsStale (decision 303)', () => {
  const hook = 'March 2024. Emad Mostaque resigned.'

  it('flags an opening saved for an earlier script, and one saved before versions were kept', () => {
    expect(
      openingIsStale({ body: 'An old opening.', bodyScriptVersion: 2, hook, scriptVersion: 4 }),
    ).toBe(true)
    expect(
      openingIsStale({
        body: 'An old opening.',
        bodyScriptVersion: undefined,
        hook,
        scriptVersion: 4,
      }),
    ).toBe(true)
  })

  it('never flags a current opening, the current hook itself, or no opening at all', () => {
    expect(
      openingIsStale({ body: 'Written for v4.', bodyScriptVersion: 4, hook, scriptVersion: 4 }),
    ).toBe(false)
    expect(
      openingIsStale({ body: ` ${hook} `, bodyScriptVersion: undefined, hook, scriptVersion: 4 }),
    ).toBe(false)
    expect(
      openingIsStale({ body: undefined, bodyScriptVersion: undefined, hook, scriptVersion: 4 }),
    ).toBe(false)
    expect(openingIsStale({ body: '   ', bodyScriptVersion: 1, hook, scriptVersion: 4 })).toBe(
      false,
    )
  })
})

describe('liveSearchReport', () => {
  const snapshot = {
    views: 4_000,
    avgViewDurationSec: 280,
    retentionCurve: null,
    searchTerms: [
      { term: 'the enron collapse', views: 300, minutes: 900 },
      { term: 'odd search', views: 40, minutes: 10 },
    ],
    subscribersGained: 12,
    likes: 100,
    comments: 8,
    ctrBySource: { YT_SEARCH: 1_000 },
  }
  const brief = {
    targetKeyword: { keyword: 'enron collapse' },
    secondaryKeywords: [],
    searchedQuestions: [],
    angleOptions: [],
    chosenAngle: null,
    recommendedAngle: null,
  } as never
  const base = {
    snapshot,
    publishedAt: new Date('2026-10-01T15:00:00Z'),
    durationSec: 900,
    brief,
    language: 'en',
    now: new Date('2026-11-09T06:00:00Z'),
  }

  it('places terms by words alone and runs from the publish day to today', () => {
    const report = liveSearchReport({ ...base, anyFrozen: false })
    expect(report.range).toEqual({ start: '2026-10-01', end: '2026-11-09' })
    expect(report.matching).toBe('none')
    expect(report.searchViews).toBe(1_000)
    expect(report.terms.find((t) => t.term === 'the enron collapse')?.bucket).toBe('target')
    expect(report.terms.find((t) => t.term === 'odd search')?.bucket).toBe('unmatched')
    // No other videos: every baseline is the video's own figure.
    expect(report.baselines.searchHoldSec.basis).toBe('own')
  })

  it('is too early until a report has frozen, and judged by the numbers after', () => {
    expect(liveSearchReport({ ...base, anyFrozen: false }).outcome).toBe('too-early')
    expect(liveSearchReport({ ...base, anyFrozen: true }).outcome).not.toBe('too-early')
  })

  it('lists every term as unmatched when there is no brief', () => {
    const report = liveSearchReport({ ...base, brief: null, anyFrozen: false })
    expect(report.targetKeyword).toBeNull()
    expect(report.terms.every((t) => t.bucket === 'unmatched')).toBe(true)
  })
})

describe('livePublishedAt', () => {
  const scheduled = new Date('2026-10-01T15:00:00Z')
  const firstSnapshot = new Date('2026-10-02T00:00:00Z')
  const edited = new Date('2026-11-07T09:00:00Z')

  it('uses the scheduled time when the record has one', () => {
    expect(livePublishedAt({ publishAt: scheduled, updatedAt: edited }, firstSnapshot)).toBe(
      scheduled,
    )
  })

  it('uses the first snapshot, not the last edit, when nothing was scheduled', () => {
    expect(livePublishedAt({ publishAt: null, updatedAt: edited }, firstSnapshot)).toBe(
      firstSnapshot,
    )
  })

  it('falls back to the last update only when there is no snapshot', () => {
    expect(livePublishedAt({ publishAt: null, updatedAt: edited }, null)).toBe(edited)
  })

  it('is null without a record', () => {
    expect(livePublishedAt(null, firstSnapshot)).toBeNull()
  })
})
