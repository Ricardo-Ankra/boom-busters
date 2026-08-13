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

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------

/**
 * Split a chapter into paragraphs — the unit of narration (spec section 7).
 *
 * "Chapters split into paragraphs on blank lines of the approved `contentMd`,
 * before any TTS call; paragraph indexes are stable thereafter and are the unit
 * for takes, retakes, alignment merge and Shorts segment refs."
 *
 * That stability is the whole contract, and it is why this is one shared
 * function rather than a `split('\n\n')` at each call site. A take is addressed
 * by `(chapterId, paragraphIndex)`; if the runner and the review screen
 * disagreed by one about where paragraph 4 begins, the row you flagged and the
 * audio that got re-synthesised would be different paragraphs.
 *
 * Blank lines are the only separator, exactly as the spec says. A single
 * newline inside a paragraph is a soft wrap, and joining those back into one
 * line matters: narration read aloud must not pause where the markdown happened
 * to wrap.
 */
export function splitParagraphs(contentMd: string): string[] {
  return contentMd
    .split(PARAGRAPH_BREAK)
    .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
}

// ---------------------------------------------------------------------------
// Narration markup
// ---------------------------------------------------------------------------

/**
 * The pause tags Chirp 3 HD understands, written into the script itself.
 *
 * Google's Chirp 3 HD input has a `markup` field alongside `text`, carrying
 * `[pause]`, `[pause short]` and `[pause long]`. They are *intent* rather than
 * duration — the model fits the length to the sentence around it, and may
 * occasionally ignore one — which is why they are offered as three named
 * strengths instead of a millisecond box that would promise precision the
 * vendor does not give.
 *
 * They live in `chapters.contentMd` because the pause is a property of how the
 * line is written, and because a re-read has to be able to reproduce it. That
 * makes them the one thing in the script that is *not* words, so everything
 * downstream of narration — captions, alignment, Shorts segments, metadata —
 * must read the script through `stripNarrationMarkup`. A caption that says
 * "[pause long]" would be this decision's failure mode.
 */
export const PAUSE_TAGS = ['[pause short]', '[pause]', '[pause long]'] as const
export type PauseTag = (typeof PAUSE_TAGS)[number]

const PAUSE_MARKUP = /\[pause(?:\s+(?:short|long))?\]/gi

/** Whether a paragraph carries anything the plain `text` input would mangle. */
export function hasPauseMarkup(text: string): boolean {
  PAUSE_MARKUP.lastIndex = 0
  return PAUSE_MARKUP.test(text)
}

/**
 * The words alone, for everything that is not the synthesiser.
 *
 * Collapses the whitespace a removed tag leaves behind, and tidies the space
 * before punctuation, so `there [pause] , and` does not become `there  , and`
 * in a caption.
 */
export function stripNarrationMarkup(text: string): string {
  return text
    .replace(PAUSE_MARKUP, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/[^\S\r\n]+$/gm, '')
    .trim()
}

/** Blank lines, and nothing else — the separator `splitParagraphs` splits on. */
const PARAGRAPH_BREAK = /\r?\n\s*\r?\n/
/** The same rule, capturing, so a chapter can be put back together unchanged. */
const PARAGRAPH_BREAK_KEEPING_SEPARATORS = /(\r?\n\s*\r?\n)/

/**
 * Rewrite one paragraph of a chapter, leaving every other byte alone.
 *
 * The obvious implementation — `splitParagraphs`, replace, `join('\n\n')` — is
 * wrong, and quietly. `splitParagraphs` normalises: it folds soft wraps into
 * spaces and trims. Rejoining its output would rewrite the entire chapter to
 * that normal form, so a one-word fix to paragraph 4 would arrive in the edit
 * trail as a diff touching every line, and the human reviewing it could not see
 * what actually changed. So the raw blocks are kept and only one is swapped.
 *
 * **Returns `undefined` rather than the original when the index is out of
 * range**, because the caller is about to spend money narrating whatever comes
 * back, and "nothing changed" and "I could not find it" must not look alike.
 *
 * A replacement containing a blank line is refused for the same reason spec §7
 * calls paragraph indexes stable: it would split one paragraph into two, shift
 * every index after it in the chapter, and orphan the takes addressed by them.
 * Splitting a paragraph is a script edit, not a re-read.
 */
export function replaceParagraph(
  contentMd: string,
  index: number,
  replacement: string,
): string | undefined {
  if (index < 0 || !Number.isInteger(index)) return undefined
  if (replacement.trim() === '') return undefined
  if (PARAGRAPH_BREAK.test(replacement)) return undefined

  const parts = contentMd.split(PARAGRAPH_BREAK_KEEPING_SEPARATORS)
  let seen = -1

  // Even positions hold blocks, odd positions the separators between them.
  for (let i = 0; i < parts.length; i += 2) {
    const block = parts[i] ?? ''
    if (block.trim() === '') continue

    seen += 1
    if (seen !== index) continue

    // Keep the block's own surrounding whitespace: in markdown it may be
    // meaningful indentation, and it is never what the edit was about.
    const [, lead = '', , trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(block) ?? []
    parts[i] = `${lead}${replacement.trim()}${trail}`
    return parts.join('')
  }

  return undefined
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
  const normalised = stripNarrationMarkup(sentence)
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
  // Markup is not words. A paragraph with three pause tags in it is not eleven
  // words longer, and every runtime estimate and chapter-length warning in the
  // app is built on this number.
  const words = stripNarrationMarkup(text)
  return words === '' ? 0 : words.split(/\s+/).length
}

export function estimateRuntimeSec(text: string): number {
  return Math.round((countWords(text) / NARRATION_WPM) * 60)
}
