import {
  CASE_ANGLE_MAX,
  CASE_ANGLE_MIN,
  CASE_DEMAND_NOTES_MAX,
  CASE_LINK_NOTE_MAX,
  CASE_LINKS_MAX,
  CASE_PEOPLE_MAX,
  CASE_PRIORITY_MAX,
  CASE_PRIORITY_MIN,
  CASE_SUBJECT_MAX,
  CASE_SUBJECT_MIN,
  CASE_SUGGESTIONS_MAX,
  CASE_TITLE_MAX,
  CASE_TITLE_MIN,
  CaseSuggestionsSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { CaseSuggestion } from '@boom-busters/schemas'
import { z } from 'zod'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, overLimit, trimField, trimText } from './repair'
import type { Note, Repair } from './repair'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The `Suggest cases` prompt (spec section 11.3).
 *
 * Routed at the `research` task, so it uses whatever Settings → Models points
 * research at. The alternative was adding a seventh task to the routing
 * matrix, but section 4 fixes the six, and proposing real cases with demand
 * evidence is research work by any reading.
 */

export interface SuggestCasesInput {
  /** Titles already in the library, so the model does not re-propose them. */
  existingTitles: readonly string[]
  count: number
  /** Optional steer from the human: "1990s", "aviation", "nothing US-centric". */
  steer?: string
}

const SYSTEM = `You propose case studies for a YouTube channel about corporate
collapses, frauds, meltdowns and turnarounds.

A good case has: a documented paper trail (court filings, regulator actions,
major-outlet reporting), a clear turn where the story changes, and consequences
that can be shown rather than described. A bad case is one where the only
sources are other YouTube videos, or where the interesting part is speculation
about what someone was thinking.

Rules:
- Only real, documented events. Never invent a company, a person or a figure.
- Prefer cases with primary sources available: filings, judgments, inquiries.
- \`title\` is a working title: the company and the turn in plain words, no verdicts, no questions, no colon-and-subtitle; the hook belongs to \`angle\`.
- \`subject\` is the company's common name as Wikipedia titles it, nothing else; \`people\` are the main people, at most ${CASE_PEOPLE_MAX}, full names.
- The angle must say what THIS telling does that existing coverage does not.
- priorityScore is 0-100: how strongly you would recommend making it next,
  weighing documentation quality, story shape and evident audience demand.

Limits (the app checks them): title ${CASE_TITLE_MIN} to ${CASE_TITLE_MAX} characters; angle
${CASE_ANGLE_MIN} to ${CASE_ANGLE_MAX} characters; demandNotes at most ${CASE_DEMAND_NOTES_MAX} characters;
at most ${CASE_LINKS_MAX} competitorLinks, each note at most ${CASE_LINK_NOTE_MAX} characters;
priorityScore a whole number from ${CASE_PRIORITY_MIN} to ${CASE_PRIORITY_MAX}; no more cases than asked for.
subject ${CASE_SUBJECT_MIN} to ${CASE_SUBJECT_MAX} characters.

Answer with JSON only, no prose around it:
{"suggestions": [{"title": string, "category": "collapse"|"con"|"meltdown"|"turnaround"|"empire",
  "angle": string, "demandNotes": string, "competitorLinks": [{"url": string, "note": string}],
  "priorityScore": number, "subject": string, "people": [string]}]}`

export function buildSuggestCasesRequest(input: SuggestCasesInput): LLMTaskRequest {
  const avoid =
    input.existingTitles.length > 0
      ? `\n\nAlready in the library — do not propose these again:\n${input.existingTitles
          .map((title) => `- ${title}`)
          .join('\n')}`
      : ''

  const steer = input.steer?.trim()
    ? `\n\nThe human asks specifically for: ${input.steer.trim()}`
    : ''

  return {
    task: 'research',
    system: SYSTEM,
    messages: [{ role: 'user', content: `Propose ${input.count} cases.${steer}${avoid}` }],
    maxTokens: outputBudget(900 * input.count),
  }
}

