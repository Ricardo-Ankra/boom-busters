import { describe, expect, it } from 'vitest'
import { outcomeRatio } from './outcome'
import type { ChannelUploads, YoutubeVideo } from '../types'

function v(id: string, publishedAt: string, views: number, durationSec = 900): YoutubeVideo {
  return { id, channelId: 'UC1', title: id, publishedAt, durationSec, views }
}
const channel = (uploads: YoutubeVideo[]): ChannelUploads => ({
  channelId: 'UC1',
  uploads,
  fetchedOn: '2026-01-01',
  complete: true,
})
const target = v('target', '2022-06-15', 1000)
const MEASURED = '2026-01-01'

describe('outcomeRatio', () => {
  it('excludes uploads younger than 90 days and outside 6 months', () => {
    const ch = channel([
      target,
      v('a', '2022-05-01', 100),
      v('b', '2022-07-01', 300),
      v('far', '2021-01-01', 100000),
      v('young', '2025-12-01', 100000),
    ])
    expect(outcomeRatio(target, ch, MEASURED)).toBe(1000 / 200)
  })

  it('excludes uploads younger than 90 days even inside the window', () => {
    const t = v('t', '2025-09-01', 100)
    const ch = channel([t, v('a', '2025-08-01', 50), v('young', '2025-11-01', 1_000_000)])
    expect(outcomeRatio(t, ch, MEASURED)).toBe(2)
  })

  it('excludes the video itself from its own median', () => {
    const ch = channel([target, v('a', '2022-05-01', 500)])
    expect(outcomeRatio(target, ch, MEASURED)).toBe(2)
  })

  it('ignores short uploads', () => {
    const ch = channel([target, v('a', '2022-05-01', 500), v('s', '2022-05-02', 1, 60)])
    expect(outcomeRatio(target, ch, MEASURED)).toBe(2)
  })

  it('includes the window ends exactly and excludes a day beyond', () => {
    const ch = channel([
      target,
      v('lo', '2021-12-15', 100),
      v('hi', '2022-12-15', 100),
      v('lo-out', '2021-12-14', 1_000_000),
      v('hi-out', '2022-12-16', 1_000_000),
    ])
    expect(outcomeRatio(target, ch, MEASURED)).toBe(10)
  })

  it('clamps month arithmetic to the last day', () => {
    const t = v('t', '2022-08-31', 100)
    const ch = channel([t, v('lo', '2022-02-28', 50), v('out', '2022-02-27', 1_000_000)])
    expect(outcomeRatio(t, ch, MEASURED)).toBe(2)
  })

  it('includes a peer exactly 90 days old on measuredOn, excludes 89', () => {
    // 2026-01-01 minus 90 days is 2025-10-03
    const t = v('t', '2025-09-01', 100)
    const ch = channel([t, v('ok', '2025-10-03', 50), v('young', '2025-10-04', 1_000_000)])
    expect(outcomeRatio(t, ch, MEASURED)).toBe(2)
  })

  it('throws naming the video when there are no peers', () => {
    expect(() => outcomeRatio(target, channel([target]), MEASURED)).toThrow(/target/)
  })

  it('throws naming the video when the median is 0', () => {
    const ch = channel([target, v('z', '2022-05-01', 0)])
    expect(() => outcomeRatio(target, ch, MEASURED)).toThrow(/target/)
  })
})
