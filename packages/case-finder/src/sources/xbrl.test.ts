import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createPoliteClient } from './http'
import { liveXbrl } from './xbrl'
import { mockXbrl } from './mock'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const sourceFor = (response: Response) => {
  const fetchImpl = vi.fn(async (_url: string | URL | Request) => response)
  const client = createPoliteClient({
    contact: 'me@example.com',
    cacheDir: null,
    fetchImpl,
    minIntervalMs: { 'sec.gov': 0 },
  })
  return { fetchImpl, source: liveXbrl(client) }
}

describe('liveXbrl', () => {
  it('pads the CIK and returns the parsed facts', async () => {
    const { source, fetchImpl } = sourceFor(new Response(fixture('xbrl-companyfacts-small.json')))
    const facts = (await source.companyFacts('1234567')) as { entityName: string }
    expect(facts.entityName).toBe('Example Corp')
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      'https://data.sec.gov/api/xbrl/companyfacts/CIK0001234567.json',
    )
  })

  it('is null on a 404', async () => {
    expect(await sourceFor(new Response('', { status: 404 })).source.companyFacts('99')).toBeNull()
  })

  it('is null when the body is not JSON', async () => {
    expect(await sourceFor(new Response('<html>')).source.companyFacts('99')).toBeNull()
  })
})

describe('mockXbrl', () => {
  it('returns a fixed facts object', async () => {
    expect(await mockXbrl.companyFacts('1')).not.toBeNull()
  })
})
