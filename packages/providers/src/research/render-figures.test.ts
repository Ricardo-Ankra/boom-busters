import { describe, expect, it } from 'vitest'
import { pricesText, xbrlFactsText } from './render-figures'
import { fixture } from './test-fixtures'

describe('xbrlFactsText', () => {
  it('renders annual xbrl facts one line per year', () => {
    const out = xbrlFactsText(JSON.parse(fixture('companyfacts.json')))
    expect(out).toContain('Revenues | 2022 | 7432000000 | USD')
    expect(out).not.toContain('1900000000')
    expect(out.indexOf('Revenues | 2021')).toBeLessThan(out.indexOf('Revenues | 2022'))
  })

  it('returns an empty string for a shape it does not know', () => {
    expect(xbrlFactsText({})).toBe('')
    expect(xbrlFactsText(null)).toBe('')
  })
})

describe('pricesText', () => {
  it('renders month-end closes', () => {
    const out = pricesText(fixture('stooq.csv'))
    expect(out).toContain('2020-06 | 1.28')
    expect(out).toContain('2020-05 | 1.15')
    expect(out).not.toContain('1.27')
  })
})
