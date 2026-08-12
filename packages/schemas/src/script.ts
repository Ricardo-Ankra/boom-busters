import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * Provider IO and shared text utilities for the script stage (build spec
 * sections 7.2 and 11.3).
 *
 * The sentence helpers live here rather than in the runner because three
 * separate places have to agree on what "a sentence" is: the self-check pass
 * that emits a warning against one, `claim_refs.sentenceHash` that pins a
 * claim to one, and Script Studio's gutter that draws a marker beside one. If
 * those three split text differently, the gutter marks the wrong line and the
 * claim popover pins to nothing.
 */

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

/** Sane bounds for a chapter's word target, applied by clamping. */
export const MIN_CHAPTER_WORDS = 120
export const MAX_CHAPTER_WORDS = 4000

export const OutlineChapterSchema = z.object({
  title: z.string().trim().min(3).max(200),
  /** What this chapter has to accomplish, fed to the drafting step. */
  beat: z.string().trim().min(20).max(2000),
  /**
   * How long this chapter should run, clamped rather than validated.
   *
   * It was `min(200).max(4000)`, and rejecting on it was expensive and wrong.
   * `targetWords` is a *hint*: it goes into the drafting prompt and sizes that
   * chapter's token budget. Nothing downstream breaks if it is 150 — a short
   * closing chapter is a legitimate thing for a model to plan, and production
   * shows Opus doing exactly that. What the floor actually did was throw away
   * a whole good outline over one number and pay for the pass again; the run
   * mirror has three such retries in a row, each a full outline call, all
   * failing on `chapters.N.targetWords: Too small`.
   *
   * So the bounds still hold — a 40,000-word chapter would blow any sensible
   * budget — but they are enforced by clamping into range, which costs nothing
   * and loses nothing, instead of by rejecting the batch.
   */
  targetWords: z
    .number()
    .int()
    .transform((words) => Math.min(MAX_CHAPTER_WORDS, Math.max(MIN_CHAPTER_WORDS, words))),
})
export type OutlineChapter = z.infer<typeof OutlineChapterSchema>

export const OutlineSchema = z.object({
  chapters: z.array(OutlineChapterSchema).min(2).max(20),
})
export type Outline = z.infer<typeof OutlineSchema>

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

export const WARNING_KINDS = [
  /** A factual sentence with no claim behind it. */
  'unsourced-claim',
  /** States as fact something no court or regulator adjudicated. */
  'missing-alleged',
  /** Names a living person in a way the sources do not support. */
  'unsupported-attribution',
] as const
export const WarningKindSchema = z.enum(WARNING_KINDS)
export type WarningKind = z.infer<typeof WarningKindSchema>

export const GutterWarningSchema = z.object({
  kind: WarningKindSchema,
  /** The exact sentence, as it appears in the chapter. */
  sentence: z.string().trim().min(1).max(2000),
  /** Shown in the gutter popover. */
  message: z.string().trim().min(5).max(500),
})
export type GutterWarning = z.infer<typeof GutterWarningSchema>

export const ClaimRefSchema = z.object({
  claimId: z.string().min(1),
  sentence: z.string().trim().min(1).max(2000),
})

export const SelfCheckSchema = z.object({
  warnings: z.array(GutterWarningSchema).max(200),
  refs: z.array(ClaimRefSchema).max(500),
})
export type SelfCheck = z.infer<typeof SelfCheckSchema>

// ---------------------------------------------------------------------------
// Shorts candidates
// ---------------------------------------------------------------------------

export const ShortsCandidateSchema = z.object({
  chapterIndex: z.number().int().min(0),
  /** The opening sentence of the segment, matched back to the chapter text. */
  startSentence: z.string().trim().min(1).max(2000),
  endSentence: z.string().trim().min(1).max(2000),
  /** Why this would stop a thumb. Shown beside the segment in the UI. */
  hookRationale: z.string().trim().min(10).max(1000),
})
export type ShortsCandidate = z.infer<typeof ShortsCandidateSchema>

export const ShortsCandidatesSchema = z.object({
  candidates: z.array(ShortsCandidateSchema).max(10),
})

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/**
 * Split a chapter into sentences.
 *
 * Deliberately simple and deliberately shared. It breaks on `.`, `?` and `!`
 * followed by whitespace, and protects the abbreviations that otherwise split
 * a sentence in half mid-citation — "Corp." and "Inc." appear constantly in
 * this subject matter, and a warning pinned to half a sentence points the
 * gutter at the wrong line.
 */
const PROTECTED = /\b(?:Mr|Mrs|Ms|Dr|Prof|Inc|Corp|Ltd|Co|plc|St|No|vs|v|e\.g|i\.e|U\.S|U\.K)\.$/i

export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''

  for (const token of text.split(/(\s+)/)) {
    current += token
    const trimmed = current.trimEnd()

    if (/[.?!]["')\]]?$/.test(trimmed) && !PROTECTED.test(trimmed) && /\s$/.test(token)) {
      sentences.push(trimmed)
      current = ''
    }
  }

  const tail = current.trim()
  if (tail) sentences.push(tail)

  return sentences.filter((sentence) => sentence.length > 0)
}

/**
 * The stable identity of a sentence, for `claim_refs.sentenceHash`.
 *
 * Normalised before hashing — collapsed whitespace, lowercased, punctuation
 * stripped — so that a human fixing a typo or reflowing a paragraph does not
 * orphan every claim reference in the chapter. Only a real rewording should
 * break the link, because a real rewording is exactly when the claim behind
 * the sentence should be re-checked.
 */
export function sentenceHash(sentence: string): string {
  const normalised = sentence
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  return createHash('sha256').update(normalised).digest('hex').slice(0, 32)
}

/** Words per minute of narration, for the runtime estimate on each chapter. */
export const NARRATION_WPM = 150

export function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

export function estimateRuntimeSec(text: string): number {
  return Math.round((countWords(text) / NARRATION_WPM) * 60)
}
