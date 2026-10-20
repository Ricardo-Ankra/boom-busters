import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createPoliteClient } from './http'
import { liveWikidata } from './wikidata'
import { mockWikidata } from './mock'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** The people batch is the one asking for labels; the entity batch asks for sitelinks. */
function wikidataFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    return new Response(
      fixture(u.includes('props=labels') ? 'wikidata-people.json' : 'wikidata-entities.json'),
      { status: 200 },
    )
  })
}

const sourceFor = (fetchImpl: ReturnType<typeof wikidataFetch>) =>
  liveWikidata(
    createPoliteClient({
      contact: 'me@example.com',
      cacheDir: null,
      fetchImpl,
      minIntervalMs: { 'wikidata.org': 0 },
    }),
  )

describe('live wikidata facts', () => {
  it('reads sitelinks, CIK (P5531), country (P17), dissolution (P576) and people from fixtures', async () => {
    const facts = await sourceFor(wikidataFetch()).facts(['Q1001', 'Q1002'])
    expect(facts.get('Q1001')).toEqual({
      qid: 'Q1001',
      enTitle: 'Wirecard',
      sitelinks: { enwiki: 'Wirecard', dewiki: 'Wirecard (Unternehmen)' },
      country: 'Q183',
      cik: '0001234567',
      dissolved: '2020-06-25',
      instanceOf: ['Q891723', 'Q4830453'],
      isClass: false,
      people: [
        { qid: 'Q2001', name: 'Founder Alive', living: true, convicted: false },
        { qid: 'Q2002', name: 'Founder Deceased', living: false, convicted: false },
        { qid: 'Q2003', name: 'Q2003', living: true, convicted: true },
      ],
    })
    const sparse = facts.get('Q1002')!
    expect(sparse.enTitle).toBeNull()
    expect(sparse.country).toBeNull()
    expect(sparse.cik).toBeNull()
    expect(sparse.dissolved).toBe('2015-01-01')
    expect(sparse.people).toEqual([])
    expect(sparse.instanceOf).toEqual(['Q6256'])
    expect(sparse.isClass).toBe(true)
    expect(facts.has('Q1003')).toBe(false)
  })

  it('a founder with a date of death is not living; one with P1399 is convicted', async () => {
    const facts = await sourceFor(wikidataFetch()).facts(['Q1001'])
    const people = facts.get('Q1001')!.people
    expect(people.find((p) => p.qid === 'Q2002')).toMatchObject({ living: false, convicted: false })
    expect(people.find((p) => p.qid === 'Q2003')).toMatchObject({ living: true, convicted: true })
  })

  it('dedupes people by QID and asks for each person once', async () => {
    const fetchImpl = wikidataFetch()
    await sourceFor(fetchImpl).facts(['Q1001'])
    const peopleCall = fetchImpl.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('props=labels'))!
    const ids = new URL(peopleCall).searchParams.get('ids')!.split('|')
    expect(ids.sort()).toEqual(['Q2001', 'Q2002', 'Q2003'])
  })

  it('batches entity ids by 50', async () => {
    const fetchImpl = wikidataFetch()
    const ids = Array.from({ length: 120 }, (_, i) => `Q${i + 1}`)
    await sourceFor(fetchImpl).facts(ids)
    const entityCalls = fetchImpl.mock.calls
      .map((c) => new URL(String(c[0])))
      .filter((u) => u.searchParams.get('props') === 'sitelinks|claims')
    expect(entityCalls.map((u) => u.searchParams.get('ids')!.split('|').length)).toEqual([
      50, 50, 20,
    ])
    expect(entityCalls[0]!.searchParams.get('format')).toBe('json')
    expect(entityCalls[0]!.origin + entityCalls[0]!.pathname).toBe(
      'https://www.wikidata.org/w/api.php',
    )
  })

  it('runs SPARQL and parses with the caller schema', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request) =>
        new Response(JSON.stringify({ results: { bindings: [{ x: { value: 'a' } }] } })),
    )
    const schema = z.object({
      results: z.object({ bindings: z.array(z.object({ x: z.object({ value: z.string() }) })) }),
    })
    const out = await sourceFor(fetchImpl as never).sparql('SELECT ?x WHERE {}', schema)
    expect(out.results.bindings[0]!.x.value).toBe('a')
    const url = new URL(String(fetchImpl.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe('https://query.wikidata.org/sparql')
    expect(url.searchParams.get('query')).toBe('SELECT ?x WHERE {}')
    expect(url.searchParams.get('format')).toBe('json')
  })
})

describe('mock wikidata', () => {
  it('returns deterministic, obviously fake facts per qid', async () => {
    const a = await mockWikidata.facts(['Q123', 'Q456'])
    const a2 = await mockWikidata.facts(['Q123', 'Q456'])
    expect(a).toEqual(a2)
    expect(a.get('Q123')!.enTitle).toBe('Mock entity Q123')
    expect(a.get('Q123')!.sitelinks.enwiki).toBe('Mock entity Q123')
    expect(a.get('Q456')!.qid).toBe('Q456')
    expect(a.get('Q456')).toMatchObject({ instanceOf: [], isClass: false })
  })
})
