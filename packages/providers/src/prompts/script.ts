import {
  OUTLINE_BEAT_MAX,
  OutlineSchema,
  SelfCheckSchema,
  SHORTS_CANDIDATES_MAX,
  SHORTS_HOOK_MAX,
  SHORTS_SENTENCE_MAX,
  ShortsCandidatesSchema,
  TEASER_PARAGRAPH_MAX,
  TEASER_PARAGRAPH_MIN,
  TEASER_PARAGRAPHS_MAX,
  TEASER_PARAGRAPHS_MIN,
  TEASER_TITLE_MAX,
  TEASER_TITLE_MIN,
  TeaserScriptSchema,
  ValidationError,
  claimCarriesArticle,
  claimCarriesPost,
  countWords,
  splitSentences,
} from '@boom-busters/schemas'
import type {
  BibleInUse,
  ChannelBible,
  Outline,
  OutlineChapter,
  SelfCheck,
  ShortsCandidate,
  TeaserScript,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { channelRulesBlock, fillSlots, noun } from './bible'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, overLimit, trimField } from './repair'
import type { Note } from './repair'
import { SCRIPT_CRAFT } from './script-craft'
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
  /**
   * The kind of source behind the claim. Only a `major_outlet` claim with a
   * surviving URL can back a headline shot (decision 257), so the claim list
   * marks those and the runner enforces it.
   */
  sourceType?: string
}

/**
 * The claim list every drafting and checking prompt sees.
 *
 * Numbered so the self-check pass can refer to a claim by id without the model
 * having to reproduce a 26-character ULID correctly — which it will not do
 * reliably, and a mistyped id silently drops a claim reference.
 */
export function claimList(claims: readonly ScriptClaim[]): string {
  if (claims.length === 0) return 'No claims survived review. Do not assert any specific facts.'

  return claims
    .map(
      (claim, index) =>
        `[${index + 1}] (id: ${claim.id}) ${claim.text}` +
        `${claim.adjudicated ? ' — ADJUDICATED' : ' — NOT adjudicated'}` +
        `${claim.confidence === 'unverified' ? ' — UNVERIFIED' : ''}` +
        `${claimCarriesArticle(claim) ? ' — NEWS ARTICLE' : ''}` +
        `${claimCarriesPost(claim) ? ' (X POST)' : ''}`,
    )
    .join('\n')
}

/**
 * The "written for the ear" block exists because the script's only consumer
 * is a text-to-speech voice (ElevenLabs Eleven v3), whose levers are the
 * words, the punctuation, and bracketed narration tags. Scripting guidance —
 * contractions, short sentences, punctuation as pacing — is drafting advice,
 * so it belongs here, at drafting time, rather than being applied paragraph
 * by paragraph in review after the audio came out wrong.
 *
 * The "Sound like a person" block distils github.com/harshaneel/humanize
 * (MIT) down to the levers that survive being read aloud: the banned
 * vocabulary, sentence-length burstiness, hedge surgery, asymmetric
 * contrast, one canonical name per referent, no scaffolding. Two of its
 * rules are deliberately NOT taken: em dashes stay (they are this
 * narrator's hesitation channel, not decoration), and the legal hedges
 * ("alleged", "reportedly") are mandatory here, not filler — a humanizer
 * that deleted them would walk defamation into a script.
 */
