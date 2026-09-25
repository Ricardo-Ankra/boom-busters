import { renderDirectorsBook, ShotBriefSchema, ValidationError } from '@boom-busters/schemas'
import type { DirectorsBook, ShotBrief } from '@boom-busters/schemas'
import { z } from 'zod'
import { DIRECTION_CRAFT } from './direction-craft'
import { formatIssues, parseJsonCompletion } from './json'
import { PEOPLE_RULES, referencesPrefix, SET_RULES } from './shotlist'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * A DIFFERENT brief for the same slot (decision 258).
 *
 * The gap this fills: the board could only edit a brief by hand or re-plan
 * every slot in the film. There was nothing for "this idea is wrong, give me
 * another, and here is what I am picturing".
 *
 * The format is deliberately not in question. A re-type changes what kind of
 * shot this is and has its own button; this changes the idea inside the kind
 * already chosen, which keeps the anti-slop rules where they are: a chart
 * still cites claims, a headline still quotes an article the owner picked.
 * Chart and map slots do not come through here at all — their briefs are data
 * rather than ideas, so they reuse the re-type drafting path, which already
 * validates the claim numbers.
 *
 * Routed to the shot-list task: one small planning call, not drafting.
 */

/** The types whose brief is an idea a model can simply have again. */
export type RebriefableBrief = Extract<ShotBrief, { type: 'stock' | 'archival' | 'still' }>

export interface RebriefInput {
  caseTitle: string
  brief: RebriefableBrief
  /** What the producer is picturing. Absent means "just give me another". */
  guidance?: string
  direction: DirectorsBook | null
  /**
   * Cast members the producer has photographed, and the film's sets with their
   * inventories (decision 276). Only a still reads them. Without them a steer
   * such as "Emad Mostaque in the Stability AI Boardroom" could not become the
   * brief's "depicts" and "set": the redraft never knew the room was a set,
   * so its plates were never sent.
   */
  photographed?: readonly string[]
  sets?: readonly { name: string; look: string; layout?: string }[]
}

const TARGET_SHAPE: Record<Exclude<RebriefableBrief['type'], 'still'>, string> = {
  stock: `{"type": "stock", "coversText", "description", "motion", "transition",
   "query": string, "rejectionCriteria": [string]}

"query" is what we search a stock library for. "rejectionCriteria" are the
things that would make a result wrong for this beat.`,
  archival: `{"type": "archival", "coversText", "description", "motion", "transition",
   "query": string, "mustShow": string}

This is guidance for a human searching archives by hand, so "mustShow" has to
be specific enough that they know a correct result when they see one.`,
}

/**
 * A still's shape and its people and set rules, the planner's own (decision
 * 276): a redraft may put a photographed person in one of the film's sets
 * exactly as the plan does.
 */
function stillShape(hasSets: boolean): string {
  const setFields = hasSets
    ? `,
   "set"?: the exact name of one set listed in the first message, alone,
   "camera"?: {"facing": "north"|"east"|"south"|"west", "position", "lens"?}`
    : ''
  const kept = hasSets ? '"depicts", "set" and "camera"' : '"depicts"'
  const steered = hasSets
    ? 'the person in "depicts", the room in "set" with a "camera"'
    : 'the person in "depicts"'
  return `{"type": "still", "coversText", "description", "shotSize", "motion",
   "transition", "prompt": string, "negativePrompt"?: string,
   "depicts"?: [each real person shown by likeness, by full name alone]${setFields}}

"prompt" is the full text-to-image prompt.

Keep ${kept} from the current brief while the new idea still shows those
people${hasSets ? ' in that room' : ''}. When the producer's steer names a person or a room from
the lists in the first message, the new brief shows them: ${steered}.

${PEOPLE_RULES}${hasSets ? SET_RULES : ''}`
}

