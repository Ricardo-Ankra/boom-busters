import {
  ExemplarPlanSchema,
  GRAPHIC_CONCEPT_MAX,
  GRAPHIC_STORYBOARD_LINE_MAX,
  GRAPHIC_STORYBOARD_MAX,
  MECHANISM_KEYS,
  MECHANISMS_PER_DESIGN_MAX,
  PLAN_INTENT_MAX,
  PLAN_LEANS_ON_MAX,
  PLAN_WHY_MAX,
  ValidationError,
  mechanismName,
  planIssue,
} from '@boom-busters/schemas'
import type { ExemplarPlan, MotionIdentity } from '@boom-busters/schemas'
import { z } from 'zod'
import type { TechniqueEntry } from '../exemplars/channel-technique'
import { outputBudget, type LLMTaskRequest } from '../llm/types'
import { motionIdentityBlock } from './graphics'
import { formatIssues, parseJsonCompletion } from './json'
import type { IdentityDraftInput, ReadingForDraft } from './motion'
import { capList, dropItems, ignoreRepairs, trimField, type Note } from './repair'

/**
 * The storyboard call (spec 2026-11-04, section 9.2, step 1): a text call
 * on the graphics route that writes the plan for one technique of one
 * channel: the catalogue's synthetic slot rewritten into the channel's
 * register, the concept, the storyboard on the slot's clock, the
 * mechanisms it will use, and which references it leans on and why. No
 * image goes here (spec 3): the readings are text.
 *
 * Two messages: the identity and the style guide, cached across a
 * derivation's techniques, then the technique's material.
 */

export const STORYBOARD_OUTPUT_TOKENS = 2500
/** For the estimate shown before a launch: the head and the material. */
export const STORYBOARD_INPUT_TOKENS = 6000

export interface StoryboardInput {
  motion: MotionIdentity
  brand: IdentityDraftInput['brand']
  /** A catalogue entry, or the one a proposal makes (spec 8.5). */
  entry: TechniqueEntry
  /** The house design's plan, as mechanics to learn from; null when none is stored. */
  house: { title: string; concept?: string; storyboard?: string[] } | null
  readings: readonly ReadingForDraft[]
  /** Why the previous plan for this technique was refused. */
  rejection?: string
}

const SYSTEM = `You plan one motion graphic for this channel, writing nothing but the plan: no code.
The graphic is the channel's own example of one technique, built later by the designer from
your plan and judged by a critic against the channel's references. The slot you are given is
a synthetic one from the catalogue: rewrite its words and figures into something this channel
would say and count, in its register, keeping the slot's length and its word count within a
third either way. For a chart, keep the same number of series and of points per series, with
labels, units and values the channel would chart. Every word sits on the clock in order, inside
the slot.

Answer with JSON only, its keys in this order:
{"slot": {"intent": "...", "words": [{"text": "...", "atMs": 0}], "data": {"series": [{"label": "...", "unit": "...", "points": [{"x": "...", "y": 0}]}], "takeaway": "..."}}, "concept": "...", "storyboard": ["0.0 s ..."], "mechanisms": ["..."], "leansOn": [{"title": "...", "why": "..."}]}
- "slot.intent": what the viewer must take away, under ${PLAN_INTENT_MAX} characters.
- "slot.words": the narration on the slot's clock, atMs from 0, ascending.
- "slot.data": a chart technique only; leave it out for a graphic.
- "concept": one line under ${GRAPHIC_CONCEPT_MAX} characters, the idea the whole slot serves.
- "storyboard": up to ${GRAPHIC_STORYBOARD_MAX} lines, each beginning with its time in seconds ("2.0 s the figure rises"), under ${GRAPHIC_STORYBOARD_LINE_MAX} characters.
- "mechanisms": up to ${MECHANISMS_PER_DESIGN_MAX} keys from the list, the moves the design is built on.
- "leansOn": up to ${PLAN_LEANS_ON_MAX} of the references, by title, each with why in under ${PLAN_WHY_MAX} characters; empty when none applies.
A reference is grammar to learn from, never content to copy. Use no dash characters.`

const MECHANISMS_LIST = `The mechanisms, by key: ${MECHANISM_KEYS.join(', ')}.`

