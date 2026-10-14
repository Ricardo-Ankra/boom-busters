import { z } from 'zod'

/**
 * The publish description, composed (build spec section 9): "hook paragraph
 * + chapter timestamps + sources from dossier + disclaimer". The opening, the
 * chapter notes and the hashtags are the owner's to edit; since decision 302
 * a model may draft them from the claim list ("Write a search description"),
 * and the owner keeps them or not. Everything else is appended
 * deterministically from what is on file, and the live preview on the
 * Publish screen renders exactly what this function returns.
 */

/** YouTube's own description ceiling. */
export const DESCRIPTION_MAX_CHARS = 5000

/**
 * The standing disclaimer, baked in rather than configurable: it is legal
 * copy, and a settings field would make "forgot to set it" a publishable
 * state. The AI-disclosure sentence is part of it — narration and some
 * imagery are synthetic on every video this pipeline makes, so disclosing it
 * is not conditional (spec section 9 lists the disclosure flag; the words
 * belong here where every description gets them).
 */
export const PUBLISH_DISCLAIMER =
  'This video is documentary commentary for education. It is not financial advice. ' +
  'Narration is AI-generated. Some visuals are AI re-creations for illustration, including ' +
  'likenesses of real people; they are not photographs of real events. Sources are listed above.'

/** How long a chapter's search gloss may run (decision 302). */
export const CHAPTER_GLOSS_MAX = 90

/** YouTube shows the first three hashtags above the title; more are noise. */
export const HASHTAGS_MAX = 3

/** The longest hashtag a draft stores. */
export const HASHTAG_MAX = 60

/**
 * Draft fields the Publish screen stores in `publish_records.metadata`
 * while an item is being prepared. They live beside the final
 * `PublishMetadataSchema` keys (title/description/tags) in the same jsonb;
 * the runner's schema ignores keys it does not know.
 */
export const PublishDraftSchema = z.object({
  title: z.string().trim().max(100).optional(),
  titleOptions: z.array(z.string()).max(12).default([]),
  /** The human-owned opening — the auto-blocks are appended at compose time. */
  descriptionBody: z.string().max(DESCRIPTION_MAX_CHARS).optional(),
  /**
   * The script version the opening was written for (decision 302). A body
   * saved before the script was rewritten is flagged on the Publish screen;
   * absent on bodies saved before this existed, which are flagged too.
   */
  bodyScriptVersion: z.number().int().min(0).optional(),
  /**
   * One search gloss per chapter, keyed by chapter id. A rewritten script has
   * new chapter ids, so its glosses fall away rather than print under a
   * chapter they were not written for (decision 302, review).
   */
  chapterGlosses: z.record(z.string(), z.string().trim().max(CHAPTER_GLOSS_MAX)).default({}),
  /** At most three, each one word; the composer normalises them. */
  hashtags: z.array(z.string().trim().max(HASHTAG_MAX)).max(HASHTAGS_MAX).default([]),
  tags: z.array(z.string().trim().min(1).max(100)).max(60).default([]),
})
export type PublishDraft = z.infer<typeof PublishDraftSchema>

/** `825000` → "13:45"; `4923000` → "1:22:03". YouTube's timestamp format. */
export function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const mmss = `${hours > 0 ? String(minutes).padStart(2, '0') : minutes}:${String(
    seconds,
  ).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

export interface DescriptionChapter {
  title: string
  startMs: number
  /** What the chapter is about, for search (decision 302). Printed after the title. */
  gloss?: string | null
}

/** A source line: the address, and what it backs when that is known (decision 302). */
export interface DescriptionSource {
  url: string
  label?: string | null
}

/**
 * A source line's label (decision 302): the outlet the article record read,
 * else the bare host, and the article's own headline when one is on file,
 * quoted whole. Only the publisher's words are printed: a claim's text was
 * written for research, and cutting it could drop the clause that
 * attributed or hedged it.
 */
export function sourceLabel(input: {
  url: string
  outlet: string | null
  headline: string | null
}): string {
  let host = input.url
  try {
    host = new URL(input.url).hostname.replace(/^www\./, '')
  } catch {
    // An address that will not parse is labelled by itself.
  }
  const outlet = input.outlet?.trim() || host
  const headline = input.headline?.trim()
  return headline ? `${outlet}, "${headline}"` : outlet
}

/**
 * Hashtags as the owner types them (decision 302): a comma or a "#" starts a
 * new one, and the words inside one are joined, so "Stability AI, #Fraud" is
 * "#StabilityAI #Fraud". The preview and the save read the field the same way.
 */
export function splitHashtags(raw: string): string[] {
  const tags = raw
    .split(/,|(?=#)/)
    .map(normaliseHashtag)
    .filter((tag) => tag !== '')
  const seen = new Set<string>()
  return tags.filter((tag) => {
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** "#AI Documentary" or "StableDiffusion" to one word with its mark; empty when nothing is left. */
function normaliseHashtag(raw: string): string {
  const word = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')
  return word === '' ? '' : `#${word}`
}