const Envelope = z.looseObject({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * How a repair names the suggestion it changed (decision 293): "the angle of
 * Wirecard". The Case Library files each repair on its case's row by this
 * ending (`fileCaseRepairs`).
 */
const ofCase = (what: string, title: unknown): string => `${what} of ${String(title)}`

/** A title over its limit is not trimmed: it is the case's name and the dedupe key. */
function titleOverLimit(item: unknown): string | null {
  return isRecord(item) &&
    typeof item['title'] === 'string' &&
    item['title'].length > CASE_TITLE_MAX
    ? overLimit('its title', CASE_TITLE_MAX)
    : null
}

/** A dropped suggestion has no row, so the toast names it by its place and opening words. */
function droppedLabel(item: unknown, index: number): string {
  const title = isRecord(item) && typeof item['title'] === 'string' ? item['title'] : ''
  return `suggestion ${index + 1} ("${trimText(title, 60)}...")`
}

/**
 * The model's own rating, not a fact from the world (spec 2.2): a fraction
 * is rounded and the scale's ends hold. Anything but a number is left for
 * the schema to refuse.
 */
function fitPriority(value: unknown, title: unknown, note: Note): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value
  const fitted = Math.min(CASE_PRIORITY_MAX, Math.max(CASE_PRIORITY_MIN, Math.round(value)))
  if (fitted !== value) {
    note({ action: 'rounded', field: ofCase('the priority score', title), from: value, to: fitted })
  }
  return fitted
}

/** One suggestion's free text trimmed, its links capped and its score fitted; facts untouched. */
function repairSuggestion(item: unknown, note: Note): unknown {
  if (!isRecord(item)) return item
  const title = item['title']
  const links = capList(
    item['competitorLinks'],
    CASE_LINKS_MAX,
    ofCase('competitor links', title),
    note,
  )
  return {
    ...item,
    angle: trimField(item['angle'], CASE_ANGLE_MAX, ofCase('the angle', title), note),
    demandNotes: trimField(
      item['demandNotes'],
      CASE_DEMAND_NOTES_MAX,
      ofCase('the demand notes', title),
      note,
    ),
    competitorLinks: Array.isArray(links)
      ? links.map((link, index) =>
          isRecord(link)
            ? {
                ...link,
                note: trimField(
                  link['note'],
                  CASE_LINK_NOTE_MAX,
                  ofCase(`the note on link ${index + 1}`, title),
                  note,
                ),
              }
            : link,
        )
      : links,
    priorityScore: fitPriority(item['priorityScore'], title, note),
    subject: trimField(item['subject'], CASE_SUBJECT_MAX, ofCase('the subject', title), note),
    ...(item['people'] === undefined
      ? {}
      : { people: capList(item['people'], CASE_PEOPLE_MAX, ofCase('people', title), note) }),
  }
}

/**
 * The suggestions as the model answered them, repaired before they are
 * validated (decision 293): a suggestion whose title runs over its limit is
 * dropped and the rest kept; no more than `count` are kept; the free text is
 * trimmed at a sentence, the links capped and the priority score fitted to
 * the scale. Titles, categories and link addresses are facts, left alone.
 */
export function parseSuggestedCases(
  text: string,
  count: number = CASE_SUGGESTIONS_MAX,
  note: Note = ignoreRepairs,
): CaseSuggestion[] {
  const raw = parseJsonCompletion(text, Envelope, 'case suggestions')
  const kept = dropItems(raw['suggestions'], titleOverLimit, droppedLabel, note)
  const capped = capList(kept, count, 'suggestions', note)
  const parsed = CaseSuggestionsSchema.safeParse({
    ...raw,
    suggestions: Array.isArray(capped)
      ? capped.map((item) => repairSuggestion(item, note))
      : capped,
  })
  if (!parsed.success) {
    throw new ValidationError(`The case suggestions are malformed: ${formatIssues(parsed.error)}`, {
      field: 'case suggestions',
    })
  }
  return parsed.data.suggestions
}

/**
 * One answer's repairs split by the case each concerns (decision 293), so
 * the Case Library can file each on its case's row. A repair to a suggestion
 * ends "of <its title>", and the longest title that fits wins: "the angle of
 * Bank of Credit and Commerce International" is never filed under a case
 * called "Credit and Commerce International". What fits no title (a dropped
 * suggestion, the cut to the number asked for) is left in `rest`, for the toast.
 */
export function fileCaseRepairs(
  repairs: readonly Repair[],
  titles: readonly string[],
): { byTitle: Map<string, Repair[]>; rest: Repair[] } {
  const longestFirst = [...new Set(titles)].sort((a, b) => b.length - a.length)
  const byTitle = new Map<string, Repair[]>()
  const rest: Repair[] = []
  for (const repair of repairs) {
    const title = longestFirst.find((candidate) => repair.field.endsWith(` of ${candidate}`))
    if (title === undefined) rest.push(repair)
    else byTitle.set(title, [...(byTitle.get(title) ?? []), repair])
  }
  return { byTitle, rest }
}

/**
 * The case-finder back-test's baseline (spec 9.4): the same system prompt
 * that `Suggest cases` uses, asked to rate a fixed list of named cases rather
 * than propose its own, so the rubric is compared against what the app's LLM
 * would have said about the very same cases.
 */
export function buildScoreNamedCasesRequest(names: readonly string[]): LLMTaskRequest {
  const list = names.map((name) => `- ${name}`).join('\n')
  return {
    task: 'research',
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          'Score each of these cases. Answer with JSON only: ' +
          '{"scores": [{"title": string, "priorityScore": number}]}, ' +
          `one entry per case, titles exactly as given.\n\n${list}`,
      },
    ],
    maxTokens: outputBudget(60 * names.length + 200),
  }
}

