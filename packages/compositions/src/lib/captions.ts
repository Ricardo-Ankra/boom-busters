import type { Caption } from '@boom-busters/schemas'

/**
 * Karaoke caption paging (build spec section 8.3): 1–3 words at a time,
 * current word highlighted. Pure maths so the paging is testable without a
 * renderer and identical wherever it runs.
 */

export interface CaptionPage {
  words: Caption[]
  startMs: number
  endMs: number
}

const SENTENCE_END = /[.!?…]["'"']?$/

/**
 * Group word captions into pages. A page closes when it holds `maxWords`,
 * when the next word starts after a silence longer than `maxGapMs` (a
 * caption must never sit on screen through a pause it does not cover), or
 * after a sentence-ending word.
 */
export function paginateCaptions(
  words: readonly Caption[],
  { maxWords = 3, maxGapMs = 600 }: { maxWords?: number; maxGapMs?: number } = {},
): CaptionPage[] {
  const pages: CaptionPage[] = []
  let current: Caption[] = []

  const close = () => {
    if (current.length === 0) return
    pages.push({
      words: current,
      startMs: current[0]!.startMs,
      endMs: current[current.length - 1]!.endMs,
    })
    current = []
  }

  for (const word of words) {
    const last = current[current.length - 1]
    if (last && word.startMs - last.endMs > maxGapMs) close()
    current.push(word)
    if (current.length >= maxWords || SENTENCE_END.test(word.text)) close()
  }
  close()
  return pages
}

/** The page on screen at time t, or null during silence. */
export function pageAt(pages: readonly CaptionPage[], tMs: number): CaptionPage | null {
  for (const page of pages) {
    if (tMs >= page.startMs && tMs < page.endMs) return page
  }
  return null
}

export interface CaptionSafeArea {
  /** Fraction of width kept clear on each side. */
  sideInsetFraction: number
  /** The caption block's bottom edge, as a fraction of height from the top. */
  bottomFraction: number
  fontScale: number
}

/**
 * Where captions may live (spec section 8.3: 9:16 safe zones). Portrait
 * frames are Shorts: the platform UI owns the right rail and the bottom
 * quarter (title, handle, audio attribution), so captions sit higher and
 * narrower. Landscape captions sit in the classic lower third.
 */
export function captionSafeArea(width: number, height: number): CaptionSafeArea {
  const portrait = height > width
  return portrait
    ? { sideInsetFraction: 0.12, bottomFraction: 0.72, fontScale: 1.15 }
    : { sideInsetFraction: 0.15, bottomFraction: 0.88, fontScale: 1 }
}
