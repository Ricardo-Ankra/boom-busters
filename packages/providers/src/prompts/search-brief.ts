import { AngleOptionSchema, ValidationError } from '@boom-busters/schemas'
import type { AngleOption, BibleInUse, SearchKeyword, SearchOutlier } from '@boom-busters/schemas'
import { z } from 'zod'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
import { parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'

/**
 * The three model steps of a search brief (spec 6.2 steps 1, 5 and 6): which
 * measured keywords belong to the subject, what the winning videos' titles
 * have in common, and two or three angles to choose between.
 *
 * Anti-goal (spec 4): the model writes directions, never facts. Title
 * patterns carry `{subject}` and `{figure}` in place of names and numbers,
 * and an angle may state no figure the inputs do not carry.
 */

const Envelope = z.looseObject({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

// ---------------------------------------------------------------------------
// Step 1, the keyword filter
// ---------------------------------------------------------------------------

const FILTER_SYSTEM = `You filter measured YouTube search keywords for one subject.

You are given the subject and a list of keywords that were measured for it.
Keep a keyword only when a viewer typing it would be looking for videos about
THIS subject. Drop keywords about a different subject that shares a word, and
keywords with no clear link to the subject.

Rules:
- Copy each kept keyword exactly as listed. Never add, reword or invent one.
- Keep the order of the list.

Answer with JSON only, no prose around it:
{"keep": [string]}`

export function buildKeywordFilterRequest(input: {
  subject: string
  rows: readonly SearchKeyword[]
}): LLMTaskRequest {
  const list = input.rows.map((row) => `- ${row.keyword}`).join('\n')
  return {
    task: 'research',
    system: FILTER_SYSTEM,
    messages: [{ role: 'user', content: `Subject: ${input.subject}\n\nKeywords:\n${list}` }],
    maxTokens: outputBudget(40 * input.rows.length + 200),
  }
}

/**
 * The kept keywords, each one of `rows`. A keyword that is not in the list is
 * dropped with a note; an answer naming only unknown keywords is refused so
 * the helper asks again.
 */
export function parseKeywordFilter(
  text: string,
  rows: readonly SearchKeyword[],
  note: Note = ignoreRepairs,
): string[] {
  const raw = parseJsonCompletion(text, Envelope, 'keyword filter')
  const keep = raw['keep']
  if (!Array.isArray(keep)) {
    throw new ValidationError('The keyword filter has no "keep" list', { field: 'keyword filter' })
  }
  const known = new Map(rows.map((row) => [row.keyword.toLowerCase(), row.keyword]))
  const kept: string[] = []
  let unknown = 0
  keep.forEach((item: unknown, index) => {
    const match = typeof item === 'string' ? known.get(item.trim().toLowerCase()) : undefined
    if (match === undefined) {
      unknown += 1
      note({
        action: 'dropped',
        field: `keyword ${index + 1} ("${String(item).slice(0, 60)}")`,
        reason: 'it is not one of the measured keywords',
      })
    } else if (!kept.includes(match)) kept.push(match)
  })
  if (kept.length === 0 && unknown > 0) {
    throw new ValidationError('The keyword filter kept only keywords that were not listed', {
      field: 'keyword filter',
    })
  }
  return kept
}

export function mockKeywordFilter(rows: readonly SearchKeyword[]): string[] {
  return rows.slice(0, 5).map((row) => row.keyword)
}

// ---------------------------------------------------------------------------
// Step 5, the winners
// ---------------------------------------------------------------------------

export const WINNER_PATTERNS_MAX = 6
export const WINNER_TOLD_MAX = 10
const DESCRIPTION_CHARS = 400

const WINNERS_SYSTEM = `You study the winning videos in one subject's search space.

You are given the subject and its outliers: videos that far outperformed their
channel. Each has a title, its channel, its tags and the start of its description.

Do two things:
1. \`titlePatterns\`: what the winning titles have in common, as reusable title
   patterns. A pattern uses {subject} where the subject's name goes and {figure}
   where a number or amount goes. A pattern never contains a digit, a real name
   or a real amount.
2. \`toldAlready\`: the beats and angles these videos already cover, each in a
   few plain words of your own, so a new video can avoid retelling them. Take
   them only from the titles and descriptions given.

Rules:
- At most ${WINNER_PATTERNS_MAX} patterns and ${WINNER_TOLD_MAX} told-already entries.
- Never invent a video, a channel or a fact that the input does not give.

Answer with JSON only, no prose around it:
{"titlePatterns": [string], "toldAlready": [string]}`

export function buildWinnersRequest(input: {
  subject: string
  outliers: readonly SearchOutlier[]
  descriptions: Record<string, string>
}): LLMTaskRequest {
  const blocks = input.outliers.map((outlier, index) => {
    const description = (input.descriptions[outlier.videoId] ?? '')
      .trim()
      .slice(0, DESCRIPTION_CHARS)
    return [
      `${index + 1}. ${JSON.stringify(outlier.title)}`,
      `   channel: ${outlier.channel ?? 'unknown'}`,
      `   tags: ${outlier.tags.join(', ') || 'none'}`,
      `   description: ${description || 'none'}`,
    ].join('\n')
  })
  return {
    task: 'research',
    system: WINNERS_SYSTEM,
    messages: [
      { role: 'user', content: `Subject: ${input.subject}\n\nOutliers:\n${blocks.join('\n\n')}` },
    ],
    maxTokens: outputBudget(1_200),
  }
}

export interface Winners {
  titlePatterns: string[]
  toldAlready: string[]
}

/**
 * A pattern with a raw digit is dropped, since a digit is a fact the pattern
 * is meant to leave to `{figure}`. No pattern left is refused.
 */
export function parseWinners(text: string, note: Note = ignoreRepairs): Winners {
  const raw = parseJsonCompletion(text, Envelope, 'winning-video patterns')
  if (!Array.isArray(raw['titlePatterns'])) {
    throw new ValidationError('The winning-video patterns have no "titlePatterns" list', {
      field: 'winning-video patterns',
    })
  }
  const patterns = capList(
    dropItems(
      raw['titlePatterns'],
      (item) =>
        typeof item !== 'string' || item.trim() === ''
          ? 'it is not text'
          : /\d/.test(item)
            ? 'it holds a digit, and a pattern leaves figures to {figure}'
            : null,
      (item, index) => `title pattern ${index + 1} ("${String(item).slice(0, 60)}")`,
      note,
    ),
    WINNER_PATTERNS_MAX,
    'title patterns',
    note,
  )
  const titlePatterns = strings(patterns).map((p) => p.trim())
  if (titlePatterns.length === 0) {
    throw new ValidationError('No usable title pattern was left', {
      field: 'winning-video patterns',
    })
  }
  const told = strings(capList(raw['toldAlready'], WINNER_TOLD_MAX, 'told-already entries', note))
  return { titlePatterns, toldAlready: told.map((t) => t.trim()).filter((t) => t !== '') }
}

export function mockWinners(): Winners {
  return {
    titlePatterns: [
      'The Rise and Fall of {subject}',
      'From {figure} to Nothing: How {subject} Lost Everything',
    ],
    toldAlready: ['the founder rise and the failed listing', 'the collapse of the lease model'],
  }
}

// ---------------------------------------------------------------------------
// Step 6, the angle options
// ---------------------------------------------------------------------------

export const ANGLE_OPTIONS_MIN = 2
export const ANGLE_OPTIONS_MAX = 3

export interface AngleOptionsInput {
  bible: BibleInUse
  subject: string
  angleIdea: string | null
  targetKeyword: string | null
  secondaryKeywords: readonly string[]
  searchedQuestions: readonly string[]
  toldAlready: readonly string[]
}

const angleSystem = (input: AngleOptionsInput): string => {
  const idea = input.angleIdea?.trim()
    ? "\n- The first option develops the owner's idea, given below. The others are your own."
    : ''
  return `You propose angles for a YouTube video on a given subject. The channel covers
${input.bible.bible.subject}, for ${input.bible.bible.audience}.

An angle is a direction for the telling, not a set of facts: what THIS video
does that the videos already made do not, and which searched question it
answers.

Rules:
- Propose ${ANGLE_OPTIONS_MIN} or ${ANGLE_OPTIONS_MAX} options that differ in direction.${idea}
- Never state a figure, date or count in an angle. Write the direction, and let the research supply the numbers.
- \`keyword\` is the target or a secondary keyword the angle serves, copied exactly.
- \`answers\` are searched questions from the list this angle answers, copied exactly, at most 5.
- \`gap\` is what the videos already made leave open, in one sentence.

Limits (the app checks them): angle 20 to 400 characters; gap at most 300 characters.

Answer with JSON only, no prose around it:
{"options": [{"angle": string, "keyword": string, "answers": [string], "gap": string}]}`
}

export function buildAngleOptionsRequest(input: AngleOptionsInput): LLMTaskRequest {
  const list = (title: string, items: readonly string[]): string =>
    `${title}:\n${items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- none'}`
  const idea = input.angleIdea?.trim()
  return {
    task: 'research',
    system: angleSystem(input),
    messages: [
      {
        role: 'user',
        content: [
          `Subject: ${input.subject}`,
          idea ? `Owner's angle idea: ${idea}` : null,
          `Target keyword: ${input.targetKeyword ?? 'none'}`,
          list('Secondary keywords', input.secondaryKeywords),
          list('Searched questions', input.searchedQuestions),
          list('Already told by existing videos', input.toldAlready),
        ]
          .filter((part): part is string => part !== null)
          .join('\n\n'),
      },
    ],
    maxTokens: outputBudget(1_000),
  }
}

const digitRuns = (text: string): string[] => text.match(/\d+/g) ?? []

/**
 * Two or three angle options. An option is dropped when it breaks a limit or
 * states a digit that no input carries (anti-goal: directions, not facts); more
 * than three are cut to three; fewer than two usable is refused for a retry.
 */
export function parseAngleOptions(
  text: string,
  input: AngleOptionsInput,
  note: Note = ignoreRepairs,
): AngleOption[] {
  const raw = parseJsonCompletion(text, Envelope, 'angle options')
  if (!Array.isArray(raw['options'])) {
    throw new ValidationError('The angle options have no "options" list', {
      field: 'angle options',
    })
  }
  const given = new Set(
    digitRuns(
      [
        input.subject,
        input.angleIdea ?? '',
        input.targetKeyword ?? '',
        ...input.secondaryKeywords,
        ...input.searchedQuestions,
        ...input.toldAlready,
      ].join('\n'),
    ),
  )
  const valid: AngleOption[] = []
  raw['options'].forEach((item: unknown, index) => {
    const label = `angle option ${index + 1}`
    if (!isRecord(item)) {
      note({ action: 'dropped', field: label, reason: 'it is not an object' })
      return
    }
    const parsed = AngleOptionSchema.safeParse({
      ...item,
      angle: typeof item['angle'] === 'string' ? item['angle'].trim() : item['angle'],
      answers: capList(item['answers'], 5, `answers of ${label}`, note),
      gap: trimField(item['gap'], 300, `the gap of ${label}`, note),
    })
    if (!parsed.success) {
      note({ action: 'dropped', field: label, reason: 'it breaks the limits' })
      return
    }
    if (digitRuns(parsed.data.angle).some((run) => !given.has(run))) {
      note({ action: 'dropped', field: label, reason: 'it states a figure that no input carries' })
      return
    }
    valid.push(parsed.data)
  })
  if (valid.length < ANGLE_OPTIONS_MIN) {
    throw new ValidationError(
      `Only ${valid.length} usable angle option(s); ${ANGLE_OPTIONS_MIN} to ${ANGLE_OPTIONS_MAX} are needed`,
      { field: 'angle options' },
    )
  }
  return capList(valid, ANGLE_OPTIONS_MAX, 'angle options', note) as AngleOption[]
}

export function mockAngleOptions(input: AngleOptionsInput): AngleOption[] {
  const keyword = input.targetKeyword ?? input.subject.toLowerCase()
  const idea = input.angleIdea?.trim()
  const question = input.searchedQuestions[0]
  return [
    {
      angle: idea
        ? `Develop the owner's idea: ${idea}`
        : `Follow the money behind ${input.subject}, from the first promise to the last filing.`,
      keyword,
      answers: question ? [question] : [],
      gap: 'Existing videos tell the rise and fall but skip how the numbers were built.',
    },
    {
      angle: `The people inside ${input.subject} and what each of them was told along the way.`,
      keyword,
      answers: [],
      gap: 'Existing videos centre the founder and leave the rest of the cast out.',
    },
  ]
}