/**
 * The baseline's score per asked name. A title the model changed or invented
 * matches nothing and is dropped, as is any score that is not a number; the
 * rest are rounded and held to the scale. A name with no usable score gets no
 * entry, and the back-test reports it as missing rather than guessing.
 */
export function parseNamedCaseScores(text: string, names: readonly string[]): Map<string, number> {
  const raw = parseJsonCompletion(text, Envelope, 'case scores')
  const items = raw['scores']
  if (!Array.isArray(items)) {
    throw new ValidationError('The case scores have no "scores" list', { field: 'case scores' })
  }
  const asked = new Set(names)
  const scores = new Map<string, number>()
  for (const item of items) {
    if (!isRecord(item)) continue
    const { title, priorityScore } = item
    if (typeof title !== 'string' || !asked.has(title) || scores.has(title)) continue
    if (typeof priorityScore !== 'number' || !Number.isFinite(priorityScore)) continue
    scores.set(
      title,
      Math.min(CASE_PRIORITY_MAX, Math.max(CASE_PRIORITY_MIN, Math.round(priorityScore))),
    )
  }
  return scores
}

/**
 * Deterministic mock output for `MOCK_PROVIDERS=1`.
 *
 * Real-looking case titles would be dangerous here: mock suggestions get
 * accepted into the library during a demo, then researched for real weeks
 * later by someone who has forgotten where they came from. Every mock case
 * says what it is in its own title.
 */
export function mockSuggestedCases(count: number): CaseSuggestion[] {
  const categories = ['collapse', 'con', 'meltdown', 'turnaround', 'empire'] as const

  return Array.from({ length: count }, (_, index) => ({
    title: `[mock suggestion ${index + 1}] not a real case`,
    category: categories[index % categories.length]!,
    angle:
      'Placeholder produced in mock-provider mode. Nothing was researched and ' +
      'no provider was called. Dismiss this row.',
    demandNotes: 'No demand evidence exists for a case that does not exist.',
    competitorLinks: [],
    subject: `Mock subject ${index + 1}`,
    people: [],
    // Descending so the sort-by-priority column has something to sort.
    priorityScore: Math.max(0, 50 - index * 3),
  }))
}
