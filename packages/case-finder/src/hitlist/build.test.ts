import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import { describe, expect, it } from 'vitest'
import { mockPageviews, mockWikipedia } from '../sources/mock'
import type { EntityFacts, WikidataSource } from '../sources/wikidata'
import type { WikipediaSource } from '../sources/wikipedia'
import { monthRange, type PageviewsSource } from '../sources/pageviews'
import type { DatedTag } from '../types'
import { buildHitlist, laneOf, type HitlistDeps } from './build'
import {
  foundedBusinessesAmong,
  FOUNDER_CANDIDATES_QUERY,
  FOUNDER_CLASS_BATCH,
  loadLoPucki,
} from './seeds'

const uri = (qid: string) => `http://www.wikidata.org/entity/${qid}`

const facts = (
  qid: string,
  enTitle: string | null,
  kind: { instanceOf?: string[]; isClass?: boolean } = {},
): EntityFacts => ({
  qid,
  enTitle,
  sitelinks: enTitle === null ? { dewiki: 'Nur deutsch' } : { enwiki: enTitle },
  country: null,
  cik: null,
  dissolved: null,
  instanceOf: kind.instanceOf ?? [],
  isClass: kind.isClass ?? false,
  people: [],
})

interface Fixture {
  categories?: Record<string, string[]>
  lists?: Record<string, string[]>
  qids?: Record<string, string>
  facts?: Record<string, string | null>
  kinds?: Record<string, { instanceOf?: string[]; isClass?: boolean }>
  dissolved?: { qid: string; date: string }[]
  founders?: { qid: string; title: string }[]
  /** The candidates the class check returns; default: every founder candidate. */
  businesses?: string[]
  /** Every SPARQL query text sent, in order. */
  queries?: string[]
  /** Monthly views per title: a flat level, or a function of the month. */
  views?: Record<string, number | ((month: string) => number)>
  fortune?: Record<number, string>
  loPucki?: string
}

function deps(f: Fixture, log: string[] = []): HitlistDeps {
  const wikipedia: WikipediaSource = {
    ...mockWikipedia,
    categoryMembers: async (name) => f.categories?.[name] ?? [],
    listLinks: async (page) => f.lists?.[page] ?? [],
    qidsFor: async (titles) =>
      new Map(titles.flatMap((t) => (f.qids?.[t] ? [[t, f.qids[t]!] as const] : []))),
  }
  const wikidata: WikidataSource = {
    async sparql<T>(query: string, schema: ZodType<T>): Promise<T> {
      f.queries?.push(query)
      const asked = [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]!)
      const businesses = f.businesses ?? (f.founders ?? []).map((d) => d.qid)
      const titleOf = (q: string) => f.founders?.find((d) => d.qid === q)?.title ?? `Title ${q}`
      const bindings = query.includes('VALUES')
        ? asked
            .filter((q) => businesses.includes(q))
            .map((q) => ({ item: { value: uri(q) }, title: { value: titleOf(q) } }))
        : query.includes('P576')
          ? (f.dissolved ?? []).map((d) => ({
              item: { value: uri(d.qid) },
              dissolved: { value: `${d.date}T00:00:00Z` },
            }))
          : (f.founders ?? []).map((d) => ({ item: { value: uri(d.qid) } }))
      return schema.parse({ results: { bindings } })
    },
    async facts(qids) {
      const out = new Map<string, EntityFacts>()
      for (const q of qids) {
        const title = f.facts?.[q]
        if (title !== undefined) out.set(q, facts(q, title, f.kinds?.[q]))
      }
      return out
    },
  }
  const pageviews: PageviewsSource = {
    ...mockPageviews,
    monthly: async (_p, titles, from, to) => {
      const level = f.views?.[titles[0]!] ?? 0
      return monthRange(from, to).map((month) => ({
        month,
        views: typeof level === 'number' ? level : level(month),
      }))
    },
  }
  return {
    wikipedia,
    wikidata,
    pageviews,
    fetchText: async (url) => {
      const year = Number(/fortune500-(\d{4})\.csv/.exec(url)![1])
      const company = f.fortune?.[year]
      if (company === undefined) throw new Error('404')
      return `Rank,Company\n${company}`
    },
    loPuckiCsv: f.loPucki ?? null,
    log: (line) => log.push(line),
    now: () => new Date('2026-10-20T12:00:00Z'),
  }
}

