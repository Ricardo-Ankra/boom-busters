import { countWords, narrationTags, splitSentences, stripNarrationMarkup } from './script'
import type { GutterWarning } from './script'

/**
 * The deterministic style and length checks (decision 458).
 *
 * The house style is a prompt, and a prompt is a request, not a guarantee. This
 * pass reads the finished chapters for the rules a program can check for free:
 * rhetorical questions, the banned vocabulary, metronomic sentences, tag
 * discipline, digits, and length against the outline. It runs in the script's
 * self-check beside the model's warnings, in mock mode too, and every warning
 * is advisory (the kind's default severity, so none is written here): a human
 * decides whether a banned word was the right word.
 *
 * Each warning is anchored to a sentence `splitSentences` returns for its
 * chapter, so Script Studio can place it in the gutter. The one exception is a
 * tag standing alone as a paragraph, which has no sentence of its own and is
 * anchored to the paragraph as written.
 */

/** The words and phrases the house style forbids, in the order the prompt prints them. */
export const BANNED_WORDS: readonly string[] = [
  'delve',
  'leverage',
  'robust',
  'comprehensive',
  'streamline',
  'foster',
  'facilitate',
  'pivotal',
  'nuanced',
  'multifaceted',
  'tapestry',
  'testament',
  'intricate',
  'landscape',
  'showcase',
  'underscore',
  'crucial',
  'vibrant',
  'furthermore',
  'moreover',
  'notably',
  'it is important to note',
  'in conclusion',
  'at the end of the day',
  'little did they know',
]

/** One narration tag per this many words, rounded up. */
export const TAG_WORDS = 120
/** A chapter under this share of its outline target is short. */
export const CHAPTER_LENGTH_FLOOR = 0.9
/** A chapter over this share of its outline target is long. */
export const CHAPTER_LENGTH_CEILING = 1.2
/** A whole script under this share of its target is short. */
export const SCRIPT_LENGTH_FLOOR = 0.9

/** Sentences longer than this count towards a run of same-length sentences. */
const RUN_MIN_WORDS = 8
/** The most the longest and shortest of a run may differ by. */
const RUN_SPREAD = 2

export interface LintWarning {
  chapterIndex: number
  warning: GutterWarning
}

interface LintChapter {
  index: number
  contentMd: string
}

type Found = GutterWarning[]

const style = (sentence: string, message: string): GutterWarning => ({
  kind: 'style',
  sentence,
  message,
})

const offTarget = (sentence: string, message: string): GutterWarning => ({
  kind: 'off-target-length',
  sentence,
  message,
})

const percent = (words: number, target: number): number => Math.round((words / target) * 100)

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const BANNED_PATTERNS = BANNED_WORDS.map((word) => ({
  word,
  pattern: new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i'),
}))

/** A digit run of three or more, or a comma-grouped number: the figures a narrator must spell out. */
const DIGITS = /\d{1,3}(?:,\d{3})+|\d{3,}/g

function isYear(match: string): boolean {
  return /^\d{4}$/.test(match) && Number(match) >= 1000 && Number(match) <= 2099
}

function rhetoricalQuestions(sentences: readonly string[]): Found {
  return sentences
    .filter((sentence) => stripNarrationMarkup(sentence).endsWith('?'))
    .map((sentence) =>
      style(sentence, 'A rhetorical question. The house style bans them: say the thing.'),
    )
}

function bannedWords(sentences: readonly string[]): Found {
  const found: Found = []
  for (const sentence of sentences) {
    const spoken = stripNarrationMarkup(sentence)
    const hit = BANNED_PATTERNS.find(({ pattern }) => pattern.test(spoken))
    if (hit) found.push(style(sentence, `Banned word: "${hit.word}".`))
  }
  return found
}

function sentenceRuns(sentences: readonly string[]): Found {
  const found: Found = []
  const counts = sentences.map(countWords)
  for (let i = 2; i < sentences.length; i++) {
    const run = [counts[i - 2]!, counts[i - 1]!, counts[i]!]
    if (run.every((n) => n > RUN_MIN_WORDS) && Math.max(...run) - Math.min(...run) <= RUN_SPREAD) {
      found.push(
        style(
          sentences[i]!,
          `Three sentences of ${run[0]}, ${run[1]} and ${run[2]} words in a row. Vary the length.`,
        ),
      )
    }
  }
  return found
}