export function houseStyle(bible: ChannelBible): string {
  return `You write narration for a documentary channel about
[[example:script-channel-subject]]. The subjects are real ${noun(bible, 'plural')} and
living people.

Voice: ${bible.narrationRegister}. No rhetorical questions, no "buckle up", no
addressing the audience as "guys". Let the facts carry it.

Sound like a person, not a language model:
- Never write: delve, leverage, robust, comprehensive, streamline, foster,
  facilitate, pivotal, nuanced, multifaceted, tapestry, testament, intricate,
  landscape, showcase, underscore, crucial, vibrant, furthermore, moreover,
  notably, "it is important to note", "in conclusion", "at the end of the
  day", "little did they know".
- Vary sentence length hard. Put a fragment — five words or fewer — near
  every long sentence. Never three same-length sentences in a row: metronomic
  pacing is the loudest tell there is once it is read aloud.
- One canonical name per person or ${noun(bible, 'singular')}, then pronouns. Never [[example:script-elegant-variation]] — elegant
  variation is a tell, and it makes a listener work out who you mean.
- Make contrasts asymmetric. Never "not just X, it's Y", never a neatly
  balanced pair, never a drumbeat of exactly three parallel items.
- Cut empty hedges: "generally", "arguably", "in many cases", "some would
  say". Say the thing. The [[example:script-hedge-kind]] in the hard rules below are the
  opposite of empty and are never cut.
- No summing-up anywhere. A chapter ends on its last fact, not on a
  restatement or a moral, and no paragraph in its middle restates what the
  listener has already heard. The one exception is the film's close, which
  the final chapter's contract describes: a reading, an echo and an open
  thread, never a recap.

Written for the ear, not the eye. Every word you write is read aloud by a
text-to-speech narrator, and punctuation is its pacing:
- A full stop is a beat; an em dash or ellipsis is a hesitation. Punctuate for
  how the sentence should be SPOKEN — and if the hesitation is not deliberate,
  it is a full stop.
- Use contractions where speech would ("it's", "they'd") — the narrator reads
  stiffly without them.
- Break any sentence you would have to take a breath in the middle of.
- Where the delivery needs a deliberate silence — before a reveal, after a
  number that should land — write [pause], or [long pause] for real weight,
  inside the sentence or between sentences of the paragraph. The narrator
  treats them as intent, not milliseconds. Never write a tag as its own
  paragraph: a paragraph is one voice take, and a take must contain spoken
  words — the silence between paragraphs already exists without a tag.
- Anything in square brackets is a stage direction the narrator acts on but
  never reads aloud. Direct the read inline where a line's delivery is the
  point: [sighs] before the resignation letter, [whispers] for the detail
  nobody said out loud, [exhales], or free-form direction like
  [grave, measured] or [emphasis on "never"]. A handful per chapter, placed
  where they earn their keep — the default register is even and unforced,
  and a script that gasps at everything gasps at nothing.
- Numbers, dates and abbreviations are read exactly as written: write
  [[example:script-read-aloud-numbers]].

${bible.hedgingRules}`
}

/** This channel's script rules for the system prompt; empty for a channel with none. */
const scriptRules = (inUse: BibleInUse): string => channelRulesBlock(inUse.bible, 'script')

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

export function buildOutlineRequest(input: {
  bible: BibleInUse
  caseTitle: string
  dossierMd: string
  claims: readonly ScriptClaim[]
  targetRuntimeMin: number
}): LLMTaskRequest {
  // 150 words per minute of narration, minus a little for pacing beats.
  const targetWords = Math.round(input.targetRuntimeMin * 150 * 0.95)

  return {
    task: 'scripting',
    system: fillSlots(
      `${houseStyle(input.bible.bible)}

${SCRIPT_CRAFT}${scriptRules(input.bible)}

Produce a chapter plan totalling about ${targetWords} words:
{"centralQuestion": string,
 "storylines": [string],
 "close": {"answer": string, "echo": string, "openThread": string},
 "chapters": [{"title": string, "storyline": string, "beat": string,
   "claims": [number], "question": string, "withhold": string,
   "reveals": string, "stakes": string, "constraints": string,
   "targetWords": number}]}

The plan, per chapter:
- "beat": one to three sentences on what the chapter accomplishes. Never a
  list of facts: the facts are the claims it owns.
- "claims": the numbers of the claims this chapter narrates in full, from the
  claim list below. Every claim belongs to exactly one chapter, the chapter
  where it lands hardest. A claim listed by two chapters stays with the first;
  the app drops the second listing. A chapter may still refer in a few words
  to a claim another chapter owns.
- "storyline": which of the film's "storylines" this chapter advances. Name
  two to four storylines for the film ([[example:script-storyline-examples]]). A
  chapter advances one and may touch the others in a few words; a storyline
  left untouched for two chapters returns in the next.
- "reveals": the fact an earlier chapter withheld that this chapter reveals,
  if any. A withheld fact is revealed once.
- "constraints": the wording limits for this chapter: what must stay
  attributed and to whom, what is never stated as fact, which figures are
  unsourced and must not appear. They shape the words and are never narrated.
  Put the dossier's corrections here, not in the beat.

The tension contract, per chapter:
- "question": the open question this chapter plants and must NOT answer; the
  next chapter answers it.
- "withhold": the fact this chapter deliberately does not say, and which later
  chapter reveals it.
- "stakes": what is concretely at risk while this chapter runs: people,
  money, dates.
"centralQuestion" is the one question the whole film exists to answer; only
the final chapter answers it. Design the arc so each chapter's stakes are
larger or more personal than the last.

"close" is how the film ends, written as the final chapter's last paragraphs:
- "answer": the central question answered in plain words, as this channel's
  reading of the record, [[example:script-close-hedge]].
- "echo": one image, number or phrase from the opening chapter that the
  ending returns to, so the film closes the loop it opened.
- "openThread": the one thing still unresolved, which is the last line.
The close is the one place the film says what it thinks. It is never a recap
of the chapters.

The opening chapter is a glimpse of the consequence in a few sentences, most
of its detail withheld. The opening chapter owns none of the claims of the
moment it glimpses: the chapter where the chronology returns to that moment
owns them, opens with one line of callback, and narrates only the claims it
owns.`,
      input.bible,
    ),
    messages: [
      { role: 'user', content: `Case: ${input.caseTitle}\n\nDossier:\n${input.dossierMd}` },
      { role: 'user', content: `Claims available:\n${claimList(input.claims)}` },
      { role: 'user', content: `Outline it for roughly ${input.targetRuntimeMin} minutes.` },
    ],
    maxTokens: outputBudget(4000),
  }
}