export interface ComposeDescriptionInput {
  /** The editable opening. Usually seeded with the script's hook paragraph. */
  body: string
  /** In playback order. Fewer than three means no chapter block — YouTube
   *  ignores chapter markers below three, so emitting them would be noise. */
  chapters: readonly DescriptionChapter[]
  /**
   * Source URLs from the dossier's verified claims, already deduplicated: a
   * bare address, or one with a label saying what it backs (decision 302).
   */
  sources: readonly (string | DescriptionSource)[]
  /** Up to three hashtags, on their own line before the disclaimer (decision 302). */
  hashtags?: readonly string[]
  /**
   * The music bed's attribution/licence text, from the library (decision
   * 207). Published verbatim in its own block so the licence rides with
   * every upload that uses the track — a Content ID claim is then answered
   * by the video's own description. Absent when the timeline has no bed or
   * the bed carries no text.
   */
  musicAttribution?: string | null
}

export interface ComposedDescription {
  description: string
  /** How many sources were dropped to fit the 5000-character ceiling. */
  droppedSources: number
}

/**
 * Body, then chapters, then music attribution, then sources, then the
 * disclaimer — and it always fits. The ceiling is enforced by dropping
 * sources from the end of the list (the block that grows without bound),
 * never by truncating mid-sentence: a description YouTube would cut off is a
 * bug, and a disclaimer that got cut off is a liability. The music block is
 * licence copy, so like the disclaimer it is never the block that gets
 * dropped.
 */
export function composeDescription(input: ComposeDescriptionInput): ComposedDescription {
  const body = input.body.trim()

  const chapterBlock =
    input.chapters.length >= 3
      ? ['Chapters:']
          .concat(
            input.chapters.map((chapter, index) => {
              // YouTube requires the first stamp to be exactly 0:00.
              const stamp = index === 0 ? '0:00' : formatTimestamp(chapter.startMs)
              // One line per chapter, or YouTube ignores the whole block.
              const gloss = chapter.gloss?.replace(/\s+/g, ' ').trim()
              return `${stamp} ${chapter.title}${gloss ? `: ${gloss}` : ''}`
            }),
          )
          .join('\n')
      : null

  const attribution = input.musicAttribution?.trim()
  const musicBlock = attribution ? `Music:\n${attribution}` : null

  const hashtags = [
    ...new Set((input.hashtags ?? []).map(normaliseHashtag).filter((tag) => tag !== '')),
  ].slice(0, HASHTAGS_MAX)
  const hashtagBlock = hashtags.length > 0 ? hashtags.join(' ') : null

  const sourceLine = (source: string | DescriptionSource): string => {
    if (typeof source === 'string') return source
    const label = source.label?.trim()
    return label ? `${label}: ${source.url}` : source.url
  }

  const build = (sources: readonly (string | DescriptionSource)[]): string => {
    const sourceBlock =
      sources.length > 0 ? ['Sources:'].concat(sources.map(sourceLine)).join('\n') : null
    return [body, chapterBlock, musicBlock, sourceBlock, hashtagBlock, PUBLISH_DISCLAIMER]
      .filter((block): block is string => block !== null && block !== '')
      .join('\n\n')
  }

  let kept = [...input.sources]
  let description = build(kept)
  while (description.length > DESCRIPTION_MAX_CHARS && kept.length > 0) {
    kept = kept.slice(0, -1)
    description = build(kept)
  }

  return { description, droppedSources: input.sources.length - kept.length }
}
