import { countWords, narrationTags, splitSentences, stripNarrationMarkup } from './script'

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

/** Narration tags per 100 words, to one decimal; 0 when there are no words. */
export function tagDensity(chapters: readonly { contentMd: string }[]): number {
  let words = 0
  let tags = 0
  for (const chapter of chapters) {
    words += countWords(chapter.contentMd)
    tags += narrationTags(chapter.contentMd).length
  }
  return words === 0 ? 0 : Math.round((tags / words) * 1000) / 10
}

function lastSentence(contentMd: string): string {
  return splitSentences(stripNarrationMarkup(contentMd)).at(-1) ?? ''
}

/**
 * How the chapters close. `questions` is the chapters whose last sentence ends
 * in `?`; `sameShape` is the chapters whose last three words match another
 * chapter's (case and punctuation aside), so a repeated closing formula counts
 * every chapter that uses it.
 */
export function chapterEndings(chapters: readonly { contentMd: string }[]): {
  questions: number
  sameShape: number
} {
  let questions = 0
  const shapes = new Map<string, number>()
  const perChapter: string[] = []
  for (const chapter of chapters) {
    const last = lastSentence(chapter.contentMd)
    if (/\?["')\]]?$/.test(last)) questions += 1
    const words = last
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, '')
      .split(/\s+/)
      .filter(Boolean)
    if (words.length < 3) continue
    const shape = words.slice(-3).join(' ')
    perChapter.push(shape)
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1)
  }
  const sameShape = perChapter.filter((shape) => (shapes.get(shape) ?? 0) > 1).length
  return { questions, sameShape }
}

function hasHedge(text: string): boolean {
  HEDGE_PATTERN.lastIndex = 0
  return HEDGE_PATTERN.test(text)
}

/** What an owner edit took out: a tag, a figure, a caveat, or something else. */
export function classifyEdit(before: string, after: string): 'tag' | 'number' | 'hedge' | 'other' {
  if (narrationTags(before).length > narrationTags(after).length) return 'tag'
  if (/\d{3,}/.test(before) && !/\d{3,}/.test(after)) return 'number'
  if (hasHedge(before) && !hasHedge(after)) return 'hedge'
  return 'other'
}

/** Warnings totalled by kind across chapters. */
export function warningsByKind(
  chapters: readonly { warnings: readonly { kind: string }[] }[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const chapter of chapters) {
    for (const warning of chapter.warnings) counts[warning.kind] = (counts[warning.kind] ?? 0) + 1
  }
  return counts
}
