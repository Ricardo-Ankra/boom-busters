import type { SearchKeyword } from './search-brief'

/**
 * What a measured term is. VidIQ's matching terms mix real searches with
 * other people's video titles and auto-translated titles.
 */
export type SearchTermKind = 'keyword' | 'title' | 'other-language'

/** The cap on the searched titles and other-language lists a brief keeps. */
export const SEARCHED_TERMS_MAX = 10

/** A hyphen is not here on purpose: "co-founder" is an ordinary word. */
const TITLE_PUNCTUATION = /[:—–|.!?"“”]/
const TITLE_WORDS = 9
const PREFIX_MIN_WORDS = 3
const DIACRITIC = /[áàâãäéèêíóôõöúüçñÁÀÂÃÄÉÈÊÍÓÔÕÖÚÜÇÑ]/

/** Lowercased whitespace tokens with title punctuation and commas stripped; empty tokens (a lone dash) drop out. */
export function termWords(term: string): string[] {
  return term
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[:—–|.!?"“”,]/g, ''))
    .filter((w) => w !== '')
}

/** Punctuation or nine words or more. The prefix rule needs the whole list, so it lives in `classifySearchTerms`. */
export function isTitleShaped(term: string): boolean {
  return TITLE_PUNCTUATION.test(term) || termWords(term).length >= TITLE_WORDS
}

/** English, or no language set: the only channels whose accented terms are another language. */
function isEnglish(language: string | undefined): boolean {
  const l = (language ?? '').trim().toLowerCase()
  return l === '' || l === 'en' || l.startsWith('en-')
}

/** A letter from the listed diacritic set, in either case (not any uppercase letter). */
export function hasDiacritic(term: string): boolean {
  return DIACRITIC.test(term)
}

/**
 * Sorts every term by shape, keyed by the trimmed lowercase term. A term is
 * also a title when it is the opening whole words (three or more) of a
 * title-shaped term in the list. Another language wins over a title, but only
 * on an English channel: on any other language an accent is just spelling.
 */
export function classifySearchTerms(
  terms: readonly string[],
  options: { language?: string } = {},
): Map<string, SearchTermKind> {
  const accents = isEnglish(options.language)
  const titleWords = terms.filter(isTitleShaped).map(termWords)
  const kinds = new Map<string, SearchTermKind>()
  for (const term of terms) {
    const key = term.trim().toLowerCase()
    const own = termWords(term)
    const opensATitle =
      own.length >= PREFIX_MIN_WORDS &&
      titleWords.some((t) => t.length >= own.length && own.every((w, i) => t[i] === w))
    kinds.set(
      key,
      accents && hasDiacritic(term)
        ? 'other-language'
        : isTitleShaped(term) || opensATitle
          ? 'title'
          : 'keyword',
    )
  }
  return kinds
}

export function byMonthlySearchesDesc(a: SearchKeyword, b: SearchKeyword): number {
  const x = a.estimatedMonthlySearch
  const y = b.estimatedMonthlySearch
  if (x === y) return 0
  if (x === null) return 1
  if (y === null) return -1
  return y - x
}

/** Keywords in input order; titles and other languages by monthly searches (nulls last), ten each at most. */
export function splitSearchTerms(
  rows: readonly SearchKeyword[],
  options: { language?: string } = {},
): {
  keywords: SearchKeyword[]
  searchedTitles: SearchKeyword[]
  otherLanguages: SearchKeyword[]
} {
  const kinds = classifySearchTerms(
    rows.map((r) => r.keyword),
    options,
  )
  const kindOf = (r: SearchKeyword) => kinds.get(r.keyword.trim().toLowerCase())
  const top = (kind: SearchTermKind) =>
    rows
      .filter((r) => kindOf(r) === kind)
      .sort(byMonthlySearchesDesc)
      .slice(0, SEARCHED_TERMS_MAX)
  return {
    keywords: rows.filter((r) => kindOf(r) === 'keyword'),
    searchedTitles: top('title'),
    otherLanguages: top('other-language'),
  }
}

/**
 * The distinct lowercased words of the case's format and pillar keywords, for
 * the pick to prefer. Words of two characters or fewer and the subject's own
 * words are dropped: they say nothing about the kind of video.
 */
export function preferredWords(keywords: readonly string[], subject: string): string[] {
  const skip = new Set(termWords(subject))
  const out = new Set<string>()
  for (const keyword of keywords) {
    for (const w of termWords(keyword)) {
      if (w.length > 2 && !skip.has(w)) out.add(w)
    }
  }
  return [...out]
}