const tag = (t: string, lane: 'downfall' | 'success', since: string | null = null): DatedTag => ({
  tag: t,
  lane,
  since,
})

describe('laneOf', () => {
  it('any downfall tag wins over success tags', () => {
    expect(laneOf([tag('a', 'success'), tag('b', 'downfall')])).toBe('downfall')
    expect(laneOf([tag('a', 'success')])).toBe('success')
    expect(laneOf([])).toBeNull()
  })
})

describe('buildHitlist', () => {
  it('build merges a company seeded twice into one entry with both tags', async () => {
    const entries = await buildHitlist(
      deps({
        categories: { 'Accounting scandals': ['Enron (company)'] },
        lists: { 'List of Ponzi schemes': ['Enron (company)', 'Madoff'] },
        qids: { 'Enron (company)': 'Q5', Madoff: 'Q7' },
        facts: { Q5: 'Enron (company)', Q7: 'Madoff' },
      }),
    )
    expect(entries.map((e) => e.qid)).toEqual(['Q5', 'Q7'])
    expect(entries[0]!.query).toBe('Enron')
    expect(entries[0]!.tags.map((t) => t.tag)).toEqual([
      'category:Accounting scandals',
      'list:List of Ponzi schemes',
    ])
    expect(entries[0]!.tags.every((t) => t.lane === 'downfall' && t.since === null)).toBe(true)
  })

  it('an entry with no English article keeps its sitelinks and a null query', async () => {
    const [entry] = await buildHitlist(
      deps({
        categories: { 'Corporate scandals': ['Wirecard'] },
        qids: { Wirecard: 'Q1' },
        facts: { Q1: null },
      }),
    )
    expect(entry).toMatchObject({ qid: 'Q1', enTitle: null, query: null })
    expect(entry!.sitelinks).toEqual({ dewiki: 'Nur deutsch' })
  })

  it('the Chapter 11 year tag carries its year as since', async () => {
    const [entry] = await buildHitlist(
      deps({
        categories: { 'Companies that filed for Chapter 11 bankruptcy in 2008': ['Lehman'] },
        qids: { Lehman: 'Q2' },
        facts: { Q2: 'Lehman' },
      }),
    )
    expect(entry!.tags).toEqual([
      tag(
        'category:Companies that filed for Chapter 11 bankruptcy in 2008',
        'downfall',
        '2008-01-01',
      ),
    ])
  })

  it('reads LoPucki with M/D/YYYY dates, and counts an unresolved name without failing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lopucki-'))
    const path = join(dir, 'lopucki.csv')
    writeFileSync(
      path,
      'Company Name,Date Filed\n"Kmart, Corp",1/22/2002\nGhost Ltd,3/4/2003\nBad,never\n',
    )
    const log: string[] = []
    const entries = await buildHitlist(
      deps(
        {
          loPucki: path,
          qids: { 'Kmart, Corp': 'Q3' },
          facts: { Q3: 'Kmart' },
        },
        log,
      ),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.tags).toEqual([tag('lopucki', 'downfall', '2002-01-22')])
    expect(log.some((l) => l.includes('lopucki=1') && l.includes('unresolved lopucki=1'))).toBe(
      true,
    )
    expect(loadLoPucki(path).map((r) => r.filed)).toEqual(['2002-01-22', '2003-03-04'])
  })

  it('hands the per-seed and unresolved counts to onSummary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lopucki-'))
    const path = join(dir, 'lopucki.csv')
    writeFileSync(path, 'Company Name,Date Filed\nKmart,1/22/2002\nGhost Ltd,3/4/2003\n')
    let summary: Parameters<NonNullable<HitlistDeps['onSummary']>>[0] | undefined
    await buildHitlist({
      ...deps({ loPucki: path, qids: { Kmart: 'Q3' }, facts: { Q3: 'Kmart' } }),
      onSummary: (s) => (summary = s),
    })
    expect(summary).toMatchObject({ unresolvedBySeed: { lopucki: 1 }, dropped: {} })
    expect(summary!.perSeed['lopucki']).toBe(1)
  })

  it('loadLoPucki returns [] and logs when the file is absent', () => {
    const log: string[] = []
    expect(loadLoPucki(null, (l) => log.push(l))).toEqual([])
    expect(loadLoPucki('Z:/no/such.csv', (l) => log.push(l))).toEqual([])
    expect(log).toHaveLength(2)
  })

  it('dates the dissolved-with-conviction tag from the dissolution and sizes a QID with no facts out', async () => {
    const log: string[] = []
    const entries = await buildHitlist(
      deps(
        {
          dissolved: [
            { qid: 'Q10', date: '2002-08-31' },
            { qid: 'Q11', date: '2005-01-01' },
          ],
          facts: { Q10: 'Arthur Andersen' },
        },
        log,
      ),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.tags).toEqual([
      tag('wikidata:dissolved-convicted', 'downfall', '2002-08-31'),
    ])
    expect(log.at(-1)).toContain('dropped no facts=1')
  })

  it('drops classes, people, countries and the other excluded kinds, counting each reason', async () => {
    const log: string[] = []
    let summary: Parameters<NonNullable<HitlistDeps['onSummary']>>[0] | undefined
    const entries = await buildHitlist({
      ...deps(
        {
          categories: {
            'Corporate scandals': ['Fraud', 'Madoff', 'Venezuela', 'Enron', 'Ghost', 'Big Short'],
          },
          qids: {
            Fraud: 'Q1',
            Madoff: 'Q2',
            Venezuela: 'Q3',
            Enron: 'Q4',
            Ghost: 'Q6',
            'Big Short': 'Q7',
          },
          facts: { Q1: 'Fraud', Q2: 'Madoff', Q3: 'Venezuela', Q4: 'Enron', Q7: 'The Big Short' },
          kinds: {
            Q1: { isClass: true, instanceOf: ['Q4830453'] },
            Q2: { instanceOf: ['Q5'] },
            Q3: { instanceOf: ['Q3624078', 'Q6256'] },
            Q4: { instanceOf: ['Q4830453'] },
            Q7: { instanceOf: ['Q11424'] },
          },
        },
        log,
      ),
      onSummary: (s) => (summary = s),
    })
    expect(entries.map((e) => e.qid)).toEqual(['Q4'])
    expect(summary!.dropped).toEqual({
      'no facts': 1,
      class: 1,
      'Q5 human': 1,
      'Q6256 country': 1,
      'Q11424 film': 1,
    })
    expect(log.at(-1)).toContain(
      'dropped class=1, Q5 human=1, Q6256 country=1, no facts=1, Q11424 film=1',
    )
  })

  it('tags a Fortune climber as success since the year met', async () => {
    const [entry] = await buildHitlist(
      deps({
        fortune: { 1980: '450,Apple', 1985: '100,Apple' },
        qids: { Apple: 'Q312' },
        facts: { Q312: 'Apple Inc.' },
      }),
    )
    expect(entry!.tags).toEqual([tag('fortune-climb', 'success', '1985-01-01')])
    expect(entry!.qid).toBe('Q312')
  })

  it('the founder seed keeps a business whose best 24-month median reached 1,000, downfall or not', async () => {
    const between = (from: string, to: string, views: number) => (month: string) =>
      month >= from && month <= to ? views : 0
    const entries = await buildHitlist(
      deps({
        categories: { 'Corporate scandals': ['Fallen'] },
        qids: { Fallen: 'Q22' },
        founders: [
          { qid: 'Q20', title: 'Popular' },
          { qid: 'Q21', title: 'Obscure' },
          { qid: 'Q22', title: 'Fallen' },
          { qid: 'Q23', title: 'Faded' },
          { qid: 'Q24', title: 'Flash' },
        ],
        views: {
          Popular: 1000,
          Obscure: 999,
          Fallen: 50000,
          // Popular for two years long before the build: still a founder-linked success seed.
          Faded: between('2016-01', '2017-12', 5000),
          // Eleven popular months never make half of any 24-month window.
          Flash: between('2016-01', '2016-11', 5000),
        },
        facts: { Q20: 'Popular', Q21: 'Obscure', Q22: 'Fallen', Q23: 'Faded', Q24: 'Flash' },
      }),
    )
    const byQid = Object.fromEntries(entries.map((e) => [e.qid, e.tags.map((t) => t.tag)]))
    expect(byQid).toEqual({
      Q20: ['founder-link'],
      Q22: ['category:Corporate scandals', 'founder-link'],
      Q23: ['founder-link'],
    })
    expect(entries[0]!.tags[0]).toEqual(tag('founder-link', 'success', null))
  })

  it('the founder seed leaves out a candidate the class check does not return', async () => {
    const entries = await buildHitlist(
      deps({
        founders: [
          { qid: 'Q20', title: 'Acme' },
          { qid: 'Q21', title: 'A person' },
        ],
        businesses: ['Q20'],
        views: { Acme: 5000, 'A person': 5000 },
        facts: { Q20: 'Acme', Q21: 'A person' },
      }),
    )
    expect(entries.map((e) => e.qid)).toEqual(['Q20'])
  })

  it('reads each founder series from 2015-07 to the month before the build month', async () => {
    const windows: [string, string][] = []
    const d = deps({ founders: [{ qid: 'Q20', title: 'Popular' }], facts: { Q20: 'Popular' } })
    d.pageviews = {
      ...mockPageviews,
      monthly: async (_p, _t, from, to) => {
        windows.push([from, to])
        return []
      },
    }
    await buildHitlist(d)
    expect(windows).toEqual([['2015-07', '2026-09']])
  })

  it('sorts entries by numeric QID', async () => {
    const entries = await buildHitlist(
      deps({
        categories: { 'Corporate scandals': ['A', 'B'] },
        qids: { A: 'Q100', B: 'Q9' },
        facts: { Q100: 'A', Q9: 'B' },
      }),
    )
    expect(entries.map((e) => e.qid)).toEqual(['Q9', 'Q100'])
  })
})

