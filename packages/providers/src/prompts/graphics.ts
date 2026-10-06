import {
  figureDigitGroups,
  GRAPHIC_COLORS,
  GRAPHIC_TYPE_ROLES,
  MAX_GRAPHIC_ELEMENTS,
  PlannedGraphicSceneSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { PlannedGraphicScene } from '@boom-busters/schemas'
import { z } from 'zod'
import { claimList, type ScriptClaim } from './script'
import { formatIssues, parseJsonCompletion } from './json'
import { outputBudget, type LLMTaskRequest } from '../llm/types'

/**
 * The graphics designer (decision 289): one call per graphic slot, on its own
 * route. The shot list decides that a beat is a graphic and what it must get
 * across; this call decides what is on screen, where, and when it enters.
 *
 * Three messages: the system rules and the film message are identical for
 * every graphic of a film, so the provider caches them and each graphic pays
 * for its own slot message only.
 */

/** A scene of six elements is well under this; the rest is the model's room to think. */
export const GRAPHIC_ANSWER_TOKENS = 3000

export interface SlotWord {
  text: string
  offsetMs: number
}

export interface GraphicDesignInput {
  caseTitle: string
  /** The film's claims in prompt order: positions are the numbers cited. */
  claims: readonly ScriptClaim[]
  /** Titles the logo library holds. */
  logos: readonly string[]
  chapterTitle: string
  coversText: string
  /** The paragraph or paragraphs the slot sits in, for context. */
  paragraphText: string
  durationMs: number
  words: readonly SlotWord[]
  wordsEstimated: boolean
  intent: string
  intentRefs: readonly number[]
  /** A redesign: the scene being replaced, in claim numbers. */
  current?: PlannedGraphicScene
  guidance?: string
  /** Why the previous answer to this same slot was refused. */
  rejection?: string
}

const SYSTEM = `You design ONE motion graphic for a documentary about a corporate collapse.
The narration is recorded. You decide what is on screen, where, and when each
piece enters, so the graphic lands the beat the narrator is speaking.

Return JSON only: {"scene": {"elements": [element, ...]}}.

Design rules:
- One idea per graphic. One element dominates (usually the figure); everything
  else supports it. A viewer gets it in the first second.
- Fewer elements beat more. ${MAX_GRAPHIC_ELEMENTS} is the ceiling, not the target; two or three is common.
- Leave room. Do not fill the grid. The bottom two rows (row 10 and 11) stay
  empty: captions sit there.
- Colour carries meaning: "collapse" for loss and failure, "recovery" for
  gain, "accent" or "captionHighlight" for the one thing to look at, "series0"
  to "series2" to tell compared things apart. Text is "textPrimary" or
  "textSecondary". Never colour for decoration.
- Time entrances to the words. Each slot comes with the words spoken in it and
  when; a figure should land as its number is said, a logo as its name is
  said. An element enters by "atMs" from the slot's start. Every entrance must
  START at least 600 ms before the slot ends, so it can finish.
- A figure "count"s up only when the number itself is the story.
- Two or three amounts compared read better as "bars" than as figures side by side.
- A logo earns its place when the company or person is the subject, not
  because they are mentioned. Name them exactly as the Logos list does; if
  they are not listed, still name them and the producer will upload the mark.
- Every number shown cites the claim it comes from, by NUMBER, and the digits
  shown must appear in that claim's text ("$4bn" from "4 billion" is fine;
  "$4.2bn" is not). The intent names the claims the beat rests on; you may
  cite any claim in the list when it holds the number better.
- Words on screen are short: a title is a few words, never a sentence of narration.

Elements:
{"kind": "text", "id", "cell", "content" (max 120 chars), "role": ${GRAPHIC_TYPE_ROLES.map((r) => `"${r}"`).join('|')},
 "color", "align"?: "start"|"center"|"end", "enter"?, "emphasis"?}
{"kind": "figure", "id", "cell", "value" (exactly what is shown, e.g. "$4bn"), "label"?,
 "claimRef": claim number, "color", "enter"?, "emphasis"?}
{"kind": "logo", "id", "cell", "entity": the exact name, "enter"?}
{"kind": "shape", "id", "cell", "form": "rect"|"rule"|"disc", "color", "opacity"?: 0.05-1}
{"kind": "bars", "id", "cell", "items": [{"label", "value": number, "display", "claimRef": claim number}] (2 to 5),
 "color", "highlightIndex"?}
"cell" is {"col", "row", "colSpan", "rowSpan"} on a 12 by 12 grid (0-based).
"portraitCell" (optional, same shape) places the element on the 9:16 Shorts
frame; leave it out to let the layout stack elements in reading order.
"color" is one of ${GRAPHIC_COLORS.join(', ')}.
"enter" is {"kind": "fade"|"rise"|"wipe"|"count", "atMs"} ("count" only on a figure).
"emphasis" is "pulse"|"underline". Ids are unique; one logo per entity.

Example, a single number that is the story:
{"scene": {"elements": [
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 2, "colSpan": 8, "rowSpan": 1}, "content": "Raised in one round", "role": "title", "color": "textSecondary", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "figure", "id": "f", "cell": {"col": 1, "row": 3, "colSpan": 8, "rowSpan": 4}, "value": "$4bn", "claimRef": 3, "color": "accent", "enter": {"kind": "count", "atMs": 900}, "emphasis": "underline"}]}}

Example, two amounts compared:
{"scene": {"elements": [
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 1, "colSpan": 10, "rowSpan": 1}, "content": "2024 revenue", "role": "title", "color": "textSecondary", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "bars", "id": "b", "cell": {"col": 1, "row": 3, "colSpan": 10, "rowSpan": 5}, "items": [{"label": "Nvidia", "value": 130, "display": "$130bn", "claimRef": 4}, {"label": "Intel", "value": 53, "display": "$53bn", "claimRef": 7}], "color": "series0", "highlightIndex": 0, "enter": {"kind": "wipe", "atMs": 600}}]}}

Example, a relationship between named marks:
{"scene": {"elements": [
 {"kind": "logo", "id": "a", "cell": {"col": 1, "row": 3, "colSpan": 4, "rowSpan": 3}, "entity": "Acme", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "shape", "id": "r", "cell": {"col": 5, "row": 4, "colSpan": 2, "rowSpan": 1}, "form": "rule", "color": "accent"},
 {"kind": "logo", "id": "b", "cell": {"col": 7, "row": 3, "colSpan": 4, "rowSpan": 3}, "entity": "Rival", "enter": {"kind": "fade", "atMs": 1400}},
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 7, "colSpan": 10, "rowSpan": 1}, "content": "Bought for $900m", "role": "body", "color": "textPrimary", "align": "center", "enter": {"kind": "rise", "atMs": 2200}}]}}`

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export function buildGraphicRequest(input: GraphicDesignInput): LLMTaskRequest {
  const logos = input.logos.filter((title) => title.trim().length > 0)
  const film =
    `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` +
    (logos.length > 0
      ? `\n\nLogos (marks the producer holds):\n${logos.map((title) => `- ${title}`).join('\n')}`
      : '')

  const words = input.words.map((word) => `${seconds(word.offsetMs)}  ${word.text}`).join('\n')
  const slot =
    `Chapter: ${input.chapterTitle}\n\n` +
    `The paragraph: ${input.paragraphText}\n\n` +
    `This graphic covers: ${input.coversText}\n` +
    `Length: ${seconds(input.durationMs)}\n\n` +
    `Words spoken in it, from its start${input.wordsEstimated ? ' (estimated from the slot length; no recorded timings)' : ''}:\n${words}\n\n` +
    `Intent: ${input.intent}\n` +
    `Rests on claims: ${input.intentRefs.length > 0 ? input.intentRefs.join(', ') : 'none named'}`

  return {
    task: 'graphics',
    system: SYSTEM,
    messages: [
      { role: 'user', content: film },
      { role: 'user', content: slot },
      ...(input.current
        ? [
            {
              role: 'user' as const,
              content:
                'The current design, which the producer wants changed (claimRef 0 is a claim no longer in the list):\n' +
                JSON.stringify(input.current, null, 2),
            },
          ]
        : []),
      ...(input.rejection
        ? [
            {
              role: 'user' as const,
              content: `Your previous answer for this slot was refused: ${input.rejection}. Answer again with that fixed.`,
            },
          ]
        : []),
      // Last, nearest the answer, and only when there is one.
      ...(input.guidance
        ? [{ role: 'user' as const, content: `The producer's steer: ${input.guidance}` }]
        : []),
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(GRAPHIC_ANSWER_TOKENS),
  }
}

const GraphicEnvelopeSchema = z.object({ scene: z.unknown() })

export function parseGraphicScene(text: string): PlannedGraphicScene {
  const envelope = parseJsonCompletion(text, GraphicEnvelopeSchema, 'graphic scene')
  const parsed = PlannedGraphicSceneSchema.safeParse(envelope.scene)
  if (!parsed.success) {
    throw new ValidationError(`The graphic is malformed: ${formatIssues(parsed.error)}`, {
      field: 'graphic scene',
    })
  }
  return parsed.data
}

/** The words spoken inside a slot, on the slot's own clock. */
export function wordsInSlot(
  words: readonly { text: string; startMs: number }[],
  startMs: number,
  durationMs: number,
): SlotWord[] {
  return words
    .filter((word) => word.startMs >= startMs && word.startMs < startMs + durationMs)
    .map((word) => ({ text: word.text, offsetMs: word.startMs - startMs }))
}

/** No recorded timings: the covered words spread evenly across the slot. */
export function estimatedWords(coversText: string, durationMs: number): SlotWord[] {
  const words = coversText.split(/\s+/).filter(Boolean)
  const step = words.length > 0 ? durationMs / words.length : 0
  return words.map((text, at) => ({ text, offsetMs: Math.round(at * step) }))
}

/** Deterministic design for MOCK_PROVIDERS=1: the figure's digits truly come from the cited claim. */
export function mockGraphicScene(input: {
  claimTexts: readonly string[]
  intentRefs: readonly number[]
  logoTitles?: readonly string[]
  guidance?: string
  durationMs: number
}): PlannedGraphicScene {
  const ref = input.intentRefs.find(
    (n) => figureDigitGroups(input.claimTexts[n - 1] ?? '').length > 0,
  )
  const text = ref ? input.claimTexts[ref - 1]! : ''
  const digits = figureDigitGroups(text)[0]
  const value = text.toLowerCase().includes('billion') ? `$${digits}bn` : digits
  const landAt = Math.min(900, Math.max(0, input.durationMs - 700))
  const title = input.guidance
    ? `[mock] Redesigned: ${input.guidance}`.slice(0, 120)
    : '[mock] Raised in one round'
  const logoTitle = input.logoTitles?.[0]
  return {
    elements: [
      {
        kind: 'text',
        id: 't1',
        cell: { col: 0, row: 0, colSpan: 7, rowSpan: 2 },
        content: title,
        role: 'title',
        color: 'textSecondary',
        align: 'start',
        enter: { kind: 'fade', atMs: 0 },
      },
      ...(ref && digits !== undefined
        ? [
            {
              kind: 'figure' as const,
              id: 'f1',
              cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
              value: value ?? digits,
              claimRef: ref,
              color: 'accent' as const,
              enter: { kind: 'count' as const, atMs: landAt },
            },
          ]
        : []),
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
  } as PlannedGraphicScene
}