/** Paragraphs as the narrator would see them, tag-only ones included. */
function tagOnlyParagraphs(contentMd: string): Found {
  return contentMd
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter((paragraph) => paragraph !== '' && stripNarrationMarkup(paragraph) === '')
    .map((paragraph) =>
      style(
        paragraph,
        'A tag as its own paragraph. A paragraph is one voice take and must contain spoken words.',
      ),
    )
}

/** The sentence carrying the nth (1-based) tag of the chapter that matches, or null. */
function sentenceOfNthTag(
  sentences: readonly string[],
  nth: number,
  matches: (tag: string) => boolean,
): string | null {
  let seen = 0
  for (const sentence of sentences) {
    seen += narrationTags(sentence).filter(matches).length
    if (seen >= nth) return sentence
  }
  return null
}

function tagBudget(contentMd: string, sentences: readonly string[]): Found {
  const words = countWords(contentMd)
  // A tag-only chapter has no words to budget against; the paragraph rule speaks for it.
  if (words === 0) return []
  const tags = narrationTags(contentMd).length
  const limit = Math.ceil(words / TAG_WORDS)
  if (tags <= limit) return []
  const sentence = sentenceOfNthTag(sentences, limit + 1, () => true)
  if (sentence === null) return []
  return [
    style(
      sentence,
      `${tags} narration tags in ${words} words. At most one every ${TAG_WORDS} words.`,
    ),
  ]
}

function longPauses(sentences: readonly string[]): Found {
  const isLongPause = (tag: string) => tag.toLowerCase() === '[long pause]'
  const total = sentences.reduce((n, s) => n + narrationTags(s).filter(isLongPause).length, 0)
  if (total < 2) return []
  const sentence = sentenceOfNthTag(sentences, 2, isLongPause)
  if (sentence === null) return []
  return [style(sentence, '[long pause] more than once in a chapter. Keep one.')]
}

function digits(sentences: readonly string[]): Found {
  const found: Found = []
  for (const sentence of sentences) {
    const spoken = stripNarrationMarkup(sentence)
    const match = [...spoken.matchAll(DIGITS)].map((m) => m[0]).find((m) => !isYear(m))
    if (match !== undefined) found.push(style(sentence, `Spell it out: "${match}".`))
  }
  return found
}

function chapterLength(words: number, target: number | undefined, lastSentence: string): Found {
  if (target === undefined || target <= 0 || words === 0) return []
  if (words >= CHAPTER_LENGTH_FLOOR * target && words <= CHAPTER_LENGTH_CEILING * target) return []
  return [
    offTarget(
      lastSentence,
      `${words} words against a target of ${target} (${percent(words, target)}%).`,
    ),
  ]
}

function scriptLength(totalWords: number, targetWords: number, lastSentence: string): Found {
  if (targetWords <= 0 || totalWords >= SCRIPT_LENGTH_FLOOR * targetWords) return []
  return [
    offTarget(
      lastSentence,
      `The script is ${totalWords} words against a target of ${targetWords} (${percent(totalWords, targetWords)}%).`,
    ),
  ]
}

/**
 * Lint a drafted script. `outline` supplies each chapter's word target by index
 * (a chapter past its end is not length-checked) and `targetWords` the whole
 * script's. A chapter with no sentence gets no warning of any kind.
 */
export function scriptLint(
  chapters: readonly LintChapter[],
  outline: { chapters: readonly { targetWords: number }[] },
  targetWords: number,
): LintWarning[] {
  const found: LintWarning[] = []
  const push = (chapterIndex: number, warnings: Found) => {
    for (const warning of warnings) found.push({ chapterIndex, warning })
  }

  for (const chapter of chapters) {
    const sentences = splitSentences(chapter.contentMd)
    if (sentences.length === 0) continue
    const words = countWords(chapter.contentMd)

    push(chapter.index, rhetoricalQuestions(sentences))
    push(chapter.index, bannedWords(sentences))
    push(chapter.index, sentenceRuns(sentences))
    push(chapter.index, tagOnlyParagraphs(chapter.contentMd))
    push(chapter.index, tagBudget(chapter.contentMd, sentences))
    push(chapter.index, longPauses(sentences))
    push(chapter.index, digits(sentences))
    push(
      chapter.index,
      chapterLength(words, outline.chapters[chapter.index]?.targetWords, sentences.at(-1)!),
    )
  }

  const last = chapters.at(-1)
  const lastSentence = last ? splitSentences(last.contentMd).at(-1) : undefined
  if (last && lastSentence !== undefined) {
    const total = chapters.reduce((n, chapter) => n + countWords(chapter.contentMd), 0)
    push(last.index, scriptLength(total, targetWords, lastSentence))
  }

  return found
}
