// @vitest-environment node

import type { SlotCandidate } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mockTeaserShotKey, slotFromTeaserCandidate, teaserCandidateReady } from './teaser-fetch'

/**
 * The fetched-candidate rules (decision 231): what may become a beat's stored
 * slot snapshot, and what it looks like when it does. These rules gate real
 * money and real renders: a data: URL or an expiring provider URL written
 * into a timeline is a render that breaks later, silently.
 */

function candidate(overrides: Partial<SlotCandidate> = {}): SlotCandidate {
  return {
    id: 'pexels-42',
    provider: 'pexels',
    kind: 'image',
    sourceUrl: 'https://images.example.com/42.jpg',
    licence: 'Pexels License',
    width: 1920,
    height: 1080,
    ...overrides,
  }
}

describe('teaserCandidateReady', () => {
  it('bytes in R2 are ready; live provider URLs are not (they expire)', () => {
    expect(teaserCandidateReady(candidate({ r2Key: 'boom-busters/stock/x.jpg' }), false)).toBe(true)
    expect(teaserCandidateReady(candidate(), false)).toBe(false)
  })

  it('mock mode is always ready: a bookmark key stands in for bytes', () => {
    expect(teaserCandidateReady(candidate({ sourceUrl: 'mock://pexels/x/1' }), true)).toBe(true)
  })
})

describe('slotFromTeaserCandidate', () => {
  it('a generated still becomes a still slot with a gentle push-in', () => {
    const slot = slotFromTeaserCandidate(
      candidate({
        id: 'fal-abc',
        provider: 'fal',
        r2Key: 'boom-busters/stills/abc.png',
        sourceUrl: 'generated://fal/abc',
      }),
      { mocked: false },
    )
    expect(slot).toMatchObject({
      type: 'still',
      transition: 'cut',
      motion: { kind: 'kenburns', direction: 'in' },
      payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/abc.png' }, width: 1920 },
    })
  })

  it('an ingested stock clip becomes a muted video slot keeping its proxy', () => {
    const slot = slotFromTeaserCandidate(
      candidate({
        kind: 'video',
        r2Key: 'boom-busters/stock/clip.mp4',
        previewR2Key: 'boom-busters/stock/clip-sd.mp4',
        durationMs: 8000,
      }),
      { mocked: false },
    )
    expect(slot).toMatchObject({
      type: 'stock',
      durationMs: 8000,
      motion: { kind: 'static' },
      payload: {
        kind: 'video',
        muted: true,
        src: {
          r2Key: 'boom-busters/stock/clip.mp4',
          previewR2Key: 'boom-busters/stock/clip-sd.mp4',
        },
      },
    })
  })

  it('a live candidate without bytes falls back to its stable URL, never a mock key', () => {
    const slot = slotFromTeaserCandidate(candidate(), { mocked: false })
    expect(slot?.payload).toMatchObject({
      kind: 'image',
      src: { externalUrl: 'https://images.example.com/42.jpg' },
    })
  })

  it('mock mode stores a bookmark key; mock URLs and data: URLs never enter a timeline', () => {
    const slot = slotFromTeaserCandidate(candidate({ sourceUrl: 'mock://pexels/x/1' }), {
      mocked: true,
    })
    expect(slot?.payload).toMatchObject({
      kind: 'image',
      src: { r2Key: mockTeaserShotKey('pexels-42') },
    })
  })

  it('refuses a live candidate with neither bytes nor a downloadable URL', () => {
    expect(
      slotFromTeaserCandidate(candidate({ sourceUrl: 'data:image/svg+xml;base64,AAAA' }), {
        mocked: false,
      }),
    ).toBeNull()
  })
})