describe('founder candidates and the class check', () => {
  it('the candidates query has no class path, no sitelink join and no LIMIT', () => {
    expect(FOUNDER_CANDIDATES_QUERY).toContain('wdt:P112')
    expect(FOUNDER_CANDIDATES_QUERY).not.toMatch(/P31|P279|Q4830453/)
    expect(FOUNDER_CANDIDATES_QUERY).not.toMatch(/schema:|wikipedia\.org|\?title/)
    expect(FOUNDER_CANDIDATES_QUERY).not.toMatch(/LIMIT/i)
  })

  it('checks classes in batches of 250, in numeric QID order, and logs every 20 batches', async () => {
    const queries: string[] = []
    const log: string[] = []
    expect(FOUNDER_CLASS_BATCH).toBe(250)
    const total = FOUNDER_CLASS_BATCH * 100 + 7
    // Fed in reverse and as strings that sort differently as text.
    const qids = Array.from({ length: total }, (_, i) => `Q${total - i}`)
    const { wikidata } = deps({ queries, businesses: ['Q5', 'Q9999'] })
    const found = await foundedBusinessesAmong(qids, wikidata, (line) => log.push(line))
    expect([...found]).toEqual([
      ['Q5', 'Title Q5'],
      ['Q9999', 'Title Q9999'],
    ])
    expect(queries).toHaveLength(101)
    // The business class itself, Q4830453, is in the query but not in the VALUES batch.
    const values = (q: string) =>
      [...q.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]!).filter((id) => id !== 'Q4830453')
    const first = values(queries[0]!).map((id) => Number(id.slice(1)))
    expect(first).toEqual(Array.from({ length: FOUNDER_CLASS_BATCH }, (_, i) => i + 1))
    expect(queries[0]).toContain('VALUES ?item {')
    expect(queries[0]).toContain('wdt:P31/wdt:P279* wd:Q4830453')
    expect(queries[0]).toContain('schema:about ?item')
    expect(queries[0]).toContain('schema:isPartOf <https://en.wikipedia.org/>')
    expect(queries[0]).toContain('schema:name ?title')
    expect(values(queries[100]!)).toHaveLength(7)
    expect(log.filter((l) => /batch/.test(l))).toHaveLength(5)
  })

  it('keeps the first title when a QID returns several rows', async () => {
    const wikidata: WikidataSource = {
      ...deps({}).wikidata,
      async sparql<T>(_query: string, schema: ZodType<T>): Promise<T> {
        return schema.parse({
          results: {
            bindings: [
              { item: { value: uri('Q5') }, title: { value: 'First' } },
              { item: { value: uri('Q5') }, title: { value: 'Second' } },
            ],
          },
        })
      },
    }
    expect(await foundedBusinessesAmong(['Q5'], wikidata)).toEqual(new Map([['Q5', 'First']]))
  })

  it('an empty candidate list asks nothing', async () => {
    const queries: string[] = []
    const { wikidata } = deps({ queries })
    expect(await foundedBusinessesAmong([], wikidata)).toEqual(new Map())
    expect(queries).toEqual([])
  })
})
