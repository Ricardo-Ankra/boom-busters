import { describe, expect, it } from 'vitest'
import { foldText, locatorSeconds, quoteFound, registrableDomain } from './fold'

describe('quote folding', () => {
  it('finds a quote across curly quotes, dashes and line breaks', () => {
    const text = 'EY said it could not verify\n“around €1.9 billion” – in trustee balances.'
    expect(quoteFound(text, 'could not verify "around €1.9 billion" - in trustee')).toEqual({
      found: true,
      offset: 11,
    })
  })
  it('refuses a paraphrase and a short quote', () => {
    expect(
      quoteFound('The company filed for insolvency.', 'The firm filed for insolvency').found,
    ).toBe(false)
    expect(quoteFound('The company filed for insolvency.', 'filed for').found).toBe(false)
  })
  it('finds a quote across a transcript marker and locates it at the earlier marker', () => {
    const text = '[00:05] they said the money was there [00:09] and it never was'
    const hit = quoteFound(text, 'the money was there and it never was')
    expect(hit.found).toBe(true)
    expect(locatorSeconds(text, hit.offset!)).toBe(5)
  })
  it('maps offsets back to the original text', () => {
    const { map } = foldText('A—B')
    expect(map).toEqual([0, 1, 2])
  })
  it('reduces hosts to registrable domains', () => {
    expect(registrableDomain('https://www.ft.com/content/x')).toBe('ft.com')
    expect(registrableDomain('https://news.bbc.co.uk/x')).toBe('bbc.co.uk')
    expect(registrableDomain('https://asic.gov.au/x')).toBe('asic.gov.au')
  })
})
