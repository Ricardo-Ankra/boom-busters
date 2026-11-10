import { countWords, stripNarrationMarkup } from './script'

/** The phrases that mark a sentence as reported rather than established. */
export const HEDGE_PHRASES: readonly string[] = [
  'alleged',
  'allegedly',
  'reportedly',
  'purportedly',
  'according to',
  'prosecutors say',
  'the complaint says',
  'is said to',
  'were said to',
  'believed to',
  'appears to',
  'suggests',
  'claimed',
  'claims that',
]

const HEDGE_PATTERN = new RegExp(`\\b(?:${HEDGE_PHRASES.join('|')})\\b`, 'gi')

/** Hedge phrase hits per 100 words of narration, to one decimal; 0 when there are no words. */
export function hedgeDensity(chapters: readonly { contentMd: string }[]): number {
  let words = 0
  let hits = 0
  for (const chapter of chapters) {
    words += countWords(chapter.contentMd)
    hits += stripNarrationMarkup(chapter.contentMd).match(HEDGE_PATTERN)?.length ?? 0
  }
  return words === 0 ? 0 : Math.round((hits / words) * 1000) / 10
}
