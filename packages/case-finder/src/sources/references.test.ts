import { describe, expect, it } from 'vitest'
import { isPrimaryReference, referencesAsDocuments } from './references'

describe('isPrimaryReference', () => {
  it('isPrimaryReference', () => {
    expect(isPrimaryReference('https://www.sec.gov/litigation/x')).toBe(true)
    expect(isPrimaryReference('https://www.parliament.uk/business/x')).toBe(true)
    expect(isPrimaryReference('https://oig.dol.gov/report')).toBe(true)
    expect(isPrimaryReference('https://nytimes.com/a')).toBe(false)
    expect(isPrimaryReference('https://gov.example.com/a')).toBe(false)
  })

  it('matches subdomains and suffixes, not look-alike hosts', () => {
    expect(isPrimaryReference('https://efts.sec.gov/x')).toBe(true)
    expect(isPrimaryReference('https://www.justice.gov.uk/x')).toBe(true)
    expect(isPrimaryReference('https://notsec.gov.evil.com/x')).toBe(false)
    expect(isPrimaryReference('https://fakesec.gov.example/x')).toBe(false)
    expect(isPrimaryReference('https://mysec.gov.example/x')).toBe(false)
    expect(isPrimaryReference('https://notjustice.gov.example/x')).toBe(false)
    expect(isPrimaryReference('https://www.gov.uk/x')).toBe(true)
    expect(isPrimaryReference('https://europa.eu/x')).toBe(true)
    expect(isPrimaryReference('https://sec.gov./x')).toBe(true)
    expect(isPrimaryReference('https://notgov.uk/x')).toBe(false)
    expect(isPrimaryReference('not a url')).toBe(false)
  })
})

describe('referencesAsDocuments', () => {
  it('keeps primary links, dedupes, and dates them to the revision', () => {
    const docs = referencesAsDocuments(
      [
        'https://www.sec.gov/litigation/a.pdf',
        'https://nytimes.com/x',
        'https://www.sec.gov/litigation/a.pdf',
      ],
      '2020-05-04T10:11:12Z',
    )
    expect(docs).toEqual([
      {
        url: 'https://www.sec.gov/litigation/a.pdf',
        title: 'www.sec.gov/litigation/a.pdf',
        source: 'wikipedia-reference',
        datedAt: '2020-05-04',
      },
    ])
  })
})
