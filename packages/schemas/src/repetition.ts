import { splitSentences, stripNarrationMarkup } from './script'
import type { GutterWarning } from './script'

/**
 * The whole-script repetition check (decision 296).
 *
 * Chapters are drafted one at a time, and until this decision each draft saw
 * only the previous chapter's last two sentences; the Stability script told
 * March 2024 in full twice. The drafter now sees the script so far, and this
 * pass is the backstop: a sentence carrying a run of six words that an
 * earlier chapter already narrated becomes a gutter warning on the later
 * chapter, which parks the gate like any other warning. Deterministic and
 * free: no model call, so it runs in mock mode too.
 *
 * Six words, because the duplications worth a human's eye are figures with
 * their attribution ("under 5 million dollars in revenue"), and five-word
 * runs are common connective tissue ("in the first quarter of"). A repeat
 * inside one chapter is the prompt's business, not this pass's.
 */

export const REPEAT_RUN_WORDS = 6

/** How much of the earlier sentence the message quotes. */
const QUOTE_MAX = 160

export interface RepeatWarning {
  chapterIndex: number
  warning: GutterWarning
}

/** The words of a sentence as the ear hears them: no tags, no case, no punctuation. */
function words(sentence: string): string[] {
  return stripNarrationMarkup(sentence)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
}

function runs(sentence: string): string[] {
  const tokens = words(sentence)
  const found: string[] = []
  for (let at = 0; at + REPEAT_RUN_WORDS <= tokens.length; at++) {
    found.push(tokens.slice(at, at + REPEAT_RUN_WORDS).join(' '))
  }
  return found
}

function quote(sentence: string): string {
  const spoken = stripNarrationMarkup(sentence)
  return spoken.length > QUOTE_MAX ? `${spoken.slice(0, QUOTE_MAX).trimEnd()}...` : spoken
}

export function findRepeats(
  chapters: readonly { index: number; contentMd: string }[],
): RepeatWarning[] {
  const heard = new Map<string, { chapterIndex: number; sentence: string }>()
  const repeats: RepeatWarning[] = []

  for (const chapter of [...chapters].sort((a, b) => a.index - b.index)) {
    const own: { run: string; sentence: string }[] = []
    for (const sentence of splitSentences(chapter.contentMd)) {
      const sentenceRuns = runs(sentence)
      const earlier = sentenceRuns.map((run) => heard.get(run)).find((hit) => hit !== undefined)
      if (earlier) {
        repeats.push({
          chapterIndex: chapter.index,
          warning: {
            kind: 'repeats-earlier',
            sentence,
            message: `Repeats chapter ${earlier.chapterIndex + 1}: "${quote(earlier.sentence)}"`,
          },
        })
      }
      for (const run of sentenceRuns) own.push({ run, sentence })
    }
    // Remembered only once the whole chapter is scanned, so a chapter never
    // matches itself; the first sentence to say a run is the one quoted.
    for (const { run, sentence } of own) {
      if (!heard.has(run)) heard.set(run, { chapterIndex: chapter.index, sentence })
    }
  }

  return repeats
}