/**
 * The outline as the model answered it, repaired before it is validated
 * (decision 296, in decision 293's mould): a beat over its limit is trimmed
 * at a sentence; a claim number listed by two chapters stays with the first
 * and the later listing is dropped, as is a number the claim list does not
 * have. Each repair is reported; none refuses the outline. `claimCount` is
 * the length of the list the prompt printed; without it any number is kept.
 */
export function parseOutline(
  text: string,
  note: Note = ignoreRepairs,
  claimCount?: number,
): Outline {
  const answer = parseJsonCompletion(text, LooseAnswer, 'outline')
  const parsed = OutlineSchema.safeParse(repairOutline(answer, note, claimCount))
  if (!parsed.success) {
    throw new ValidationError(
      `The model's outline did not match the expected shape: ${formatIssues(parsed.error)}`,
      { field: 'outline' },
    )
  }
  return parsed.data
}

function repairOutline(
  answer: Record<string, unknown>,
  note: Note,
  claimCount: number | undefined,
): unknown {
  const chapters = answer['chapters']
  if (!Array.isArray(chapters)) return answer
  // Claim number -> the 1-based chapter that listed it first.
  const owners = new Map<number, number>()
  // The opening chapter glimpses the moment the film returns to, so a claim
  // it lists that a later chapter also lists belongs to the later one:
  // claim number -> the first later chapter (1-based) that listed it.
  const glimpsed = new Map<number, number>()
  const opening = chapters[0]
  if (isRecord(opening) && Array.isArray(opening['claims'])) {
    const openingClaims = opening['claims']
    chapters.slice(1).forEach((later, offset) => {
      if (!isRecord(later) || !Array.isArray(later['claims'])) return
      for (const item of later['claims']) {
        if (typeof item === 'number' && openingClaims.includes(item) && !glimpsed.has(item)) {
          glimpsed.set(item, offset + 2)
        }
      }
    })
  }
  return {
    ...answer,
    chapters: chapters.map((chapter, at) => {
      if (!isRecord(chapter)) return chapter
      const label = `chapter ${at + 1}`
      const repaired: Record<string, unknown> = {
        ...chapter,
        beat: trimField(chapter['beat'], OUTLINE_BEAT_MAX, `${label}'s beat`, note),
      }
      if (Array.isArray(chapter['claims'])) {
        repaired['claims'] = dropItems(
          chapter['claims'],
          (item) => {
            if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) {
              return 'not a claim number'
            }
            if (claimCount !== undefined && item > claimCount) {
              return `the claim list ends at ${claimCount}`
            }
            const later = glimpsed.get(item)
            if (at === 0 && later !== undefined) {
              return `glimpsed in the opening; owned by chapter ${later}`
            }
            const owner = owners.get(item)
            if (owner !== undefined && owner !== at + 1) return `already owned by chapter ${owner}`
            owners.set(item, at + 1)
            return null
          },
          (item) => `${label}'s claim ${String(item)}`,
          note,
        )
      } else if (chapter['claims'] !== undefined) {
        // The schema would fold this in silence; the owner should know the
        // chapter was planned with claims the app could not read.
        note({
          action: 'dropped',
          field: `${label}'s claims`,
          reason: 'not a list of claim numbers',
        })
        delete repaired['claims']
      }
      return repaired
    }),
  }
}

