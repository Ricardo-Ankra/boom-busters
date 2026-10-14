import { describe, expect, it } from 'vitest'
import { deriveIngredients, openingIsStale, syntheticLikenesses } from './publish-review'

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
 * Decision 301: a source line says what it backs, read from the claims and
 * the article records already on file; and an opening saved for an earlier
 * script is flagged rather than published under a rewritten film.
 */
describe('deriveIngredients sources (decision 301)', () => {
  const claim = (text: string, sourceUrl: string | null, confidence = 'sourced') => ({
    text,
    sourceUrl,
    confidence,
    quarantined: false,
  })

  it('labels each source from the outlet on file, else the host, and the first claim citing it', () => {
    const { sources } = deriveIngredients({
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
      outlets: new Map([['https://forbes.com/sites/x/2023/06/04/y', 'Forbes']]),
    })
    expect(sources).toEqual([
      {
        url: 'https://www.forbes.com/sites/x/2023/06/04/y',
        label: 'Forbes, Forbes reported that Mostaque overstated his role',
      },
      {
        url: 'https://stability.ai/news',
        label: 'stability.ai, Stability AI announced a 101 million dollar round',
      },
    ])
  })
})

describe('openingIsStale (decision 301)', () => {
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
