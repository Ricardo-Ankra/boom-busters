import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { liveCourtListener } from './courtlistener'
import { createPoliteClient } from './http'
import { mockCourtListener } from './mock'

const fixture = readFileSync(
  new URL('./fixtures/courtlistener-dockets.json', import.meta.url),
  'utf8',
)

function setup(body = fixture, status = 200) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(body, { status })
  })
  const client = createPoliteClient({
    contact: 'me@example.com',
    cacheDir: null,
    fetchImpl,
    minIntervalMs: { 'courtlistener.com': 0 },
  })
  return { fetchImpl, source: liveCourtListener(client, 'SECRETTOKEN') }
}

describe('liveCourtListener', () => {
  it('courtlistener sends the token header and filed_before', async () => {
    const { source, fetchImpl } = setup()
    await source.dockets('Wirecard AG', '2022-01-01')
    const [url, init] = fetchImpl.mock.calls[0]!
    const parsed = new URL(String(url))
    expect(parsed.origin + parsed.pathname).toBe(
      'https://www.courtlistener.com/api/rest/v4/search/',
    )
    expect(parsed.searchParams.get('type')).toBe('r')
    expect(parsed.searchParams.get('q')).toBe('"Wirecard AG"')
    expect(parsed.searchParams.get('filed_before')).toBe('2021-12-31')
    expect(String(url)).not.toContain('SECRETTOKEN')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Token SECRETTOKEN')
  })

  it('maps results to documents and drops those filed on or after T', async () => {
    const { source } = setup()
    expect(await source.dockets('Wirecard AG', '2022-01-01')).toEqual([
      {
        url: 'https://www.courtlistener.com/docket/111/sec-v-wirecard-ag/',
        title: 'SEC v. Wirecard AG',
        source: 'courtlistener',
        datedAt: '2020-09-01',
      },
      {
        url: 'https://www.courtlistener.com/docket/222/investors-v-ernst/',
        title: 'Wirecard Investors v. Ernst',
        source: 'courtlistener',
        datedAt: '2021-03-15',
      },
      {
        url: 'https://www.courtlistener.com/docket/333/undated/',
        title: 'Undated matter',
        source: 'courtlistener',
        datedAt: null,
      },
    ])
  })

  it('throws on a response without a results array', async () => {
    const { source } = setup('{"detail":"x"}')
    await expect(source.dockets('X', '2022-01-01')).rejects.toThrow(/unexpected shape/)
  })
})

describe('mockCourtListener', () => {
  it('is deterministic and obviously fake', async () => {
    const a = await mockCourtListener.dockets('Acme', '2020-01-01')
    expect(a).toEqual(await mockCourtListener.dockets('Acme', '2020-01-01'))
    expect(a.length).toBeGreaterThan(0)
    expect(a.every((d) => d.title.startsWith('[mock]'))).toBe(true)
  })
})
