import type { SearchBrief } from './search-brief'
import { isEnglish } from './search-terms'

/** Where a measured search term sits against the case's research. */
export type TermBucket = 'target' | 'researched' | 'unresearched' | 'unmatched'

export type ResearchKeywords = { target: string | null; researched: string[] }

const EN_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
  'at',
  'by',
  'with',
  'from',
  'about',
  'what',
  'how',
  'why',
  'who',
  'when',
  'is',
  'was',
  'are',
  'were',
  'did',
  'does',
  'do',
])

const YEAR = /^(19|20)\d{2}$/

/**
 * The sorted distinct words of a term, for comparing searches across word
 * order, case, punctuation and years. Accents go only for an English (or
 * unset) language, per the accent rule in `search-terms.ts`; stop words and
 * plural folding are English only.
 */
export function normaliseTerm(term: string, language?: string): string[] {
  const english = isEnglish(language)
  const base = english ? term.normalize('NFD').replace(/[̀-ͯ]/g, '') : term.normalize('NFC')
  const words = base
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !YEAR.test(w))
  const kept = words
    .filter((w) => !(english && EN_STOP_WORDS.has(w)))
    .map((w) =>
      english && w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w,
    )
  return [...new Set(kept)].sort()
}

/** The target and the researched keywords of a brief: secondaries, searched questions and the chosen (else recommended) angle's keyword. */
export function researchKeywords(brief: SearchBrief): ResearchKeywords {
  const target = brief.targetKeyword?.keyword ?? null
  const angleIndex = brief.chosenAngle ?? brief.recommendedAngle
  const angle = angleIndex === null ? undefined : brief.angleOptions[angleIndex]
  const candidates = [
    ...brief.secondaryKeywords.map((k) => k.keyword),
    ...brief.searchedQuestions,
    ...(angle ? [angle.keyword] : []),
  ]
  const targetKey = target?.trim().toLowerCase() ?? null
  const seen = new Set<string>()
  const researched: string[] = []
  for (const raw of candidates) {
    const keyword = raw.trim()
    const key = keyword.toLowerCase()
    if (key === '' || key === targetKey || seen.has(key)) continue
    seen.add(key)
    researched.push(keyword)
  }
  return { target, researched }
}

/** A term matches a keyword when its words equal the keyword's, or contain all of them. An empty keyword matches nothing. */
export function matchTermDeterministic(
  term: string,
  keywords: ResearchKeywords,
  language?: string,
): { bucket: 'target' | 'researched'; keyword: string } | null {
  const words = new Set(normaliseTerm(term, language))
  const matches = (keyword: string) => {
    const wanted = normaliseTerm(keyword, language)
    return wanted.length > 0 && wanted.every((w) => words.has(w))
  }
  if (keywords.target !== null && matches(keywords.target)) {
    return { bucket: 'target', keyword: keywords.target }
  }
  const hit = keywords.researched.find(matches)
  return hit === undefined ? null : { bucket: 'researched', keyword: hit }
}