// ---------------------------------------------------------------------------
// Chapter drafting
// ---------------------------------------------------------------------------

/**
 * The dramatic contract one chapter drafts under (decision 216), composed
 * from whatever tension fields the outline carries — an outline written
 * before the fields existed still drafts, just without the contract lines.
 */
export function tensionContract(outline: Outline, chapterIndex: number): string {
  const chapter = outline.chapters[chapterIndex]!
  const previous = chapterIndex > 0 ? outline.chapters[chapterIndex - 1] : undefined
  const lines: string[] = []

  if (outline.centralQuestion) {
    lines.push(
      `- The film's central question, answered only in the final chapter: ` +
        outline.centralQuestion,
    )
  }
  if (chapter.stakes) lines.push(`- At stake in this chapter: ${chapter.stakes}`)
  if (previous?.question) {
    lines.push(`- Answer the question the previous chapter left open: ${previous.question}`)
  }
  if (chapter.question) {
    lines.push(
      `- Plant this question early and do NOT answer it — the next chapter does: ` +
        chapter.question,
    )
  }
  if (chapter.withhold) {
    lines.push(
      `- Withhold entirely (a later chapter reveals it; walk to its edge and stop): ` +
        chapter.withhold,
    )
  }
  if (chapter.reveals) {
    lines.push(
      `- Reveal here, for the first time, what an earlier chapter withheld: ${chapter.reveals}`,
    )
  }
  if (chapter.constraints) {
    lines.push(
      `- Wording limits for this chapter. They shape the words and are never narrated as sentences, ` +
        `except where they ask for one in so many words: ${chapter.constraints}`,
    )
  }
  // The film's close (decision 299): the final chapter's last paragraphs, and
  // the one place the recap ban yields. Earlier chapters still end on a turn.
  const close = outline.close
  if (chapterIndex === outline.chapters.length - 1 && close) {
    const beats = [
      close.answer ? `Answer, as this channel's reading: ${close.answer}` : null,
      close.echo ? `Echo: ${close.echo}` : null,
      close.openThread ? `Open thread, the last line: ${close.openThread}` : null,
    ].filter((beat): beat is string => beat !== null)
    if (beats.length > 0) {
      lines.push(
        `- End the film with the close, as this chapter's last paragraphs, in this order. ` +
          `It says what the film thinks and closes the loop the opening chapter opened; it is ` +
          `never a recap of the chapters.\n  ${beats.join('\n  ')}`,
      )
    }
  }

  return lines.length > 0 ? `The tension contract for this chapter:\n${lines.join('\n')}` : ''
}

/**
 * Which claims this chapter narrates, which the listener has already heard,
 * and which are a later chapter's (decision 296). The numbers are the claim
 * list's, so the drafter needs no second list. Empty for an outline planned
 * before claims had homes: that script drafts as it did.
 */
export function ownershipBrief(
  outline: Outline,
  chapterIndex: number,
  /** The claim list's length, so the claims the outline placed nowhere can be named. */
  claimCount = 0,
): string {
  if (!outline.chapters.some((chapter) => (chapter.claims?.length ?? 0) > 0)) return ''
  const numbers = (chapters: readonly OutlineChapter[]) =>
    chapters.flatMap((chapter) => chapter.claims ?? [])
  const list = (claims: number[]) =>
    claims.length > 0 ? claims.map((claim) => `[${claim}]`).join(', ') : 'none'
  const own = outline.chapters[chapterIndex]?.claims ?? []
  const told = numbers(outline.chapters.slice(0, chapterIndex))
  const later = numbers(outline.chapters.slice(chapterIndex + 1))
  const placed = new Set(numbers(outline.chapters))
  const unplaced = Array.from({ length: claimCount }, (_, at) => at + 1).filter(
    (claim) => !placed.has(claim),
  )
  return [
    "Claim ownership for this chapter (the numbers are the claim list's):",
    `- Narrate in full, once, with attribution: ${list(own)}`,
    `- Already told in an earlier chapter. The listener remembers: refer back in a few words at most, ` +
      `repeating no figure, date or attribution: ${list(told)}`,
    `- Owned by a later chapter. A glimpse or a hint in a few words at most; ` +
      `that chapter tells them in full: ${list(later)}`,
    ...(unplaced.length > 0
      ? [
          `- Not placed by the outline. Free to any chapter that needs them, ` +
            `once in the film: ${list(unplaced)}`,
        ]
      : []),
  ].join('\n')
}

