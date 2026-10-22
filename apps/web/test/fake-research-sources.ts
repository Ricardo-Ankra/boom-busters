import type { ResearchSources } from '@/lib/research-sources'

/**
 * Research sources for tests, with no network behind them. Every source a test
 * does not set throws when called, so a test that reaches one it did not plan
 * for fails loudly instead of quietly gathering nothing.
 */

export function unexpected(name: string) {
  return () => {
    throw new Error(`unexpected call to ${name}`)
  }
}

export const FAKE_USER_AGENT = 'boom-busters-case-finder/1.0 (+test@example.invalid)'

export function fakeSources(over: Partial<ResearchSources> = {}): ResearchSources {
  return {
    wikipedia: {
      categoryMembers: unexpected('categoryMembers'),
      listLinks: unexpected('listLinks'),
      redirectsTo: unexpected('redirectsTo'),
      formerTitles: unexpected('formerTitles'),
      qidsFor: unexpected('qidsFor'),
      revisionBefore: unexpected('revisionBefore'),
      parsed: unexpected('parsed'),
      search: unexpected('search'),
      currentItems: unexpected('currentItems'),
    },
    wikidata: { sparql: unexpected('sparql'), facts: unexpected('facts') },
    edgar: {
      filings: unexpected('filings'),
      exhibits: unexpected('exhibits'),
      latestFiling: unexpected('latestFiling'),
    },
    courtlistener: { dockets: unexpected('dockets') },
    youtube: null,
    transcripts: null,
    stooq: { daily: unexpected('daily') },
    wayback: { captures: unexpected('captures') },
    xbrl: { companyFacts: unexpected('companyFacts') },
    fetchDocument: unexpected('fetchDocument'),
    userAgent: FAKE_USER_AGENT,
    ...over,
  }
}
