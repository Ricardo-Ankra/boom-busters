import { describe, expect, it } from 'vitest'
import { unscoredDistinctTitles } from './title-scores'

describe('unscoredDistinctTitles', () => {
  it('lists the titles with no score, in order', () => {
    expect(unscoredDistinctTitles(['A', 'B', 'C'], { B: 50 })).toEqual(['A', 'C'])
  })

  it('counts case-variants once, keeping the first spelling', () => {
    expect(unscoredDistinctTitles(['Same title', 'SAME TITLE', 'Other'], {})).toEqual([
      'Same title',
      'Other',
    ])
  })

  it('treats a title as scored when any case-variant has a score, even a null one', () => {
    expect(
      unscoredDistinctTitles(['Same title', 'SAME TITLE', 'Other'], { 'same title': null }),
    ).toEqual(['Other'])
  })

  it('is empty when every title is scored', () => {
    expect(unscoredDistinctTitles(['A'], { A: 1 })).toEqual([])
  })
})
