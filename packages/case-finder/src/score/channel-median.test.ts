import { describe, expect, it } from 'vitest'
import type { YoutubeVideo } from '../types'
import { latestMedian, peerMedian, windowStart } from './channel-median'

function v(id: string, publishedAt: string, views: number, durationSec = 900): YoutubeVideo {
  return { id, channelId: 'UC1', title: id, publishedAt, durationSec, views }
}
const target = v('target', '2022-06-15', 1000)
const SETTLED_ON = '2026-01-01'

describe('windowStart', () => {
  it('is six months before the video, clamped to the end of a short month', () => {
    expect(windowStart(target)).toBe('2021-12-15')
    expect(windowStart(v('t', '2022-08-31', 1))).toBe('2022-02-28')
  })
})

describe('peerMedian', () => {
  it('uses long-form uploads within six months either side, excluding the video', () => {
    const uploads = [
      target,
      v('lo', '2021-12-15', 100),
      v('hi', '2022-12-15', 300),
      v('lo-out', '2021-12-14', 1_000_000),
      v('hi-out', '2022-12-16', 1_000_000),
      v('short', '2022-06-01', 1_000_000, 60),
    ]
    expect(peerMedian(target, { uploads }, SETTLED_ON)).toBe(200)
  })

  it('keeps only peers at least 90 days old on the settle day', () => {
    // 2022-09-15 minus 90 days is 2022-06-17.
    const uploads = [target, v('ok', '2022-06-17', 50), v('young', '2022-06-18', 1_000_000)]
    expect(peerMedian(target, { uploads }, '2022-09-15')).toBe(50)
  })

  it('is null with no peers or a zero median', () => {
    expect(peerMedian(target, { uploads: [target] }, SETTLED_ON)).toBeNull()
    expect(
      peerMedian(target, { uploads: [target, v('z', '2022-05-01', 0)] }, SETTLED_ON),
    ).toBeNull()
  })
})

describe('latestMedian', () => {
  it("is the median of the channel's latest 50 long-form uploads other than the video", () => {
    const recent = Array.from({ length: 50 }, (_, i) => v(`r${i}`, '2025-06-01', 100))
    const older = Array.from({ length: 50 }, (_, i) => v(`o${i}`, '2024-06-01', 10_000))
    const shorts = Array.from({ length: 10 }, (_, i) => v(`s${i}`, '2025-07-01', 9_999_999, 60))
    const uploads = [...shorts, recent[0]!, target, ...recent.slice(1), ...older]
    expect(latestMedian(target, { uploads })).toBe(100)
  })

  it('ignores settledness and the window: the latest uploads are all it has', () => {
    const uploads = [v('fresh', '2025-12-31', 400), target]
    expect(latestMedian(target, { uploads })).toBe(400)
  })

  it('is null with no peers or a zero median', () => {
    expect(latestMedian(target, { uploads: [target] })).toBeNull()
    expect(latestMedian(target, { uploads: [v('z', '2025-01-01', 0)] })).toBeNull()
  })
})
