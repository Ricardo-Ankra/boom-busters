import {
  CHAPTER_GLOSS_MAX,
  HASHTAGS_MAX,
  stripNarrationMarkup,
  ValidationError,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { parseJsonCompletion } from './json'
import { capList, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
import { claimList } from './script'
import type { ScriptClaim } from './script'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The 'metadata' task (build spec sections 7 and 11.3): candidate YouTube
 * titles for one publish item, offered on the Publish screen as a radio list
 * beside a free-edit field. Haiku-tier work by default — the routing matrix
 * decides, this file only shapes the request.
 *
 * Only titles are generated. The description is composed deterministically
 * from things that already exist (hook paragraph, chapter timestamps, dossier
 * sources, disclaimer — see `composeDescription` in schemas): asking a
 * model to restate facts that are already on file is how a description ends
 * up contradicting the video it sits under.
 */

/** How many candidates the screen asks for. Spec: "the 8-10 generated options". */
export const TITLE_OPTION_COUNT = 8

/** YouTube truncates at 100; anything longer would publish less than shown. */
const TITLE_MAX_CHARS = 100

export function buildTitlesRequest(input: {
  caseTitle: string
  /** The hook the title has to live up to — the script's opening paragraph. */
  hook: string
  target: 'master' | 'short'
  /** The working title, offered to the model as the angle already chosen. */
  workingTitle: string
  /**
   * The facts a title may use (decision 301). The working title is the
   * project's pitch, which can carry a figure the research did not support
   * (production: "$270M in 18 Months"), so the claims are the only source of
   * figures, dates and names.
   */
  claims?: readonly ScriptClaim[]
  /** The outline's central question: the film's real angle. */
  centralQuestion?: string
}): LLMTaskRequest {
  const shape = `Return JSON: {"titles": ["...", ...]} — exactly ${TITLE_OPTION_COUNT} strings.`

  return {
    task: 'metadata',
    system: `You write YouTube titles for Boom & Busters, a documentary channel
about corporate collapses, cons and meltdowns. Sober, specific, curiosity-driven —
never clickbait that the video cannot pay off, never ALL CAPS, no emoji.

${shape}

Rules:
- Every figure, date and name in a title must appear in the claim list below.
  The case and working title are an early pitch and may carry figures the
  research did not support; never repeat a figure from them that the claims
  do not carry.
- Each title is at most ${TITLE_MAX_CHARS} characters and at least 20.
- Name the company or person; a title that could sit on any video is a bad title.
- Vary the mechanism across the set: a question, a number, a timeline
  ("Nine days"), a contradiction, a consequence. No two titles may share
  their first three words.
${
  input.target === 'short'
    ? '- These are for a vertical Short cut from the full video: punchier, front-loaded, the payoff visible in the first five words.'
    : '- These are for the full documentary: they can breathe, but the stakes must be in the first half.'
}`,
    messages: [
      {
        role: 'user',
        content:
          `Case: ${input.caseTitle}\n` +
          `Working title: ${input.workingTitle}\n\n` +
          `Opening hook:\n${input.hook}`,
      },
      ...(input.centralQuestion
        ? [{ role: 'user' as const, content: `The film's question: ${input.centralQuestion}` }]
        : []),
      { role: 'user', content: `Claims:\n${claimList(input.claims ?? [])}` },
    ],
    maxTokens: outputBudget(1000),
  }
}

// ---------------------------------------------------------------------------
// The search description (decision 301)
// ---------------------------------------------------------------------------

/** How long the written opening may run before it is trimmed at a sentence. */
export const DESCRIPTION_BODY_MAX = 1200

/** YouTube's tag field: 500 characters across every tag, commas included. */
const TAGS_TOTAL_MAX = 500
const TAGS_COUNT_MAX = 15

/** How much of each chapter the description writer reads. */
const CHAPTER_EXCERPT_MAX = 600

export interface DescriptionAnswer {
  body: string
  /** One per chapter, in order; an empty string is a chapter left unglossed. */
  chapterGlosses: string[]
  hashtags: string[]
  tags: string[]
}

/**
 * The search description (decision 301): the opening paragraphs, a gloss per
 * chapter, three hashtags and the tag list, written for the words people
 * search, from the claim list and the film itself. The pitch title is never
 * sent: it is where an unsourced figure lives.
 */
export function buildDescriptionRequest(input: {
  target: 'master' | 'short'
  claims: readonly ScriptClaim[]
  centralQuestion?: string
  /** The master's chapters in order, with their narration. Empty for a Short. */
  chapters: readonly { title: string; text: string }[]
  /** What a Short narrates, for a Short. */
  shortText?: string
}): LLMTaskRequest {
  const glossCount = input.target === 'master' ? input.chapters.length : 0
  const excerpt = (text: string) => {
    const spoken = stripNarrationMarkup(text).replace(/\s+/g, ' ').trim()
    return spoken.length > CHAPTER_EXCERPT_MAX
      ? `${spoken.slice(0, CHAPTER_EXCERPT_MAX)}...`
      : spoken
  }

  return {
    task: 'metadata',
    system: `You write YouTube descriptions for Boom & Busters, a documentary
channel about corporate collapses, cons and meltdowns. The description is read
by search and by people deciding whether to watch, so it says plainly who and
what the film is about, in the words people search for.

Return JSON: {"body": string, "chapterGlosses": [string], "hashtags": [string], "tags": [string]}

Rules:
- Assert nothing the claim list does not support. Where a claim is NOT
  adjudicated, write "alleged", "reportedly" or "according to". Never invent
  figures, dates, quotes or names.
- ${
      input.target === 'master'
        ? `"body" is two short paragraphs. The first sentence names the company, its
  best-known product and what happened, with the figures that matter. The
  second paragraph says what the film covers, in the order it covers it.`
        : `"body" is one or two sentences for a vertical Short. The first sentence
  names the company, its best-known product and what happened. Then say the
  full documentary is on the channel.`
    }
- No "in this video", no channel talk, no emoji, no ALL CAPS, no em dashes.
- "chapterGlosses": exactly ${glossCount} strings, one per chapter in order, each
  at most ${CHAPTER_GLOSS_MAX} characters, saying plainly what the chapter is
  about (a name, an event, a date) rather than repeating its title.
- "hashtags": exactly ${HASHTAGS_MAX}, each one word with no spaces, the company
  first.
- "tags": 8 to ${TAGS_COUNT_MAX} search phrases, each under 30 characters: the
  company, the product, the people, the events, the topic.`,
    messages: [
      { role: 'user', content: `Claims:\n${claimList(input.claims)}` },
      {
        role: 'user',
        content: [
          input.centralQuestion ? `The film's question: ${input.centralQuestion}` : null,
          input.chapters.length > 0
            ? `Chapters:\n${input.chapters
                .map((chapter, index) => `${index + 1}. ${chapter.title}\n${excerpt(chapter.text)}`)
                .join('\n\n')}`
            : null,
          input.shortText ? `What the Short says:\n${excerpt(input.shortText)}` : null,
        ]
          .filter((part): part is string => part !== null)
          .join('\n\n'),
      },
    ],
    maxTokens: outputBudget(1500),
  }
}

const LooseDescription = z.looseObject({})

/**
 * The description as the model answered it, repaired before it is used
 * (decision 293's mould): the opening trimmed at a sentence, each gloss at a
 * word, the glosses fitted to the chapters, hashtags made one word and capped
 * at three, tags kept inside YouTube's 500 characters. Only an answer with no
 * opening at all is refused.
 */
export function parseDescriptionAnswer(
  text: string,
  chapterCount: number,
  note: Note = ignoreRepairs,
): DescriptionAnswer {
  const raw = parseJsonCompletion(text, LooseDescription, 'description')
  const written = typeof raw['body'] === 'string' ? raw['body'].trim() : ''
  if (written === '') {
    throw new ValidationError('The description came back with no opening.', {
      field: 'description',
    })
  }
  // Repairs are noted in reading order: the opening, then the chapters.
  const body = String(trimField(written, DESCRIPTION_BODY_MAX, 'the opening', note))

  const glossesIn = Array.isArray(raw['chapterGlosses']) ? raw['chapterGlosses'] : []
  const capped = capList(glossesIn, chapterCount, 'chapter glosses', note) as unknown[]
  const chapterGlosses = Array.from({ length: chapterCount }, (_, index) => {
    const gloss = capped[index]
    if (typeof gloss !== 'string') return ''
    return String(trimField(gloss.trim(), CHAPTER_GLOSS_MAX, `chapter ${index + 1}'s gloss`, note))
  })

  const hashtags = [
    ...new Set(
      (Array.isArray(raw['hashtags']) ? raw['hashtags'] : [])
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
        .filter((tag) => tag !== '')
        .map((tag) => `#${tag}`),
    ),
  ].slice(0, HASHTAGS_MAX)

  const tags: string[] = []
  const seen = new Set<string>()
  for (const tag of Array.isArray(raw['tags']) ? raw['tags'] : []) {
    if (typeof tag !== 'string') continue
    const clean = tag.trim()
    if (clean === '' || clean.length > 100 || seen.has(clean.toLowerCase())) continue
    if ([...tags, clean].join(',').length > TAGS_TOTAL_MAX || tags.length >= TAGS_COUNT_MAX) break
    seen.add(clean.toLowerCase())
    tags.push(clean)
  }

  return { body, chapterGlosses, hashtags, tags }
}

/** Obviously mock, so it is never pasted anywhere real. */
export function mockDescription(chapterCount: number): DescriptionAnswer {
  return {
    body: '[mock] A search description written without a provider. Nothing here was checked against the claims.',
    chapterGlosses: Array.from({ length: chapterCount }, (_, i) => `[mock] chapter ${i + 1}`),
    hashtags: ['#MockOne', '#MockTwo', '#MockThree'],
    tags: ['mock tag one', 'mock tag two'],
  }
}

const TitlesEnvelopeSchema = z.object({
  titles: z.array(z.string()).min(1, 'at least one title'),
})

/**
 * Candidates out of a completion: trimmed, deduplicated, length-enforced,
 * capped. Lenient item-by-item like the shot list — one overlong title is
 * dropped, not retried at full price — but an answer with nothing usable in
 * it throws, so the retry buys a genuinely fresh set.
 */
export function parseTitleOptions(text: string): string[] {
  const envelope = parseJsonCompletion(text, TitlesEnvelopeSchema, 'title options')

  const seen = new Set<string>()
  const titles: string[] = []
  for (const raw of envelope.titles) {
    // "1. Title" or "\"Title\"" — list habits some models keep even in JSON.
    const title = raw
      .trim()
      .replace(/^\d+[.)]\s*/, '')
      .replace(/^"(.*)"$/, '$1')
      .trim()
    if (title.length === 0 || title.length > TITLE_MAX_CHARS) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(title)
    if (titles.length === 10) break
  }

  if (titles.length === 0) {
    throw new ValidationError(
      "Every title in the model's answer was unusable — empty or over " +
        `${TITLE_MAX_CHARS} characters.`,
      { field: 'title options' },
    )
  }

  return titles
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/**
 * Mock titles, obviously mock (same rule as every other mock: output that
 * looks real gets pasted somewhere real). Deterministic — a pure function of
 * the working title — and varied enough to exercise the radio list.
 */
export function mockTitleOptions(workingTitle: string): string[] {
  // Cut so the longest template stays inside the 100-character title limit.
  const stem = workingTitle.trim().slice(0, 48) || 'Untitled'
  return [
    `[mock] ${stem} — the whole story`,
    `[mock] How ${stem} actually happened`,
    `[mock] ${stem}: nine days from record high to nothing`,
    `[mock] The number that gave ${stem} away`,
    `[mock] What ${stem} cost everyone else`,
    `[mock] ${stem}, minute by minute`,
    `[mock] Why nobody stopped ${stem}`,
    `[mock] ${stem}: the warning signs were public`,
  ]
}
