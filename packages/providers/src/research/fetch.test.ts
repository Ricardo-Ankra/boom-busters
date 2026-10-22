import { describe, expect, it } from 'vitest'
import { fetchDocument } from './fetch'

const publicLookup = async (host: string) => [
  { address: host.startsWith('internal') ? '10.0.0.1' : '93.184.216.34' },
]

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } })
}

describe('fetchDocument', () => {
  it('reads a page body in full and records the final url', async () => {
    const doc = await fetchDocument('https://example.com/a', {
      fetchImpl: async () => html('<p>hello</p>'),
      lookupImpl: publicLookup,
    })
    expect(doc.failure).toBeNull()
    expect(doc.httpStatus).toBe(200)
    expect(doc.finalUrl).toBe('https://example.com/a')
    expect(doc.contentType).toBe('text/html')
    expect(doc.body?.byteLength).toBe('<p>hello</p>'.length)
  })

  it('sends the user agent it is given, and the article one by default', async () => {
    const agents: (string | null)[] = []
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      agents.push(new Headers(init?.headers).get('user-agent'))
      return html('<p>hello</p>')
    }
    await fetchDocument('https://example.com/a', {
      fetchImpl,
      lookupImpl: publicLookup,
      userAgent: 'boom-busters-case-finder/1.0 (+me@example.com)',
    })
    await fetchDocument('https://example.com/a', { fetchImpl, lookupImpl: publicLookup })
    expect(agents).toEqual([
      'boom-busters-case-finder/1.0 (+me@example.com)',
      'boom-busters/1.0 (single-user production console)',
    ])
  })

  it('re-checks every redirect hop and refuses a private address', async () => {
    const calls: string[] = []
    const doc = await fetchDocument('https://example.com/a', {
      fetchImpl: async (input) => {
        calls.push(String(input))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://internal.example.com/' },
        })
      },
      lookupImpl: publicLookup,
    })
    expect(doc.failure).toContain('private')
    expect(calls.some((call) => call.includes('archive.org'))).toBe(false)
    expect(doc.body).toBeNull()
  })

  it('abandons a body over the cap as too large', async () => {
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1024 * 1024))
        c.close()
      },
    })
    const doc = await fetchDocument('https://example.com/big', {
      fetchImpl: async () =>
        new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }),
      lookupImpl: publicLookup,
      archiveFallback: false,
    })
    expect(doc.failure).toBe('too large')
    expect(doc.body).toBeNull()
  })

  it('falls back to a Wayback snapshot on a 404', async () => {
    const calls: string[] = []
    const doc = await fetchDocument('https://example.com/gone', {
      lookupImpl: publicLookup,
      fetchImpl: async (input) => {
        const url = String(input)
        calls.push(url)
        if (url.startsWith('https://archive.org/wayback/available')) {
          return Response.json({
            archived_snapshots: {
              closest: {
                available: true,
                url: 'http://web.archive.org/web/2020/https://example.com/gone',
              },
            },
          })
        }
        if (url.startsWith('https://web.archive.org/')) return html('<p>snapshot</p>')
        return html('missing', 404)
      },
    })
    expect(doc.failure).toBeNull()
    expect(doc.archivedUrl).toBe('https://web.archive.org/web/2020/https://example.com/gone')
    expect(doc.httpStatus).toBe(200)
    expect(calls).toHaveLength(3)
  })

  it('still tries the Wayback fallback for a hostname that does not resolve', async () => {
    const calls: string[] = []
    const doc = await fetchDocument('https://dead.example.com/a', {
      lookupImpl: async () => {
        throw new Error('ENOTFOUND')
      },
      fetchImpl: async (input) => {
        calls.push(String(input))
        return Response.json({ archived_snapshots: {} })
      },
    })
    expect(doc.failure).toContain('does not resolve')
    expect(calls.some((call) => call.includes('archive.org'))).toBe(true)
  })

  it('reports a failure instead of throwing for a dead page', async () => {
    const doc = await fetchDocument('https://example.com/gone', {
      fetchImpl: async () => html('missing', 404),
      lookupImpl: publicLookup,
      archiveFallback: false,
    })
    expect(doc.failure).toContain('404')
    expect(doc.httpStatus).toBe(404)
  })
})
