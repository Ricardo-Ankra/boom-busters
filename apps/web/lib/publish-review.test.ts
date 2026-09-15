import { describe, expect, it } from 'vitest'
import { syntheticLikenesses } from './publish-review'

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
})
