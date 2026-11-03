import { searchBriefLine } from '@boom-busters/schemas'
import type { SearchBrief } from '@boom-busters/schemas'

/** A YouTube tag is at most 100 characters; the publish draft refuses longer. */
const TAG_MAX = 100

/** A tag must be on this many outlier videos to be taken. */
const OUTLIER_TAG_MIN_VIDEOS = 2

const BUSINESS_DOCUMENTARY = 'business documentary'

const YEAR = /\b(?:19|20)\d{2}\b/g

/** One line, or an empty string when it would not fit a tag (cut text would be a different tag). */
function tagLine(text: string): string {
  const line = searchBriefLine(text, 1000)
  return line.length > TAG_MAX ? '' : line
}

/** What marks a tag as about a cast member: the whole name, and a surname long enough to mean something. */
function castNames(cast: readonly string[]): string[] {
  const names: string[] = []
  for (const text of cast) {
    const name = tagLine(text).toLowerCase()
    if (name === '') continue
    names.push(name)
    const last = name.split(' ').at(-1) ?? ''
    if (last !== name && last.length >= 4) names.push(last)
  }
  return names
}

/**
 * The tags the case's search brief supplies, in order (spec 7.5): the target
 * keyword and the secondary keywords as the brief lists them; the tags at least
 * two outlier videos share that name the subject, a cast member or a year the
 * brief mentions, then "business documentary" when any outlier has it; and the
 * cast's names. Deduplicated case-insensitively, first spelling kept. A keyword
 * stays a tag even with a figure in it: a tag is search text, not a claim.
 */
export function searchTags(brief: SearchBrief, cast: readonly string[]): string[] {
  const keywords = [
    ...(brief.targetKeyword ? [brief.targetKeyword.keyword] : []),
    ...brief.secondaryKeywords.map((row) => row.keyword),
  ]

  const years = new Set(
    [brief.subject, ...keywords, ...brief.searchedQuestions].flatMap(
      (text) => text.match(YEAR) ?? [],
    ),
  )
  const subject = tagLine(brief.subject).toLowerCase()
  const names = castNames(cast)
  const aboutCase = (tag: string): boolean => {
    const lower = tag.toLowerCase()
    if (subject !== '' && lower.includes(subject)) return true
    if (names.some((name) => lower.includes(name))) return true
    return (lower.match(YEAR) ?? []).some((year) => years.has(year))
  }

  // One count per video, by lower-cased tag, keeping the first spelling and the order seen.
  const counts = new Map<string, { tag: string; videos: number }>()
  for (const outlier of brief.outliers) {
    const seenHere = new Set<string>()
    for (const raw of outlier.tags) {
      const tag = tagLine(raw)
      const key = tag.toLowerCase()
      if (tag === '' || seenHere.has(key)) continue
      seenHere.add(key)
      const entry = counts.get(key)
      if (entry) entry.videos += 1
      else counts.set(key, { tag, videos: 1 })
    }
  }
  const shared = [...counts.values()]
    .filter((entry) => entry.videos >= OUTLIER_TAG_MIN_VIDEOS && aboutCase(entry.tag))
    .map((entry) => entry.tag)
  const business = counts.has(BUSINESS_DOCUMENTARY) ? [BUSINESS_DOCUMENTARY] : []

  const tags: string[] = []
  const seen = new Set<string>()
  for (const raw of [...keywords, ...shared, ...business, ...cast]) {
    const tag = tagLine(raw)
    const key = tag.toLowerCase()
    if (tag === '' || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}
