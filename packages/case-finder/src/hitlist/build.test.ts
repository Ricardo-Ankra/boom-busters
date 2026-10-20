import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import { describe, expect, it } from 'vitest'
import { mockPageviews, mockWikipedia } from '../sources/mock'
import type { EntityFacts, WikidataSource } from '../sources/wikidata'
import type { WikipediaSource } from '../sources/wikipedia'
import type { PageviewsSource } from '../sources/pageviews'
import type { DatedTag } from '../types'
import { buildHitlist, laneOf, type HitlistDeps } from './build'
import { loadLoPucki } from './seeds'

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
  views?: Record<string, number>
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
      const bindings = query.includes('P576')
        ? (f.dissolved ?? []).map((d) => ({
            item: { value: uri(d.qid) },
            dissolved: { value: `${d.date}T00:00:00Z` },
          }))
        : (f.founders ?? []).map((d) => ({
            item: { value: uri(d.qid) },
            title: { value: d.title },
          }))
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
    monthly: async (_p, titles, from, to) => [
      { month: `${from}`, views: f.views?.[titles[0]!] ?? 0 },
      { month: `${to}`, views: f.views?.[titles[0]!] ?? 0 },
    ],
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

  it('the founder seed drops under 1,000 median views and anything with a downfall tag', async () => {
    const entries = await buildHitlist(
      deps({
        categories: { 'Corporate scandals': ['Fallen'] },
        qids: { Fallen: 'Q22' },
        founders: [
          { qid: 'Q20', title: 'Popular' },
          { qid: 'Q21', title: 'Obscure' },
          { qid: 'Q22', title: 'Fallen' },
        ],
        views: { Popular: 1000, Obscure: 999, Fallen: 50000 },
        facts: { Q20: 'Popular', Q21: 'Obscure', Q22: 'Fallen' },
      }),
    )
    const byQid = Object.fromEntries(entries.map((e) => [e.qid, e.tags.map((t) => t.tag)]))
    expect(byQid).toEqual({
      Q20: ['founder-link'],
      Q22: ['category:Corporate scandals'],
    })
    expect(entries[0]!.tags[0]).toEqual(tag('founder-link', 'success', null))
  })

  it('builds the founder window from the 24 months before the build month', async () => {
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
    expect(windows).toEqual([['2024-10', '2026-09']])
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
