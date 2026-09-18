import { describe, expect, it, vi } from 'vitest'
import { articleProvider } from './index'
import { liveArticleProvider } from './fetch'
import { HEAD_JSONLD, HEAD_OG } from './fixtures'

const URL_A = 'https://financialrecord.example/2023/03/14/auditors'
const PUBLIC = () => Promise.resolve([{ address: '93.184.216.34' }])

function page(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  })
}

function redirect(to: string): Response {
  return new Response(null, { status: 301, headers: { location: to } })
}

/** Every test injects both the socket and the resolver; nothing reaches out. */
function read(fetchImpl: typeof fetch, url = URL_A, archiveFallback = false) {
  return liveArticleProvider.fetchMetadata(url, {
    fetchImpl,
    lookupImpl: PUBLIC,
    archiveFallback,
  })
}

describe('the article fetch', () => {
  it('reads the head of a page that answers', async () => {
    const call = vi.fn(() => Promise.resolve(page(HEAD_JSONLD)))
    const article = await read(call as unknown as typeof fetch)

    expect(article.headline).toBe('Auditors cannot find the $1.9 billion the company says it holds')
    expect(article.archived).toBe(false)
    const [, init] = call.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('boom-busters')
    expect(init.redirect).toBe('manual')
  })

  it('follows a redirect, and vets where it lands', async () => {
    const call = vi.fn((target: string) =>
      Promise.resolve(
        target === URL_A ? redirect('https://cityherald.example/markets/x') : page(HEAD_OG),
      ),
    )
    const article = await read(call as unknown as typeof fetch)
    expect(article.outlet).toBe('City Herald')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('refuses a redirect that lands somewhere private', async () => {
    const call = vi.fn(() => Promise.resolve(redirect('https://internal.example/x')))
    await expect(
      liveArticleProvider.fetchMetadata(URL_A, {
        fetchImpl: call as unknown as typeof fetch,
        archiveFallback: false,
        lookupImpl: (host) =>
          Promise.resolve([{ address: host === URL_A ? '93.184.216.34' : '10.0.0.7' }]),
      }),
    ).rejects.toThrow(/private network/)
  })

  it('gives up on a chain that never settles', async () => {
    let hop = 0
    const call = vi.fn(() => {
      hop += 1
      return Promise.resolve(redirect(`https://news.example/hop-${hop}`))
    })
    await expect(read(call as unknown as typeof fetch)).rejects.toThrow(/redirected more than/)
  })

  it('does not retry an answer, and does retry a bad minute', async () => {
    const forbidden = vi.fn(() => Promise.resolve(new Response(null, { status: 403 })))
    await expect(read(forbidden as unknown as typeof fetch)).rejects.toThrow(/returned 403/)
    expect(forbidden).toHaveBeenCalledTimes(1)

    let attempt = 0
    const flaky = vi.fn(() => {
      attempt += 1
      return Promise.resolve(
        attempt === 1 ? new Response(null, { status: 503 }) : page(HEAD_JSONLD),
      )
    })
    const article = await read(flaky as unknown as typeof fetch)
    expect(article.outlet).toBe('The Financial Record')
    expect(flaky).toHaveBeenCalledTimes(2)
  })

  it('refuses an address that answers with something other than a page', async () => {
    const call = vi.fn(() =>
      Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } })),
    )
    await expect(read(call as unknown as typeof fetch)).rejects.toThrow(/not a web page/)
  })

  it('stops reading at the end of the head', async () => {
    const huge = `${HEAD_JSONLD}${'<p>filler</p>'.repeat(200_000)}`
    const call = vi.fn(() => Promise.resolve(page(huge)))
    const article = await read(call as unknown as typeof fetch)
    expect(article.headline).toContain('Auditors cannot find')
  })

  it('falls back to an archived copy, and says that is where it came from', async () => {
    const call = vi.fn((target: string) => {
      if (target.startsWith('https://archive.org/wayback/available')) {
        return Promise.resolve(
          Response.json({
            archived_snapshots: {
              closest: { available: true, url: `http://web.archive.org/web/2019/${URL_A}` },
            },
          }),
        )
      }
      if (target.startsWith('https://web.archive.org/')) return Promise.resolve(page(HEAD_JSONLD))
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    const article = await liveArticleProvider.fetchMetadata(URL_A, {
      fetchImpl: call as unknown as typeof fetch,
      lookupImpl: PUBLIC,
    })
    expect(article.archived).toBe(true)
    expect(article.headline).toContain('Auditors cannot find')
    expect(article.provenance.headline).toBe('archive')
  })

  it('reports the original failure when nothing was archived either', async () => {
    const call = vi.fn((target: string) =>
      Promise.resolve(
        target.startsWith('https://archive.org/')
          ? Response.json({ archived_snapshots: {} })
          : new Response(null, { status: 404 }),
      ),
    )
    await expect(
      liveArticleProvider.fetchMetadata(URL_A, {
        fetchImpl: call as unknown as typeof fetch,
        lookupImpl: PUBLIC,
      }),
    ).rejects.toThrow(/returned 404/)
  })
})

describe('the mock provider', () => {
  it('answers without opening a socket', async () => {
    const provider = articleProvider({ MOCK_PROVIDERS: '1' })
    const article = await provider.fetchMetadata('https://ledger.example/news/escrow-inquiry')
    expect(article.outlet).toBe('The Ledger')
    expect(article.headline).toContain('Escrow inquiry')
    expect(article.publishedAt).toBe('2023-03-14')
  })

  it('has a way to be a paywall, because the manual path needs exercising', async () => {
    const provider = articleProvider({ MOCK_PROVIDERS: '1' })
    await expect(provider.fetchMetadata('https://ledger.example/paywall/x')).rejects.toThrow(/403/)
  })

  it('is not selected unless the flag says so', () => {
    expect(articleProvider({})).toBe(liveArticleProvider)
  })
})
