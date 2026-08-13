import {
  OutlineSchema,
  SelfCheckSchema,
  ShortsCandidatesSchema,
  countWords,
  splitSentences,
} from '@boom-busters/schemas'
import type { Outline, SelfCheck, ShortsCandidate } from '@boom-busters/schemas'
import { parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The script stage's prompts (build spec section 7.2): outline → chapters
 * drafted sequentially → self-check → Shorts-candidate marking.
 *
 * The rule threaded through all of them is that the script may only assert
 * what the dossier's claims support. Chapters are drafted against a numbered
 * claim list, and the self-check pass reads the same list back to find the
 * sentences that went beyond it.
 */

export interface ScriptClaim {
  id: string
  text: string
  sourceUrl: string | null
  confidence: string
  /** Whether a court or regulator actually ruled. Drives "alleged". */
  adjudicated?: boolean
}

/**
 * The claim list every drafting and checking prompt sees.
 *
 * Numbered so the self-check pass can refer to a claim by id without the model
 * having to reproduce a 26-character ULID correctly — which it will not do
 * reliably, and a mistyped id silently drops a claim reference.
 */
function claimList(claims: readonly ScriptClaim[]): string {
  if (claims.length === 0) return 'No claims survived review. Do not assert any specific facts.'

  return claims
    .map(
      (claim, index) =>
        `[${index + 1}] (id: ${claim.id}) ${claim.text}` +
        `${claim.adjudicated ? ' — ADJUDICATED' : ' — NOT adjudicated'}` +
        `${claim.confidence === 'unverified' ? ' — UNVERIFIED' : ''}`,
    )
    .join('\n')
}

/**
 * The "written for the ear" block exists because the script's only consumer is
 * a text-to-speech voice (Chirp 3 HD), and that voice has exactly three
 * levers: the words, the punctuation, and `[pause]` markup. Google's own
 * scripting guidance for the model — contractions, short sentences,
 * punctuation as pacing — is drafting advice, so it belongs here, at drafting
 * time, rather than being applied paragraph by paragraph in review after the
 * audio came out wrong.
 */
const HOUSE_STYLE = `You write narration for a documentary channel about
corporate collapses, frauds and meltdowns. The subjects are real companies and
living people.

Voice: plain, specific, unhurried. Short sentences. No rhetorical questions, no
"buckle up", no addressing the audience as "guys". Let the facts carry it.

Written for the ear, not the eye. Every word you write is read aloud by a
text-to-speech narrator, and punctuation is its pacing:
- A full stop is a beat; an em dash or ellipsis is a hesitation. Punctuate for
  how the sentence should be SPOKEN.
- Use contractions where speech would ("it's", "they'd") — the narrator reads
  stiffly without them.
- Break any sentence you would have to take a breath in the middle of.
- Where the delivery needs a deliberate silence — before a reveal, after a
  number that should land — write [pause] on its own, or [pause long] for real
  weight. Use them sparingly: a couple per chapter at most, where the silence
  IS the point. The narrator treats them as intent, not milliseconds.
- Numbers, dates and abbreviations are read exactly as written: write
  "1.9 billion euros", not "€1.9B"; "the S and P 500" is wrong, "the S&P 500"
  is read correctly.

The hard rules:
- Assert nothing the claim list does not support.
- Where a claim is NOT adjudicated, write "alleged", "reportedly", "according
  to" — never state it as established fact.
- Never invent figures, dates, quotes or names.`

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

export function buildOutlineRequest(input: {
  caseTitle: string
  dossierMd: string
  claims: readonly ScriptClaim[]
  targetRuntimeMin: number
}): LLMTaskRequest {
  // 150 words per minute of narration, minus a little for pacing beats.
  const targetWords = Math.round(input.targetRuntimeMin * 150 * 0.95)

  return {
    task: 'scripting',
    system: `${HOUSE_STYLE}

Produce a chapter outline totalling about ${targetWords} words:
{"chapters": [{"title": string, "beat": string, "targetWords": number}]}

"beat" says what the chapter must accomplish — the drafting step sees only the
beat, the previous chapter's ending and the claim list, so anything the chapter
needs must be in the beat.`,
    messages: [
      { role: 'user', content: `Case: ${input.caseTitle}\n\nDossier:\n${input.dossierMd}` },
      { role: 'user', content: `Claims available:\n${claimList(input.claims)}` },
      { role: 'user', content: `Outline it for roughly ${input.targetRuntimeMin} minutes.` },
    ],
    maxTokens: outputBudget(4000),
  }
}

export function parseOutline(text: string): Outline {
  return parseJsonCompletion(text, OutlineSchema, 'outline')
}

// ---------------------------------------------------------------------------
// Chapter drafting
// ---------------------------------------------------------------------------

export function buildChapterRequest(input: {
  caseTitle: string
  outline: Outline
  chapterIndex: number
  /** The tail of the previous chapter, so the seam reads continuously. */
  previousTail: string
  claims: readonly ScriptClaim[]
}): LLMTaskRequest {
  const chapter = input.outline.chapters[input.chapterIndex]!
  const outlineSummary = input.outline.chapters
    .map((c, i) => `${i + 1}. ${c.title}${i === input.chapterIndex ? '  <- writing this one' : ''}`)
    .join('\n')

  return {
    task: 'scripting',
    system: `${HOUSE_STYLE}

Write ONE chapter of narration as markdown prose. No headings, no bullet
points, no stage directions — this text is read aloud exactly as written.

Target about ${chapter.targetWords} words.`,
    messages: [
      // Stable across every chapter of the script, so it is the cacheable
      // prefix: the claim list is the largest part of this prompt and it does
      // not change between chapters.
      { role: 'user', content: `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` },
      { role: 'user', content: `Full outline:\n${outlineSummary}` },
      {
        role: 'user',
        content: input.previousTail
          ? `The previous chapter ended:\n\n"${input.previousTail}"\n\nContinue from there.`
          : 'This is the opening chapter.',
      },
      { role: 'user', content: `Write "${chapter.title}". It must: ${chapter.beat}` },
    ],
    cacheablePrefixMessages: 1,
    // A truncated chapter reads as a chapter that stops mid-sentence.
    maxTokens: outputBudget(Math.round(chapter.targetWords * 2.2)),
  }
}

/** The last couple of sentences, to seam the next chapter onto. */
export function chapterTail(contentMd: string, sentences = 2): string {
  return splitSentences(contentMd).slice(-sentences).join(' ')
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

export function buildSelfCheckRequest(input: {
  chapterTitle: string
  contentMd: string
  claims: readonly ScriptClaim[]
}): LLMTaskRequest {
  return {
    task: 'editing',
    system: `You are checking documentary narration against the claim list it
was written from. You are not rewriting it.

The text may contain [pause] or [pause long] markup — pacing for the narrator,
not words. Ignore it entirely; never flag it and never quote it in a sentence.

For every sentence that asserts a fact, decide:
- Which claim supports it? Report it in "refs" with the claim's id.
- If nothing supports it, warn with kind "unsourced-claim".
- If it states as established fact something the claim list marks NOT
  adjudicated, warn with kind "missing-alleged".
- If it attributes an action or intent to a named person beyond what the
  claims support, warn with kind "unsupported-attribution".

Quote the sentence EXACTLY as it appears, including its punctuation — it is
matched back to the text character for character.

{"warnings": [{"kind": string, "sentence": string, "message": string}],
 "refs": [{"claimId": string, "sentence": string}]}`,
    messages: [
      { role: 'user', content: `Claims:\n${claimList(input.claims)}` },
      { role: 'user', content: `Chapter "${input.chapterTitle}":\n\n${input.contentMd}` },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(8000),
  }
}

export function parseSelfCheck(text: string): SelfCheck {
  return parseJsonCompletion(text, SelfCheckSchema, 'self-check')
}

// ---------------------------------------------------------------------------
// Shorts candidates
// ---------------------------------------------------------------------------

export function buildShortsRequest(input: {
  chapters: readonly { index: number; title: string; contentMd: string }[]
}): LLMTaskRequest {
  return {
    task: 'metadata',
    system: `Pick 5 segments from this script that would work as vertical
Shorts. A segment is 20-50 seconds of narration — roughly 50 to 125 words —
that stands alone without the rest of the video.

Quote the first and last sentence of each segment EXACTLY as they appear.

{"candidates": [{"chapterIndex": number, "startSentence": string,
  "endSentence": string, "hookRationale": string}]}`,
    messages: [
      {
        role: 'user',
        content: input.chapters
          .map((c) => `## Chapter ${c.index} — ${c.title}\n\n${c.contentMd}`)
          .join('\n\n'),
      },
    ],
    maxTokens: outputBudget(3000),
  }
}

export function parseShortsCandidates(text: string): ShortsCandidate[] {
  return parseJsonCompletion(text, ShortsCandidatesSchema, 'Shorts candidates').candidates
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

export function mockOutline(targetRuntimeMin: number): Outline {
  const chapters = Math.max(2, Math.min(8, Math.round(targetRuntimeMin / 3)))

  return {
    chapters: Array.from({ length: chapters }, (_, index) => ({
      title: `[mock] Chapter ${index + 1}`,
      beat: 'Placeholder beat produced in mock mode. Nothing was written by a provider.',
      targetWords: 300,
    })),
  }
}

export function mockChapter(title: string): string {
  return (
    `MOCK NARRATION for "${title}". No provider was called and nothing here was ` +
    'written from the dossier. This paragraph exists so the pipeline has text to ' +
    'carry into the voice stage. It must never be narrated. ' +
    'A second sentence gives the self-check pass something to split on.'
  )
}

/**
 * Mock self-check output.
 *
 * It warns on the first sentence rather than returning clean. A mock that
 * always reports "no problems" would let the warning UI ship untested and
 * would teach the reviewer that the gutter is always empty.
 */
export function mockSelfCheck(contentMd: string): SelfCheck {
  const [first] = splitSentences(contentMd)

  return {
    warnings: first
      ? [
          {
            kind: 'unsourced-claim',
            sentence: first,
            message: 'Mock warning — nothing was checked against a claim.',
          },
        ]
      : [],
    refs: [],
  }
}

export function mockShortsCandidates(
  chapters: readonly { index: number; contentMd: string }[],
): ShortsCandidate[] {
  return chapters.slice(0, 5).flatMap((chapter) => {
    const sentences = splitSentences(chapter.contentMd)
    const start = sentences[0]
    const end = sentences[sentences.length - 1]
    if (!start || !end) return []

    return [
      {
        chapterIndex: chapter.index,
        startSentence: start,
        endSentence: end,
        hookRationale: 'Mock candidate — no segment was actually evaluated.',
      },
    ]
  })
}

/** Words in a whole script, for the header in Script Studio. */
export function scriptWordCount(chapters: readonly { contentMd: string }[]): number {
  return chapters.reduce((total, chapter) => total + countWords(chapter.contentMd), 0)
}

// ---------------------------------------------------------------------------
// Per-section regenerate (spec section 11.3)
// ---------------------------------------------------------------------------

/**
 * Rewrite one selected passage of a chapter.
 *
 * The whole chapter goes in as context but only the selection comes back, so
 * the model cannot quietly reword the paragraphs around it — the diff view
 * would then show changes the human never asked for, and reviewing those is
 * exactly the work the diff view exists to avoid.
 */
export function buildRegenerateRequest(input: {
  chapterTitle: string
  contentMd: string
  selection: string
  note: string
  claims: readonly ScriptClaim[]
}): LLMTaskRequest {
  return {
    task: 'editing',
    system: `${HOUSE_STYLE}

You are rewriting ONE passage of an existing chapter.

Return ONLY the rewritten passage as plain prose. No preamble, no quotes
around it, no explanation, no markdown fences. It is spliced back into the
chapter exactly as you return it.

Keep roughly the same length unless the instruction says otherwise.`,
    messages: [
      { role: 'user', content: `Claims:\n${claimList(input.claims)}` },
      {
        role: 'user',
        content: `Chapter "${input.chapterTitle}" for context:\n\n${input.contentMd}`,
      },
      {
        role: 'user',
        content: `Rewrite this passage:\n\n"${input.selection}"\n\nThe instruction: ${input.note}`,
      },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(Math.round(countWords(input.selection) * 4)),
  }
}

/**
 * Mock regenerate. Returns visibly different text so the diff view has hunks
 * to render — a mock that echoed the selection back would produce an empty
 * diff and leave the accept/reject UI untested.
 */
export function mockRegeneratedSection(selection: string, note: string): string {
  return (
    `[mock regenerate — nothing was rewritten by a provider] ${selection} ` +
    `(the instruction was: ${note || 'none given'})`
  )
}
