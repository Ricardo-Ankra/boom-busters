import { describe, expect, it } from 'vitest'
import { formatPublished, splitHeadline } from './headline'

describe('formatPublished', () => {
  it('writes the date the way the card prints it', () => {
    expect(formatPublished('2023-03-14')).toBe('14 March 2023')
    expect(formatPublished('2019-01-01')).toBe('1 January 2019')
    expect(formatPublished('2020-12-31')).toBe('31 December 2020')
  })

  it('hands back anything it cannot read, rather than inventing a date', () => {
    expect(formatPublished('2023-13-01')).toBe('2023-13-01')
    expect(formatPublished('not a date')).toBe('not a date')
  })
})

describe('splitHeadline', () => {
  const headline = 'Auditors cannot find the $1.9 billion the company says it holds'

  it('splits around the phrase the marker draws under', () => {
    expect(splitHeadline(headline, '$1.9 billion')).toEqual({
      before: 'Auditors cannot find the ',
      hit: '$1.9 billion',
      after: ' the company says it holds',
    })
  })

  it('renders the headline whole when there is no emphasis', () => {
    expect(splitHeadline(headline)).toEqual({ before: headline, hit: '', after: '' })
    expect(splitHeadline(headline, '')).toEqual({ before: headline, hit: '', after: '' })
  })

  it('renders the headline whole rather than throwing on a phrase that is not in it', () => {
    expect(splitHeadline(headline, 'two billion')).toEqual({
      before: headline,
      hit: '',
      after: '',
    })
  })
})
