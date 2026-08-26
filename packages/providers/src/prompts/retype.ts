import { PlannedBriefSchema, resolvePlannedBrief, ValidationError } from '@boom-busters/schemas'
import type { ShotBrief, ShotSlotType } from '@boom-busters/schemas'
import { z } from 'zod'
import { claimList, type ScriptClaim } from './script'
import { formatIssues, parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * Re-typing a slot into a STRUCTURED type (staged-visuals design,
 * 2026-08-26). Converting between the text-driven types is mechanical
 * (`convertBrief` in the schemas package); converting INTO chart or map
 * needs data no template can supply — series values that must come from the
 * dossier's claims, coordinates for named places. One small call on the
 * shot-list model drafts that brief; the schema validates it; the owner can
 * still edit it before anything is fetched.
 *
 * The model may refuse: a chart whose numbers are not in the claims is not
 * allowed to exist (spec section 7.4's anti-slop rule), and the refusal
 * message travels to the board as the action's error.
 */

export interface RetypeInput {
  caseTitle: string
  brief: ShotBrief
  targetType: Extract<ShotSlotType, 'chart' | 'map'>
  claims: readonly ScriptClaim[]
}

export function buildRetypeRequest(input: RetypeInput): LLMTaskRequest {
  const target =
    input.targetType === 'chart'
      ? `{"type": "chart", "coversText", "description", "motion", "transition",
   "chartKind": "line"|"area"|"bar"|"stacked"|"waterfall",
   "series": [{"label", "unit", "points": [{"x": string, "y": number}]}],
   "dataRefs": [claim number], "takeaway",
   "annotations"?: [{"atX", "text"}], "reveal": "draw-on"|"none"}

Chart rules: every value in "series" must appear in the claim list below,
verbatim — never estimate, interpolate or invent a number. "dataRefs" lists
the claim NUMBERS (e.g. [3, 7]) the values come from. Every series needs at
least two points. If the claims do not contain usable numbers for this
slot's subject, do not make a chart — refuse instead.`
      : `{"type": "map", "coversText", "description", "motion", "transition",
   "locations": [{"label", "lat": number, "lon": number}] (1-8 entries),
   "route": boolean}

Map rules: locations are the real places this slot's narration concerns,
with real coordinates. "route" is true only when the story MOVES between
them in order (money flows, HQ hops).`

  return {
    task: 'shotlist',
    system: `You are re-planning ONE visual slot of a documentary. The slot
currently has a brief of type "${input.brief.type}"; the producer wants the
same story beat expressed as type "${input.targetType}" instead.

Return JSON: {"brief": {...}} — or {"error": "one sentence why"} if this
beat cannot honestly be a ${input.targetType}.

The new brief keeps the slot's place in the film: reuse "coversText"
EXACTLY as given, keep "motion" and "transition" unless the new type makes
them impossible ("static" is always safe), and keep the intent of
"description".

The target shape:
${target}

"motion" is {"kind": "static"} or {"kind": "kenburns", "direction": "in"|"out",
"speed": "slow"|"medium"|"fast"} or {"kind": "pan", "path": string}.
"transition" is "cut" or "dissolve".`,
    messages: [
      { role: 'user', content: `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` },
      { role: 'user', content: `The current brief:\n${JSON.stringify(input.brief, null, 2)}` },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(1500),
  }
}

const RetypeEnvelopeSchema = z.union([
  z.object({ brief: z.unknown() }),
  z.object({ error: z.string().min(1) }),
])

export function parseRetypedBrief(
  text: string,
  input: { targetType: RetypeInput['targetType']; claimIds: readonly string[] },
): ShotBrief {
  const envelope = parseJsonCompletion(text, RetypeEnvelopeSchema, 'retyped brief')

  if ('error' in envelope) {
    throw new ValidationError(`The model declined the conversion: ${envelope.error}`, {
      field: 'retyped brief',
    })
  }

  const parsed = PlannedBriefSchema.safeParse(envelope.brief)
  if (!parsed.success) {
    throw new ValidationError(`The retyped brief is malformed: ${formatIssues(parsed.error)}`, {
      field: 'retyped brief',
    })
  }
  if (parsed.data.type !== input.targetType) {
    throw new ValidationError(`Asked for a ${input.targetType} brief, got "${parsed.data.type}".`, {
      field: 'retyped brief',
    })
  }

  const resolved = resolvePlannedBrief(parsed.data, input.claimIds)
  if (!resolved) {
    throw new ValidationError(
      'The retyped chart cites claim numbers that do not exist in this project.',
      { field: 'retyped brief' },
    )
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/** Deterministic conversion for `MOCK_PROVIDERS=1` — same shapes the mock shot list uses. */
export function mockRetypedBrief(input: {
  brief: ShotBrief
  targetType: RetypeInput['targetType']
  claimIds: readonly string[]
}): ShotBrief {
  const common = {
    coversText: input.brief.coversText,
    description: input.brief.description,
    motion: { kind: 'static' } as const,
    transition: input.brief.transition,
  }

  if (input.targetType === 'chart') {
    const claimId = input.claimIds[0]
    if (!claimId) {
      throw new ValidationError(
        'A chart must cite the claims its numbers come from, and this project has none.',
        { field: 'retyped brief' },
      )
    }
    return {
      type: 'chart',
      ...common,
      chartKind: 'line',
      series: [
        {
          label: '[mock] Share price',
          unit: 'EUR',
          points: [
            { x: '2020-06-17', y: 104.5 },
            { x: '2020-06-26', y: 1.28 },
          ],
        },
      ],
      dataRefs: [claimId],
      takeaway: '[mock] Retyped from a ' + input.brief.type + ' slot.',
      reveal: 'draw-on',
    }
  }

  return {
    type: 'map',
    ...common,
    locations: [
      { label: 'Munich', lat: 48.14, lon: 11.58 },
      { label: 'Manila', lat: 14.6, lon: 120.98 },
    ],
    route: true,
  }
}
