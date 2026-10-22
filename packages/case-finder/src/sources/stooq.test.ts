import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createPoliteClient } from './http'
import { liveStooq, stooqSymbol } from './stooq'
import { mockStooq } from './mock'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const sourceFor = (body: string) => {
  const fetchImpl = vi.fn(async (_url: string | URL | Request) => new Response(body))
  const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
  return { fetchImpl, source: liveStooq(client) }
}

describe('liveStooq', () => {
  it('returns the CSV text', async () => {
    const { source, fetchImpl } = sourceFor(fixture('stooq-wdi.csv'))
    expect(await source.daily('wdi.de')).toBe(fixture('stooq-wdi.csv'))
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://stooq.com/q/d/l/?s=wdi.de&i=d')
  })

  it('returns null when the body is not CSV', async () => {
    expect(await sourceFor('No data').source.daily('zzz.us')).toBeNull()
  })
})

describe('stooqSymbol', () => {
  it('maps exchanges to Stooq suffixes and lower-cases the ticker', () => {
    expect(stooqSymbol('AAPL', 'Q82059')).toBe('aapl.us')
    expect(stooqSymbol('GE', 'Q13677')).toBe('ge.us')
    expect(stooqSymbol('WDI', 'Q152139')).toBe('wdi.de')
    expect(stooqSymbol('WDI', 'Q2385849')).toBe('wdi.de')
    expect(stooqSymbol('BP', 'Q171240')).toBe('bp.uk')
  })

  it('is null for an unknown or missing exchange', () => {
    expect(stooqSymbol('X', 'Q1')).toBeNull()
    expect(stooqSymbol('X', null)).toBeNull()
  })
})

describe('mockStooq', () => {
  it('answers with CSV', async () => {
    expect((await mockStooq.daily('a.us'))?.startsWith('Date,')).toBe(true)
  })
})
