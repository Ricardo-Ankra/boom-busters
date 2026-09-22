import {
  figureDigitGroups,
  PlannedBriefSchema,
  resolvePlannedBrief,
  ValidationError,
} from '@boom-busters/schemas'
import type { LogoIndex, PlanningClaim, ShotBrief, ShotSlotType } from '@boom-busters/schemas'
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
  targetType: Extract<ShotSlotType, 'chart' | 'map' | 'graphic'>
  claims: readonly ScriptClaim[]
  /**
   * The producer's steer (decision 258). Set when the call is a re-brief
   * rather than a re-type: a chart, map or graphic brief is data rather than
   * an idea, so asking for a different one comes back through this path and
   * its claim validation, with the target type being the one the slot
   * already has.
   */
  guidance?: string
  /**
   * Titles of the marks the logo library holds (decision 268, Plan B), used
   * only when the target is "graphic": the drafted brief's "logo" names one
   * exactly so the render finds it without an upload first.
   */
  logos?: readonly string[]
}

export function buildRetypeRequest(input: RetypeInput): LLMTaskRequest {
  const logos = (input.logos ?? []).filter((title) => title.trim().length > 0)

  const target =
    input.targetType === 'chart'
      ? `{"type": "chart", "coversText", "description", "motion", "transition",
   "chartKind": "line"|"area"|"bar"|"stacked"|"waterfall",
   "series": [{"label", "unit", "axis"?: "left"|"right",
               "points": [{"x": string, "y": number}]}],
   "dataRefs": [claim number], "takeaway",
   "annotations"?: [{"atX", "text"}], "reveal": "draw-on"|"none"}
Chart kind, chosen by what the data IS, not by habit:
- "line" for a value moving through time. The default for any series whose x
  axis is dates or years.
- "area" for one value through time where the SIZE of it is the point.
- "bar" for comparing separate things, or a handful of periods side by side.
- "stacked" for parts of a whole, where the total matters as much as the split.
- "waterfall" for a bridge from one total to another through named steps; the
  points are LEVELS, not the size of each step.
Never answer with a bar because it is the safe choice. If the producer names a
kind, use it.

Two measures that are not in the same unit (a valuation in billions against a
margin in percent) need "axis": "left" on one series and "right" on the other.
On one scale the smaller series flattens onto the floor and is labelled in the
other's unit, which is a chart that lies.

Chart rules: every value in "series" must appear in the claim list below,
verbatim — never estimate, interpolate or invent a number. "dataRefs" lists
the claim NUMBERS (e.g. [3, 7]) the values come from. Every series needs at
least two points. If the claims do not contain usable numbers for this
slot's subject, do not make a chart — refuse instead.`
      : input.targetType === 'map'
        ? `{"type": "map", "coversText", "description", "motion", "transition",
   "locations": [{"label", "lat": number, "lon": number}] (1-8 entries),
   "route": boolean}

Map rules: locations are the real places this slot's narration concerns,
with real coordinates. "route" is true only when the story MOVES between
them in order (money flows, HQ hops).`
        : `{"type": "graphic", "coversText", "description", "motion", "transition",
   "scene": {"elements": [element, ...]}} where each element is one of:
   {"kind": "text", "id", "cell", "content" (max 120 chars), "role": "heading"|"title"|"body"|"numbers"|"captions",
    "color", "align"?: "start"|"center"|"end", "enter"?, "emphasis"?}
   {"kind": "figure", "id", "cell", "value" (exactly what is shown, e.g. "$4bn"), "label"?,
    "claimRef": claim number, "color", "enter"?, "emphasis"?}
   {"kind": "logo", "id", "cell", "entity": the company or person's exact name, "enter"?}
   {"kind": "shape", "id", "cell", "form": "rect"|"rule"|"disc", "color", "opacity"?: 0.05-1}
   {"kind": "bars", "id", "cell", "items": [{"label", "value": number, "display", "claimRef": claim number}] (2 to 5),
    "color", "highlightIndex"?}
   "cell" is {"col", "row", "colSpan", "rowSpan"} on a 12 by 12 grid; "color" is one of
   primary, accent, background, surface, textPrimary, textSecondary, captionHighlight, collapse,
   recovery, series0, series1, series2; "enter" is {"kind": "fade"|"rise"|"wipe"|"count", "atMs"}
   ("count" only on a figure); "emphasis" is "pulse"|"underline".

A "graphic" is for a beat that is one or two cited figures, a company's or a person's
mark, or a relationship between named things (a before and after, a comparison of two or
three amounts, three dated moments). It is never a chart with fewer points: a value moving
through time is a "chart". Every "figure" and every "bars" item cites the claim NUMBER its
value comes from, and the digits shown must appear in that claim. Colours and type roles
are the names listed; there is no other styling. Six elements at most; leave the
bottom two rows clear for captions. A "logo" names the company or person exactly as
listed under Logos; if no mark is listed for them, still name them and the producer
will upload it.`

  return {
    task: 'shotlist',
    system: `You are re-planning ONE visual slot of a documentary. ${
      input.brief.type === input.targetType
        ? `The producer has rejected the current ${input.targetType} and wants a DIFFERENT
one for the same story beat. Do not restate the current brief in other words:
it was rejected, so a paraphrase of it is not an answer.`
        : `The slot
currently has a brief of type "${input.brief.type}"; the producer wants the
same story beat expressed as type "${input.targetType}" instead.`
    }

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
      {
        role: 'user',
        content:
          `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` +
          (logos.length > 0
            ? `\n\nLogos (marks the producer holds; a graphic's "logo" names one exactly):\n` +
              logos.map((title) => `- ${title}`).join('\n')
            : ''),
      },
      { role: 'user', content: `The current brief:\n${JSON.stringify(input.brief, null, 2)}` },
      // Last, nearest the answer, and only when there is one: an empty steer
      // must not read as an empty instruction to follow.
      ...(input.guidance
        ? [{ role: 'user' as const, content: `The producer's steer: ${input.guidance}` }]
        : []),
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
  input: {
    targetType: RetypeInput['targetType']
    claims: readonly PlanningClaim[]
    /** The logo library's index (decision 268, Plan B), for a graphic's "logo" elements. */
    logos?: readonly LogoIndex[]
  },
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

  const resolved = resolvePlannedBrief(parsed.data, input.claims, input.logos ?? [])
  if (!resolved) {
    throw new ValidationError(
      `The retyped ${input.targetType} cites claim numbers that do not exist in this project.`,
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
  /**
   * Present when this is a re-brief (decision 258). The mock must then differ
   * from the brief it replaces, or the offline path would prove nothing: the
   * whole point of that button is that the second answer is not the first.
   */
  guidance?: string
  /** The claim list's text, in prompt order, so the mock graphic's figure truly cites claim 1. */
  claimTexts?: readonly string[]
  /** Titles the logo library holds (decision 268, Plan B); the mock names the first one. */
  logoTitles?: readonly string[]
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
      takeaway: input.guidance
        ? '[mock] Drafted again: ' + input.guidance
        : '[mock] Retyped from a ' + input.brief.type + ' slot.',
      reveal: 'draw-on',
    }
  }

  if (input.targetType === 'graphic') {
    const claimId = input.claimIds[0]
    if (!claimId) {
      throw new ValidationError(
        'A graphic must cite the claim its figure comes from, and this project has none.',
        { field: 'retyped brief' },
      )
    }
    const claimText = input.claimTexts?.[0] ?? ''
    const digits = figureDigitGroups(claimText)[0] ?? '0'
    const value = claimText.toLowerCase().includes('billion') ? `$${digits}bn` : digits
    const logoTitle = input.logoTitles?.[0]

    return {
      type: 'graphic',
      ...common,
      ...(input.guidance ? { description: '[mock] Drafted again: ' + input.guidance } : {}),
      scene: {
        elements: [
          {
            kind: 'figure',
            id: 'f1',
            cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
            value,
            claimRef: claimId,
            color: 'accent',
            enter: { kind: 'count', atMs: 300 },
          },
          ...(logoTitle
            ? [
                {
                  kind: 'logo' as const,
                  id: 'l1',
                  cell: { col: 8, row: 1, colSpan: 4, rowSpan: 4 },
                  entity: logoTitle,
                  enter: { kind: 'fade' as const, atMs: 0 },
                },
              ]
            : []),
        ],
      },
    }
  }

  return {
    type: 'map',
    ...common,
    ...(input.guidance ? { description: '[mock] Drafted again: ' + input.guidance } : {}),
    locations: [
      { label: 'Munich', lat: 48.14, lon: 11.58 },
      { label: 'Manila', lat: 14.6, lon: 120.98 },
    ],
    route: true,
  }
}
