import { truncateAtParagraph } from './tokens'

const SECTION_TOKENS = 6_000
const FALLBACK_TOKENS = 12_000

const ITEM_1 = /^\s*item\s+1\.?\s+business/gim
const ITEM_7 = /^\s*item\s+7\.?\s+management/gim
const ANY_ITEM = /^\s*item\s+\d+[a-z]?\./im

/**
 * Where a section begins. A heading that matches twice is a table of contents
 * entry followed by the real one, so the second occurrence wins.
 */
function sectionStart(text: string, heading: RegExp): number | null {
  const starts = [...text.matchAll(heading)].map((match) => match.index)
  const start = starts.length >= 2 ? starts[1] : starts[0]
  return start ?? null
}

function section(text: string, heading: RegExp): string | null {
  const start = sectionStart(text, heading)
  if (start === null) return null
  // The heading pattern swallows the blank lines before it; start at the words.
  const rest = text.slice(start).trimStart()
  // Skip the heading line itself, or the section would end where it began.
  const firstBreak = rest.indexOf('\n')
  const searchFrom = firstBreak === -1 ? rest.length : firstBreak + 1
  const next = ANY_ITEM.exec(rest.slice(searchFrom))
  const body = next ? rest.slice(0, searchFrom + next.index) : rest
  return truncateAtParagraph(body.trim(), SECTION_TOKENS).text
}

/**
 * The two parts of a 10-K that describe the business and explain its numbers.
 * Risk factors and statements are the bulk of the filing and add little the
 * dossier can quote, so they are left out to keep the prompt small.
 */
export function tenKSections(text: string): string {
  const parts = [section(text, ITEM_1), section(text, ITEM_7)].filter(
    (part): part is string => part !== null,
  )
  if (parts.length === 0) return truncateAtParagraph(text, FALLBACK_TOKENS).text
  return parts.join('\n\n')
}
