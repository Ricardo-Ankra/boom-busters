// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPrivacyStatuses, fetchVideoAnalytics, mockVideoAnalytics } from './youtube-analytics'

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