/**
 * Every chapter drafted so far, in full. The previous chapter's last two
 * sentences, which this replaced, told the drafter where to resume and
 * nothing about what had been said; it restated the ending and re-explained
 * the rest. A chapter is one voice take, so the words are exactly as stored.
 */
function scriptSoFar(
  previous: readonly { title: string; contentMd: string }[],
  bible: BibleInUse,
): string {
  if (previous.length === 0) return 'This is the opening chapter.'
  const text = previous
    .map((chapter, index) => `## ${index + 1}. ${chapter.title}\n\n${chapter.contentMd}`)
    .join('\n\n')
  return (
    `The script so far. The listener has just heard every word of it:\n\n${text}\n\n` +
    // Only the instruction is filled: the chapters above are narration, never a template.
    fillSlots(
      'Your first sentence moves the story forward. Never restate or paraphrase the ending ' +
        'above, and never re-introduce a person, [[example:script-subject-with-article]] or a figure it already introduced.',
      bible,
    )
  )
}

export function buildChapterRequest(input: {
  bible: BibleInUse
  caseTitle: string
  outline: Outline
  chapterIndex: number
  /** Every chapter drafted so far, in order, in full (decision 296). */
  previousChapters: readonly { title: string; contentMd: string }[]
  claims: readonly ScriptClaim[]
}): LLMTaskRequest {
  const chapter = input.outline.chapters[input.chapterIndex]!
  const outlineSummary = input.outline.chapters
    .map(
      (c, i) =>
        `${i + 1}. ${c.title}${c.storyline ? ` (${c.storyline})` : ''}` +
        `${i === input.chapterIndex ? '  <- writing this one' : ''}`,
    )
    .join('\n')
  const storylines = input.outline.storylines
    ? `Storylines: ${input.outline.storylines.join('; ')}\n\n`
    : ''
  const ownership = ownershipBrief(input.outline, input.chapterIndex, input.claims.length)
  const contract = tensionContract(input.outline, input.chapterIndex)

  return {
    task: 'scripting',
    system: fillSlots(
      `${houseStyle(input.bible.bible)}

${SCRIPT_CRAFT}${scriptRules(input.bible)}

Write ONE chapter of narration as plain prose paragraphs. No headings, no
bullet points, no lists — the words are read aloud exactly as written, and
the bracketed narration tags the house style describes are the one thing in
the text that is direction rather than words. Place them inline as you draft.

Target about ${chapter.targetWords} words.`,
      input.bible,
    ),
    messages: [
      // Stable across every chapter of the script, so it is the cacheable
      // prefix: the claim list is the largest part of this prompt and it does
      // not change between chapters.
      { role: 'user', content: `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` },
      { role: 'user', content: `${storylines}Full outline:\n${outlineSummary}` },
      { role: 'user', content: scriptSoFar(input.previousChapters, input.bible) },
      ...(ownership ? [{ role: 'user' as const, content: ownership }] : []),
      ...(contract ? [{ role: 'user' as const, content: contract }] : []),
      { role: 'user', content: `Write "${chapter.title}". It must: ${chapter.beat}` },
    ],
    cacheablePrefixMessages: 1,
    // A truncated chapter reads as a chapter that stops mid-sentence.
    maxTokens: outputBudget(Math.round(chapter.targetWords * 2.2)),
  }
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

export function buildSelfCheckRequest(input: {
  bible: BibleInUse
  chapterTitle: string
  contentMd: string
  claims: readonly ScriptClaim[]
}): LLMTaskRequest {
  return {
    task: 'editing',
    system: fillSlots(
      `You are checking documentary narration against the claim list it
was written from. You are not rewriting it.

The text may contain bracketed narration tags — [pause], [long pause],
[sighs] and the like: direction for the narrator, not words. Ignore them
entirely; never flag one and never quote one in a sentence.

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
 "refs": [{"claimId": string, "sentence": string}]}${scriptRules(input.bible)}`,
      input.bible,
    ),
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

/** The tension fields a Shorts marking can select by (decision 224). */
export interface ShortsTension {
  centralQuestion?: string | undefined
  chapters: readonly {
    index: number
    question?: string | undefined
    withhold?: string | undefined
  }[]
}

export function buildShortsRequest(input: {
  bible: BibleInUse
  chapters: readonly { index: number; title: string; contentMd: string }[]
  /** From the stored outline; absent for scripts written before it was kept. */
  tension?: ShortsTension
}): LLMTaskRequest {
  const tensionLines = input.tension
    ? [
        input.tension.centralQuestion
          ? `The whole film exists to answer: ${input.tension.centralQuestion}`
          : null,
        ...input.tension.chapters
          .filter((chapter) => chapter.question || chapter.withhold)
          .map(
            (chapter) =>
              `Chapter ${chapter.index}:` +
              (chapter.question ? ` drives on "${chapter.question}"` : '') +
              (chapter.withhold ? ` and withholds: ${chapter.withhold}` : ''),
          ),
      ].filter((line): line is string => line !== null)
    : []

  return {
    task: 'metadata',
    system: fillSlots(
      `Pick 4 segments from this script that would work as vertical
Shorts. A segment is 20-50 seconds of narration, roughly 50 to 125 words.

Each segment is a TEASER, not a summary. It funnels a scroller into the
full video, so:

- OPEN on the most arresting sentence available: a number that should not
  exist, a person doing something inexplicable, a flat contradiction. Never
  open on scene-setting or dates.
- END right BEFORE a reveal. The last sentence must sharpen a question, not
  answer one. If the chapter answers its question two sentences later, stop
  before those sentences.
- Never include the sentence that resolves the tension you opened with. A
  viewer who has the answer has no reason to click through.

Quote the first and last sentence of each segment EXACTLY as they appear.

{"candidates": [{"chapterIndex": number, "startSentence": string,
  "endSentence": string, "hookRationale": string}]}

Limits (the app checks them): at most ${SHORTS_CANDIDATES_MAX} candidates; "startSentence" and
"endSentence" at most ${SHORTS_SENTENCE_MAX} characters each; "hookRationale" at most
${SHORTS_HOOK_MAX} characters.${scriptRules(input.bible)}`,
      input.bible,
    ),
    messages: [
      {
        role: 'user',
        content: [
          tensionLines.length > 0
            ? `The questions each chapter drives on, and what it withholds — end segments
before these are answered:\n${tensionLines.join('\n')}\n`
            : null,
          input.chapters
            .map((c) => `## Chapter ${c.index} — ${c.title}\n\n${c.contentMd}`)
            .join('\n\n'),
        ]
          .filter((part): part is string => part !== null)
          .join('\n'),
      },
    ],
    maxTokens: outputBudget(3000),
  }
}

const LooseAnswer = z.looseObject({})

// Moved up from above `parseTeaser`, where Task 9 declared it: one
// declaration per module (a second `const isRecord` does not compile).
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Why a candidate's anchor sentences cannot be kept, or null when both fit. */
function anchorOverLimit(candidate: unknown): string | null {
  if (!isRecord(candidate)) return null
  for (const [key, what] of [
    ['startSentence', 'its start sentence'],
    ['endSentence', 'its end sentence'],
  ] as const) {
    const sentence = candidate[key]
    if (typeof sentence === 'string' && sentence.trim().length > SHORTS_SENTENCE_MAX) {
      return overLimit(what, SHORTS_SENTENCE_MAX)
    }
  }
  return null
}

/**
 * The marking as the model answered it, repaired before it is validated
 * (decision 293). A hook rationale over its limit is trimmed at a sentence. A
 * candidate whose start or end sentence runs over its limit is dropped and the
 * rest kept: those sentences are matched back to the chapter character for
 * character, so a cut one would anchor nowhere. More than ten keep the first
 * ten. Candidates are numbered as the model wrote them.
 */
function repairShortsCandidates(answer: Record<string, unknown>, note: Note): unknown {
  const candidates = answer['candidates']
  if (!Array.isArray(candidates)) return answer
  const trimmed = candidates.map((candidate, at) =>
    isRecord(candidate) && anchorOverLimit(candidate) === null
      ? {
          ...candidate,
          hookRationale: trimField(
            candidate['hookRationale'],
            SHORTS_HOOK_MAX,
            `candidate ${at + 1}'s hook`,
            note,
          ),
        }
      : candidate,
  )
  const kept = dropItems(trimmed, anchorOverLimit, (_, at) => `candidate ${at + 1}`, note)
  return {
    ...answer,
    candidates: capList(kept, SHORTS_CANDIDATES_MAX, 'Shorts candidates', note),
  }
}

export function parseShortsCandidates(text: string, note: Note = ignoreRepairs): ShortsCandidate[] {
  const answer = parseJsonCompletion(text, LooseAnswer, 'Shorts candidates')
  const parsed = ShortsCandidatesSchema.safeParse(repairShortsCandidates(answer, note))
  if (!parsed.success) {
    throw new ValidationError(
      `The model's Shorts candidates did not match the expected shape: ${formatIssues(parsed.error)}`,
      { field: 'Shorts candidates' },
    )
  }
  return parsed.data.candidates
}

// ---------------------------------------------------------------------------
// The teaser script (decision 225)
// ---------------------------------------------------------------------------

export function buildTeaserRequest(input: {
  bible: BibleInUse
  caseTitle: string
  chapters: readonly { index: number; title: string; contentMd: string }[]
  tension?: ShortsTension
}): LLMTaskRequest {
  const tensionBlock = input.tension
    ? [
        input.tension.centralQuestion
          ? `The film's central question, which the teaser must sharpen and NEVER answer: ${input.tension.centralQuestion}`
          : null,
        ...input.tension.chapters
          .filter((chapter) => chapter.withhold)
          .map((chapter) => `Chapter ${chapter.index} withholds: ${chapter.withhold}`),
      ].filter((line): line is string => line !== null)
    : []

  return {
    task: 'scripting',
    system: fillSlots(
      `Write a 25-40 second teaser narration (60-110 words total) for a
vertical Short that funnels viewers into the full video.

Structure, one paragraph per beat:
1. COLD OPEN: the single most arresting fact, mid-action, no preamble.
2-3. ESCALATION: one or two beats that raise what is at stake.
4. CLIFFHANGER: end on the sharpest open question. Do NOT answer it, and do
   not soften it with a summary.

Rules:
- Every fact must come from the script below. Invent nothing.
- Spoken register: short sentences, concrete nouns, numbers said plainly.
- No greetings, no "in this video", no channel talk. The end-card asks for
  the click; the words never do.
- Each paragraph carries the chapterIndex whose part of the story it draws
  from, so the edit can show that chapter's visuals behind it.

Limits (the app checks them): title ${TEASER_TITLE_MIN} to ${TEASER_TITLE_MAX} characters;
${TEASER_PARAGRAPHS_MIN} to ${TEASER_PARAGRAPHS_MAX} paragraphs, each ${TEASER_PARAGRAPH_MIN} to ${TEASER_PARAGRAPH_MAX} characters;
chapterIndex is the number of a chapter below, 0 to ${input.chapters.length - 1}.

Return exactly:
{"title": string, "paragraphs": [{"text": string, "chapterIndex": number}]}${scriptRules(input.bible)}`,
      input.bible,
    ),
    messages: [
      {
        role: 'user',
        content: [
          `Case: ${input.caseTitle}`,
          tensionBlock.length > 0 ? tensionBlock.join('\n') : null,
          input.chapters
            .map((c) => `## Chapter ${c.index} — ${c.title}\n\n${c.contentMd}`)
            .join('\n\n'),
        ]
          .filter((part): part is string => part !== null)
          .join('\n\n'),
      },
    ],
    maxTokens: outputBudget(1500),
  }
}

/**
 * The teaser as the model answered it, repaired before it is validated
 * (decision 293): the title trimmed at a word, each beat at a sentence, and
 * no more than five beats kept. A beat's chapter is a fact: one the film
 * does not have is refused, not dropped, because it would pull the wrong
 * chapter's visuals behind the words (spec 2.2).
 */
export function parseTeaser(
  text: string,
  chapterCount: number,
  note: Note = ignoreRepairs,
): TeaserScript {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'teaser script')
  const beats = capList(raw['paragraphs'], TEASER_PARAGRAPHS_MAX, 'beats', note)
  const parsed = TeaserScriptSchema.safeParse({
    ...raw,
    title: trimField(raw['title'], TEASER_TITLE_MAX, 'the title', note),
    paragraphs: Array.isArray(beats)
      ? beats.map((beat, index) =>
          isRecord(beat)
            ? {
                ...beat,
                text: trimField(beat['text'], TEASER_PARAGRAPH_MAX, `beat ${index + 1}`, note),
              }
            : beat,
        )
      : beats,
  })
  if (!parsed.success) {
    throw new ValidationError(`The teaser script is malformed: ${formatIssues(parsed.error)}`, {
      field: 'teaser script',
    })
  }
  const stray = parsed.data.paragraphs.findIndex(
    (paragraph) => paragraph.chapterIndex >= chapterCount,
  )
  if (stray !== -1) {
    throw new ValidationError(
      `beat ${stray + 1} draws from chapter ${parsed.data.paragraphs[stray]!.chapterIndex}, ` +
        `but the chapters run 0 to ${chapterCount - 1}`,
      { field: 'teaser script' },
    )
  }
  return parsed.data
}

/** Deterministic, so mock runs and the E2E suite get a stable teaser. */
export function mockTeaser(
  chapters: readonly { index: number; title: string; contentMd: string }[],
): TeaserScript {
  const first = chapters[0]
  const last = chapters[chapters.length - 1] ?? first
  return {
    title: `What really happened: ${(first?.title ?? 'the case').slice(0, 60)}`,
    paragraphs: [
      {
        text: 'MOCK TEASER — this narration is a stand-in and must never be published.',
        chapterIndex: first?.index ?? 0,
      },
      {
        text: 'It escalates through the middle of the story without giving anything away.',
        chapterIndex: last?.index ?? 0,
      },
      {
        text: 'And it ends on the question the full video answers. What happened to the money?',
        chapterIndex: last?.index ?? 0,
      },
    ],
  }
}

/** The marking-relevant slice of an outline, shaped for `buildShortsRequest`. */
export function tensionFromOutline(outline: Outline): ShortsTension {
  return {
    centralQuestion: outline.centralQuestion,
    chapters: outline.chapters.map((chapter, index) => ({
      index,
      question: chapter.question,
      withhold: chapter.withhold,
    })),
  }
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

export function mockOutline(targetRuntimeMin: number): Outline {
  const chapters = Math.max(2, Math.min(8, Math.round(targetRuntimeMin / 3)))
  const storylines = ['Mock storyline: the money', 'Mock storyline: the courts']

  return {
    centralQuestion: 'Mock central question — no provider designed an arc.',
    storylines,
    close: {
      answer: 'Mock answer to the central question.',
      echo: 'Mock echo of the opening.',
      openThread: 'Mock open thread.',
    },
    chapters: Array.from({ length: chapters }, (_, index) => ({
      title: `[mock] Chapter ${index + 1}`,
      beat: 'Placeholder beat produced in mock mode. Nothing was written by a provider.',
      storyline: storylines[index % 2]!,
      // Mock runs own no claims: the ownership brief is exercised by unit tests.
      claims: [],
      question: `Mock open question ${index + 1}`,
      withhold: `Mock withheld fact ${index + 1}`,
      ...(index > 0 ? { reveals: `Mock withheld fact ${index}` } : {}),
      stakes: `Mock stakes ${index + 1}`,
      constraints: 'Mock constraints: attribute every figure.',
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
  bible: BibleInUse
  chapterTitle: string
  contentMd: string
  selection: string
  note: string
  claims: readonly ScriptClaim[]
}): LLMTaskRequest {
  return {
    task: 'editing',
    system: fillSlots(
      `${houseStyle(input.bible.bible)}

${SCRIPT_CRAFT}${scriptRules(input.bible)}

You are rewriting ONE passage of an existing chapter.

Return ONLY the rewritten passage as plain prose. No preamble, no quotes
around it, no explanation, no markdown fences. It is spliced back into the
chapter exactly as you return it.

Keep roughly the same length unless the instruction says otherwise.`,
      input.bible,
    ),
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
