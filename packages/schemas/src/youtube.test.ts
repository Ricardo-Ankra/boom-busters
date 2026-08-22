import { describe, expect, it } from 'vitest'
import { describeYoutubeAction, mapYoutubeError, quotaDayStartUtc } from './youtube'

/**
 * The error mapper (build spec section 13's "YouTube error mapper" line):
 * vendor strings in, one of five typed actions out — and the quota day
 * boundary in Pacific time, where YouTube actually resets it.
 */

describe('mapYoutubeError', () => {
  it('quota exhaustion requeues for tomorrow', () => {
    expect(mapYoutubeError({ status: 403, reason: 'quotaExceeded' })).toEqual({
      kind: 'requeue-tomorrow',
    })
    expect(mapYoutubeError({ message: 'youtube answered 403 (dailyLimitExceeded)' })).toEqual({
      kind: 'requeue-tomorrow',
    })
  })

  it('the channel upload limit pauses the whole queue a day', () => {
    expect(mapYoutubeError({ status: 400, reason: 'uploadLimitExceeded' })).toEqual({
      kind: 'pause-queue',
      hours: 24,
    })
  })

  it('dead credentials demand a reconnect, whatever carried the news', () => {
    expect(mapYoutubeError({ status: 400, reason: 'invalid_grant' })).toEqual({
      kind: 'reconnect',
    })
    expect(mapYoutubeError({ status: 401 })).toEqual({ kind: 'reconnect' })
    expect(mapYoutubeError({ message: 'token refresh failed: authError' })).toEqual({
      kind: 'reconnect',
    })
  })

  it('transient server trouble retries', () => {
    expect(mapYoutubeError({ status: 500 })).toEqual({ kind: 'retry' })
    expect(mapYoutubeError({ status: 503, reason: 'backendError' })).toEqual({ kind: 'retry' })
    expect(mapYoutubeError({ reason: 'userRateLimitExceeded' })).toEqual({ kind: 'retry' })
  })

  it('the reason outranks the status — a 403 is three different stories', () => {
    expect(mapYoutubeError({ status: 403, reason: 'quotaExceeded' }).kind).toBe('requeue-tomorrow')
    expect(mapYoutubeError({ status: 403, reason: 'uploadLimitExceeded' }).kind).toBe('pause-queue')
    expect(mapYoutubeError({ status: 403, reason: 'forbidden' }).kind).toBe('reconnect')
  })

  it('tokens are found inside free-text media-utils failures', () => {
    expect(
      mapYoutubeError({ message: 'youtube upload failed with 403: quotaExceeded for quota group' })
        .kind,
    ).toBe('requeue-tomorrow')
  })

  it('anything unrecognised fails the item, never the queue', () => {
    expect(mapYoutubeError({ status: 400, reason: 'invalidVideoMetadata' })).toEqual({
      kind: 'fail',
    })
    expect(mapYoutubeError({})).toEqual({ kind: 'fail' })
  })

  it('every action has words for the notification', () => {
    expect(describeYoutubeAction({ kind: 'requeue-tomorrow' })).toContain('requeued for tomorrow')
    expect(describeYoutubeAction({ kind: 'pause-queue', hours: 24 })).toContain('paused 24')
    expect(describeYoutubeAction({ kind: 'reconnect' })).toContain('reconnect')
  })
})

describe('quotaDayStartUtc', () => {
  it('is Pacific midnight, not UTC midnight', () => {
    // 2026-08-22 10:30 UTC = 03:30 PDT → the quota day began 07:00 UTC.
    const start = quotaDayStartUtc(new Date('2026-08-22T10:30:00Z'))
    expect(start.toISOString()).toBe('2026-08-22T07:00:00.000Z')
  })

  it('late UTC evening is still the SAME Pacific day', () => {
    // 2026-08-22 23:30 UTC = 16:30 PDT — quota day still began 07:00 UTC.
    const start = quotaDayStartUtc(new Date('2026-08-22T23:30:00Z'))
    expect(start.toISOString()).toBe('2026-08-22T07:00:00.000Z')
  })

  it('early UTC morning belongs to YESTERDAY in Pacific time', () => {
    // 2026-08-22 05:00 UTC = 2026-08-21 22:00 PDT.
    const start = quotaDayStartUtc(new Date('2026-08-22T05:00:00Z'))
    expect(start.toISOString()).toBe('2026-08-21T07:00:00.000Z')
  })

  it('winter uses standard time — the IANA zone owns the offset', () => {
    // January: PST is UTC-8, so the day starts 08:00 UTC.
    const start = quotaDayStartUtc(new Date('2026-01-15T12:00:00Z'))
    expect(start.toISOString()).toBe('2026-01-15T08:00:00.000Z')
  })
})