/** A reference's reading as text, shared with the technique proposal. */
export function readingBlock(entry: ReadingForDraft, index: number): string {
  const tags = [entry.purpose, ...(entry.negative ? ['negative'] : [])].join(', ')
  const head = `Reference ${index + 1}: "${entry.title}" (${tags}). Carry over: ${entry.carryOver}.${entry.avoid ? ` Avoid: ${entry.avoid}.` : ''}`
  if (!entry.reading) return `${head}\nReading: unread.`
  const r = entry.reading
  return [
    head,
    `Medium: ${r.medium}`,
    `Palette: ${r.palette.join(', ') || 'none noted'}`,
    `Type: ${r.type}`,
    `Enters: ${r.enters}`,
    `Exits: ${r.exits}`,
    `Motion: ${r.motion}`,
    `Absent: ${r.absent}`,
    r.notes ? `Notes: ${r.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export function buildStoryboardRequest(input: StoryboardInput): LLMTaskRequest {
  const guide = input.motion.styleGuideMd.trim()
  const head = [
    motionIdentityBlock(input.motion).trim(),
    guide ? `The channel's style guide:\n${guide}` : '',
    MECHANISMS_LIST,
  ]
    .filter(Boolean)
    .join('\n\n')

  const { entry } = input
  const colours = Object.entries(input.brand.colors)
    .map(([role, value]) => `${role} ${value}`)
    .join(', ')
  const fonts = Object.entries(input.brand.fonts)
    .map(([role, value]) => `${role} ${value}`)
    .join(', ')
  const words = entry.slot.words.map((word) => `${seconds(word.atMs)} "${word.text}"`).join(', ')
  const spoken = entry.slot.words.map((word) => word.text).join(' ')
  const chart = entry.chart && entry.slot.data ? entry.slot.data : null
  const house = input.house
    ? [
        `The house design for this technique, "${input.house.title}", as mechanics to learn from:`,
        input.house.concept ? `Concept: ${input.house.concept}` : '',
        input.house.storyboard?.length
          ? `Storyboard:\n${input.house.storyboard.map((line) => `- ${line}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : 'No house design is stored for it.'
  const readings =
    input.readings.length === 0
      ? 'The channel has no references yet: plan from the identity and the brand alone.'
      : `The channel's references, by their readings:\n\n${input.readings.map(readingBlock).join('\n\n')}`

  const material = [
    input.rejection ? `The previous plan was refused: ${input.rejection}\n` : '',
    `The technique: ${entry.technique}, ${entry.description}. It is built on: ${entry.mechanisms.map(mechanismName).join(', ')}.`,
    `The synthetic slot: ${seconds(entry.slot.durationMs)} long, ${entry.slot.words.length} words. Intent: ${entry.slot.intent}`,
    `Its words, on the clock: ${words}.`,
    `Spoken whole: "${spoken}"`,
    chart
      ? `A chart technique: the plan's "data" keeps ${chart.series.length} series of ${chart.series[0]?.points.length ?? 0} points. The synthetic data:\n\`\`\`json\n${JSON.stringify(chart, null, 2)}\n\`\`\``
      : 'A graphic technique: no "data".',
    `The brand's colours: ${colours || 'house'}. The brand's fonts: ${fonts || 'house'}.`,
    house,
    readings,
    'Write the plan.',
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    task: 'graphics',
    system: SYSTEM,
    messages: [
      { role: 'user', content: head },
      { role: 'user', content: material },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(STORYBOARD_OUTPUT_TOKENS),
  }
}

const isMechanism = (value: unknown) =>
  typeof value === 'string' && (MECHANISM_KEYS as readonly string[]).includes(value)

/**
 * The plan, read through its schema with the lines trimmed, an unknown
 * mechanism dropped and the lists capped, each with a note; then held to
 * the slot's bounds, whose sentence is the refusal the retry carries.
 */
export function parseStoryboardPlan(
  text: string,
  bounds: Parameters<typeof planIssue>[1],
  note: Note = ignoreRepairs,
): ExemplarPlan {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'storyboard plan')
  const storyboard = capList(
    Array.isArray(raw['storyboard'])
      ? raw['storyboard'].map((line) =>
          trimField(line, GRAPHIC_STORYBOARD_LINE_MAX, 'a storyboard line', note),
        )
      : raw['storyboard'],
    GRAPHIC_STORYBOARD_MAX,
    'the storyboard',
    note,
  )
  const mechanisms = capList(
    dropItems(
      raw['mechanisms'],
      (item) => (isMechanism(item) ? null : 'not a mechanism in the list'),
      (item, index) => `mechanism ${index + 1} (${String(item)})`,
      note,
    ),
    MECHANISMS_PER_DESIGN_MAX,
    'the mechanisms',
    note,
  )
  const leansOn = capList(
    Array.isArray(raw['leansOn'])
      ? raw['leansOn'].map((item) =>
          item && typeof item === 'object'
            ? {
                ...(item as Record<string, unknown>),
                why: trimField(
                  (item as Record<string, unknown>)['why'],
                  PLAN_WHY_MAX,
                  'a why',
                  note,
                ),
              }
            : item,
        )
      : raw['leansOn'],
    PLAN_LEANS_ON_MAX,
    'the references leaned on',
    note,
  )
  const parsed = ExemplarPlanSchema.safeParse({
    ...raw,
    concept: trimField(raw['concept'], GRAPHIC_CONCEPT_MAX, 'the concept', note),
    storyboard,
    mechanisms: mechanisms ?? [],
    leansOn: leansOn ?? [],
  })
  if (!parsed.success) {
    throw new ValidationError(`The plan is malformed: ${formatIssues(parsed.error)}`, {
      field: 'storyboard plan',
    })
  }
  const issue = planIssue(parsed.data, bounds)
  if (issue) throw new ValidationError(issue, { field: 'storyboard plan' })
  return parsed.data
}

/** Mock mode's plan: the catalogue slot as it is, under a mock concept. */
export function mockStoryboardPlan(
  entry: Pick<TechniqueEntry, 'slot' | 'mechanisms' | 'chart'>,
): ExemplarPlan {
  return {
    slot: {
      intent: entry.slot.intent,
      words: entry.slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
      ...(entry.chart && entry.slot.data ? { data: entry.slot.data } : {}),
    },
    concept: '[mock] the house design, unchanged',
    storyboard: ['0.0 s the house design plays as written'],
    mechanisms: [...entry.mechanisms],
    leansOn: [],
  }
}
