import { applyScores } from '@boom-busters/schemas'
import type { SlotCandidate, StockBrief, ArchivalBrief } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildScoringRequest, mockScores, parseScores } from './scoring'

const CANDIDATES: SlotCandidate[] = [
  {
    id: 'a1',
    provider: 'pexels',
    kind: 'image',
    sourceUrl: 'https://images.pexels.com/a1.jpg',
    licence: 'Pexels License',
    summary: 'Empty office with rows of desks at dusk',
    width: 5184,
    height: 3456,
  },
  {
    id: 'b2',
    provider: 'pixabay',
    kind: 'video',
    sourceUrl: 'https://cdn.pixabay.com/b2.mp4',
    licence: 'Pixabay Content License',
    durationMs: 16000,
  },
]

const STOCK_BRIEF: StockBrief = {
  type: 'stock',
  coversText: 'By June, the auditors could not find the money.',
  description: 'Deserted open-plan office at dusk, cool blue grade.',
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'empty office dusk',
  rejectionCriteria: ['no watermarks', 'no modern laptops'],
}

describe('buildScoringRequest', () => {
  it('batches every candidate into one shotlist-task call', () => {
    const request = buildScoringRequest({ brief: STOCK_BRIEF, candidates: CANDIDATES })
    expect(request.task).toBe('shotlist')
    expect(request.messages[1]?.content).toContain('(id: a1)')
    expect(request.messages[1]?.content).toContain('(id: b2)')
  })

  it('turns rejection criteria into hard score caps', () => {
    const request = buildScoringRequest({ brief: STOCK_BRIEF, candidates: CANDIDATES })
    expect(request.system).toContain('AT MOST 20')
    expect(request.system).toContain('no modern laptops')
  })

  it('scores archival candidates against mustShow and era', () => {
    const archival: ArchivalBrief = {
      type: 'archival',
      coversText: 'The headquarters in Aschheim.',
      description: 'The Wirecard building.',
      motion: { kind: 'static' },
      transition: 'cut',
      query: 'Wirecard headquarters',
      mustShow: 'the Aschheim headquarters building',
      eraRange: '2015-2020',
    }
    const request = buildScoringRequest({ brief: archival, candidates: CANDIDATES })
    expect(request.system).toContain('MUST show: the Aschheim headquarters building')
    expect(request.system).toContain('Acceptable era: 2015-2020')
  })

  it('says when a candidate had no description, rather than omitting it', () => {
    const request = buildScoringRequest({ brief: STOCK_BRIEF, candidates: CANDIDATES })
    expect(request.messages[1]?.content).toContain('(no description from the source)')
  })
})

describe('parseScores + applyScores', () => {
  it('merges scores by id and orders best-first', () => {
    const scores = parseScores(
      JSON.stringify({
        scores: [
          { id: 'a1', score: 40, reason: 'Subject matches, era unclear.' },
          { id: 'b2', score: 85, reason: 'Clip metadata matches the brief.' },
        ],
      }),
    )
    const ranked = applyScores(CANDIDATES, scores)
    expect(ranked.map((candidate) => candidate.id)).toEqual(['b2', 'a1'])
    expect(ranked[0]?.scoreReason).toContain('Clip metadata')
  })

  it('leaves an unjudged candidate unscored and last — visible, not dropped', () => {
    const ranked = applyScores(
      CANDIDATES,
      parseScores(JSON.stringify({ scores: [{ id: 'b2', score: 60, reason: 'ok' }] })),
    )
    expect(ranked[ranked.length - 1]?.id).toBe('a1')
    expect(ranked[ranked.length - 1]?.score).toBeUndefined()
  })
})

describe('mockScores', () => {
  it('is deterministic and non-uniform, so sorting stays tested', () => {
    const first = mockScores(CANDIDATES)
    expect(first).toEqual(mockScores(CANDIDATES))
    const values = first.scores.map((entry) => entry.score)
    expect(new Set(values).size).toBe(values.length)
  })
})
