import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { dayRange, monthRange, type PageviewsSource } from './pageviews'
import type { EntityFacts, WikidataSource } from './wikidata'

/**
 * Deterministic mock sources for mock-provider mode and tests. Nothing here
 * resembles real data: titles say "Mock", and series are a pure function of
 * the title so a run is repeatable and two titles never share a curve.
 */

/** A stable unsigned integer from a string. */
function hash(text: string): number {
  return createHash('sha1').update(text).digest().readUInt32BE(0)
}

/** Views for one title and period key: a title-specific base with a small period wobble. */
function mockViews(titles: string[], period: string): number {
  return titles.reduce((sum, title) => {
    const base = 200 + (hash(title) % 5000)
    const wobble = hash(`${title}|${period}`) % Math.max(1, Math.floor(base / 4))
    return sum + base + wobble
  }, 0)
}

export const mockPageviews: PageviewsSource = {
  async monthly(project, titles, from, to) {
    return monthRange(from, to).map((month) => ({
      month,
      views: mockViews(
        titles.map((t) => `${project}|${t}`),
        month,
      ),
    }))
  },
  async daily(project, titles, from, to) {
    return dayRange(from, to).map((date) => ({
      date,
      views: Math.floor(
        mockViews(
          titles.map((t) => `${project}|${t}`),
          date,
        ) / 30,
      ),
    }))
  },
}

export const mockWikidata: WikidataSource = {
  /** The mock has no query engine; it answers an empty result set if the schema accepts one. */
  async sparql<T>(_query: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse({ results: { bindings: [] } })
  },
  async facts(qids) {
    const out = new Map<string, EntityFacts>()
    for (const qid of qids) {
      const title = `Mock entity ${qid}`
      out.set(qid, {
        qid,
        enTitle: title,
        sitelinks: { enwiki: title, dewiki: `${title} (de)` },
        country: 'Q30',
        cik: null,
        dissolved: null,
        people: [
          { qid: `${qid}0`, name: `Mock founder of ${qid}`, living: true, convicted: false },
        ],
      })
    }
    return out
  },
}
