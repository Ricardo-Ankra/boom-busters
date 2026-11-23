import type { Caption } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { captionsClearOf, captionSafeArea, pageAt, paginateCaptions } from './captions'

const word = (text: string, startMs: number, endMs: number): Caption => ({
  text,
  startMs,
  endMs,
  timestampMs: startMs,
  confidence: null,
})

describe('paginateCaptions', () => {
  it('holds one to three words per page', () => {
    const words = [
      word('the', 0, 200),
      word('bank', 200, 500),
      word('collapsed', 500, 900),
      word('overnight', 900, 1400),
    ]
    const pages = paginateCaptions(words)
    expect(pages.map((page) => page.words.length)).toEqual([3, 1])
    expect(pages[0]!.startMs).toBe(0)
    expect(pages[0]!.endMs).toBe(900)
  })

  it('breaks the page across a silence — a caption never outlives its audio', () => {
    const words = [word('gone.', 0, 400), word('Every', 1400, 1700), word('penny', 1700, 2000)]
    const pages = paginateCaptions(words)
    expect(pages).toHaveLength(2)
    expect(pages[1]!.startMs).toBe(1400)
  })

  it('ends a page at a sentence boundary', () => {
    const words = [word('It', 0, 100), word('failed.', 100, 500), word('Then', 600, 800)]
    const pages = paginateCaptions(words)
    expect(pages[0]!.words.map((w) => w.text)).toEqual(['It', 'failed.'])
  })
})

describe('pageAt', () => {
  it('returns the live page, and null in silence', () => {
    const pages = paginateCaptions([word('boom', 0, 500), word('bust', 2000, 2500)])
    expect(pageAt(pages, 250)?.words[0]?.text).toBe('boom')
    expect(pageAt(pages, 1000)).toBeNull()
  })
})

describe('captionSafeArea', () => {
  it('keeps 9:16 captions inside the Shorts safe zone', () => {
    const safe = captionSafeArea(1080, 1920)
    // The platform UI owns the bottom quarter and the side rails.
    expect(safe.bottomFraction).toBeLessThanOrEqual(0.75)
    expect(safe.sideInsetFraction).toBeGreaterThanOrEqual(0.1)
  })

  it('sits 16:9 captions in the classic lower third', () => {
    const safe = captionSafeArea(1920, 1080)
    expect(safe.bottomFraction).toBeGreaterThan(0.8)
  })
})

describe('captionsClearOf (decision 479)', () => {
  const word = (text: string, startMs: number, endMs: number): Caption => ({
    text,
    startMs,
    endMs,
    timestampMs: null,
    confidence: null,
  })
  const words = [word('money', 2400, 2800), word('never', 2850, 3300), word('left', 3350, 3700)]

  it('drops words under a card and cuts one running into it at the card', () => {
    expect(captionsClearOf(words, [{ startMs: 3000, durationMs: 5000 }])).toEqual([
      word('money', 2400, 2800),
      word('never', 2850, 3000),
    ])
  })

  it('so no page is on screen once the card is up', () => {
    const pages = paginateCaptions(captionsClearOf(words, [{ startMs: 3000, durationMs: 5000 }]))
    expect(pageAt(pages, 2900)).not.toBeNull()
    expect(pageAt(pages, 3000)).toBeNull()
  })

  it('leaves the words alone with no card', () => {
    expect(captionsClearOf(words, [])).toEqual(words)
  })
})
