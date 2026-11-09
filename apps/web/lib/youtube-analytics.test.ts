// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SEARCH_SOURCE_KEY,
  fetchPrivacyStatuses,
  fetchVideoAnalytics,
  fetchVideoFacts,
  mockVideoAnalytics,
  mockVideoFacts,
} from './youtube-analytics'

/**
 * The Analytics reads, against a stubbed Google: row-shape parsing, batch
 * behaviour, and the mock's determinism (the fixtures the whole mock
 * pipeline graphs from).
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchVideoAnalytics', () => {
  it('turns the three reports into one snapshot shape', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('elapsedVideoTimeRatio')) {
        return Promise.resolve(
          jsonResponse({
            rows: [
              [0.01, 0.98],
              [0.5, 0.55],
            ],
          }),
        )
      }
      if (url.includes('insightTrafficSourceType')) {
        return Promise.resolve(
          jsonResponse({
            rows: [
              ['BROWSE', 900],
              ['SEARCH', 100],
            ],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ rows: [[1234, 250]] }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const analytics = await fetchVideoAnalytics('token', 'vid-1')
    expect(analytics.retentionCurve).toEqual([
      { pct: 1, ratio: 0.98 },
      { pct: 50, ratio: 0.55 },
    ])
    expect(analytics.viewsBySource).toEqual({ BROWSE: 900, SEARCH: 100 })
    expect(analytics.views).toBe(1234)
    expect(analytics.avgViewDurationSec).toBe(250)
    // Every call carries the token and scopes to this one video.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain('video%3D%3Dvid-1')
    }
  })

  it('a video with no analytics yet is an empty snapshot, not an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}))),
    )
    const analytics = await fetchVideoAnalytics('token', 'vid-new')
    expect(analytics.retentionCurve).toEqual([])
    expect(analytics.views).toBeNull()
  })

  it('surfaces the API error message, not just a status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 403 }),
        ),
      ),
    )
    await expect(fetchVideoAnalytics('token', 'vid-1')).rejects.toThrow('quota exceeded')
  })
})

describe('fetchPrivacyStatuses', () => {
  it('reads statuses in one call for up to 50 ids', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          items: [
            { id: 'a', status: { privacyStatus: 'public' } },
            { id: 'b', status: { privacyStatus: 'private' } },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const statuses = await fetchPrivacyStatuses('token', ['a', 'b'])
    expect(statuses.get('a')).toBe('public')
    expect(statuses.get('b')).toBe('private')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('batches beyond 50 ids', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ items: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPrivacyStatuses(
      'token',
      Array.from({ length: 51 }, (_, index) => `v${index}`),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('mockVideoAnalytics', () => {
  it('is deterministic per video and always plots a full curve', () => {
    const first = mockVideoAnalytics('vid-abc')
    const second = mockVideoAnalytics('vid-abc')
    const other = mockVideoAnalytics('vid-xyz')

    expect(first).toEqual(second)
    expect(first.retentionCurve).toHaveLength(20)
    expect(first.retentionCurve.every((point) => point.ratio > 0 && point.ratio <= 1)).toBe(true)
    expect(other.views).not.toBe(first.views)
  })
})

describe('search terms, engagement and facts', () => {
  it('asks for search terms with the search filter and the range', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ rows: [['john carreyrou', 1, 0]] })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const analytics = await fetchVideoAnalytics('token', 'abc', {
      start: '2026-10-01',
      end: '2026-10-29',
    })
    const urls = (fetchMock.mock.calls as unknown as [string][]).map((call) =>
      decodeURIComponent(String(call[0])),
    )
    const searchUrl = urls.find((url) => url.includes('insightTrafficSourceDetail'))
    expect(searchUrl).toBeDefined()
    expect(searchUrl).toContain('video==abc;insightTrafficSourceType==YT_SEARCH')
    for (const url of urls) {
      expect(url).toContain('startDate=2026-10-01')
      expect(url).toContain('endDate=2026-10-29')
    }
    expect(analytics.searchTerms).toEqual([{ term: 'john carreyrou', views: 1, minutes: 0 }])
  })

  it('reads subscribers, likes and comments from the totals row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('subscribersGained')) {
          return Promise.resolve(jsonResponse({ rows: [[359, 302, 4, 1, 2]] }))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
    const analytics = await fetchVideoAnalytics('token', 'abc')
    expect(analytics.views).toBe(359)
    expect(analytics.avgViewDurationSec).toBe(302)
    expect(analytics.subscribersGained).toBe(4)
    expect(analytics.likes).toBe(1)
    expect(analytics.comments).toBe(2)
  })

  it('leaves engagement null when there is no totals row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}))),
    )
    const analytics = await fetchVideoAnalytics('token', 'abc')
    expect(analytics.subscribersGained).toBeNull()
    expect(analytics.searchTerms).toEqual([])
  })

  it('parses PT1H2M3S as 3723 seconds and a missing duration as null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 'a',
                status: { privacyStatus: 'public' },
                snippet: { publishedAt: '2026-10-29T20:00:15Z' },
                contentDetails: { duration: 'PT1H2M3S' },
              },
              { id: 'b', status: { privacyStatus: 'private' } },
              { id: 'c', contentDetails: { duration: 'PT16M39S' } },
              { id: 'd', contentDetails: { duration: 'nonsense' } },
            ],
          }),
        ),
      ),
    )
    const facts = await fetchVideoFacts('token', ['a', 'b', 'c', 'd'])
    expect(facts.get('a')).toEqual({
      privacyStatus: 'public',
      publishedAt: '2026-10-29T20:00:15Z',
      durationSec: 3723,
    })
    expect(facts.get('b')).toEqual({
      privacyStatus: 'private',
      publishedAt: null,
      durationSec: null,
    })
    expect(facts.get('c')?.durationSec).toBe(999)
    expect(facts.get('d')?.durationSec).toBeNull()
  })

  it('the mock uses YT_SEARCH and scales with the range', () => {
    const full = mockVideoAnalytics('vid-abc')
    const day7 = mockVideoAnalytics('vid-abc', { start: '2026-10-01', end: '2026-10-07' })
    const day28 = mockVideoAnalytics('vid-abc', { start: '2026-10-01', end: '2026-10-28' })
    expect(SEARCH_SOURCE_KEY).toBe('YT_SEARCH')
    expect(full.viewsBySource[SEARCH_SOURCE_KEY]).toBeGreaterThan(0)
    expect(full.viewsBySource.SEARCH).toBeUndefined()
    expect(day7.views ?? 0).toBeLessThan(day28.views ?? 0)
    expect(day28.views).toBe(full.views)
    expect(day28.searchTerms.length).toBeGreaterThan(0)
    expect(day28.searchTerms[0]?.term).toMatch(/^(case|story|collapse|explained|documentary) /)
    expect(mockVideoAnalytics('vid-abc', { start: '2026-10-01', end: '2026-10-07' })).toEqual(day7)
  })

  it('the mock facts take publishedAt from the fallback and a seeded duration', () => {
    const facts = mockVideoFacts(['a', 'b'], new Map([['a', new Date('2026-10-29T20:00:15Z')]]))
    expect(facts.get('a')?.publishedAt).toBe('2026-10-29T20:00:15.000Z')
    expect(facts.get('b')?.publishedAt).toBeNull()
    expect(facts.get('a')?.privacyStatus).toBe('public')
    const duration = facts.get('a')?.durationSec ?? 0
    expect(duration).toBeGreaterThanOrEqual(600)
    expect(duration).toBeLessThan(1500)
  })
})