export function buildRebriefRequest(input: RebriefInput): LLMTaskRequest {
  const still = input.brief.type === 'still'
  const photographed = still ? (input.photographed ?? []).filter((name) => name.trim() !== '') : []
  const sets = still ? (input.sets ?? []).filter((set) => set.name.trim() !== '') : []
  const messages: LLMTaskRequest['messages'] = [
    {
      role: 'user',
      content:
        `Case: ${input.caseTitle}` +
        (input.direction ? `\n\nDirector's book:\n${renderDirectorsBook(input.direction)}` : '') +
        referencesPrefix(photographed, sets),
    },
    { role: 'user', content: `The current brief:\n${JSON.stringify(input.brief, null, 2)}` },
  ]

  // Last, so it is the nearest thing to the answer, and only when there is
  // one: an empty steer must not read as an empty instruction to follow.
  if (input.guidance) {
    messages.push({ role: 'user', content: `The producer's steer: ${input.guidance}` })
  }

  return {
    task: 'shotlist',
    system: `You are re-planning ONE visual slot of a documentary. The producer has
rejected the current idea and wants a DIFFERENT one for the same moment of
narration.

Keep "coversText" EXACTLY as given, and keep the type "${input.brief.type}":
what kind of shot this is has already been decided, and only the idea inside
it is in question. Rewrite "description" and the type's own fields. Keep
"motion" and "transition" unless the new idea makes them impossible ("static"
is always safe).

Do not restate the current idea in other words. It was rejected, so a
paraphrase of it is not an answer. If the producer has given a steer below,
follow it, and keep every craft rule that does not conflict with it.

${DIRECTION_CRAFT}

The target shape:
${input.brief.type === 'still' ? stillShape(sets.length > 0) : TARGET_SHAPE[input.brief.type]}

"motion" is {"kind": "static"} or {"kind": "kenburns", "direction": "in"|"out",
"speed": "slow"|"medium"|"fast"} or {"kind": "pan", "path": string}.
"transition" is "cut" or "dissolve".

Return JSON: {"brief": {...}} — or {"error": "one sentence why"} if this beat
honestly has no other image worth cutting to.`,
    messages,
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(1200),
  }
}

const Envelope = z.union([z.object({ brief: z.unknown() }), z.object({ error: z.string().min(1) })])

export function parseRebriefedBrief(text: string, original: RebriefableBrief): ShotBrief {
  const envelope = parseJsonCompletion(text, Envelope, 'new brief')
  if ('error' in envelope) {
    throw new ValidationError(envelope.error, { field: 'new brief' })
  }

  const parsed = ShotBriefSchema.safeParse(envelope.brief)
  if (!parsed.success) {
    throw new ValidationError(`The new brief is malformed: ${formatIssues(parsed.error)}`, {
      field: 'new brief',
    })
  }
  if (parsed.data.type !== original.type) {
    throw new ValidationError(
      `The new brief changed the format to "${parsed.data.type}". Re-typing is its own button.`,
      { field: 'new brief' },
    )
  }
  if (parsed.data.coversText !== original.coversText) {
    throw new ValidationError('The new brief changed the sentence it covers.', {
      field: 'new brief',
    })
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/**
 * Deterministic re-brief for `MOCK_PROVIDERS=1`. It must differ from the brief
 * it replaces, or the offline path would prove nothing: the whole point of the
 * button is that the second idea is not the first one again.
 */
export function mockRebriefedBrief(brief: RebriefableBrief, guidance?: string): ShotBrief {
  const steer = guidance ? ` Steered: ${guidance}` : ''
  const description = `[mock] A different angle on the same moment.${steer}`

  switch (brief.type) {
    case 'stock':
      return { ...brief, description, query: `[mock] ${brief.query} alternative` }
    case 'archival':
      return { ...brief, description, mustShow: `[mock] ${brief.mustShow}, from another source` }
    case 'still':
      return { ...brief, description, prompt: `[mock] A second take: ${brief.prompt}` }
  }
}
