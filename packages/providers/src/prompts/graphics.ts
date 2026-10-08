import {
  figureDigitGroups,
  GRAPHIC_COLORS,
  GRAPHIC_EXIT_MS,
  GRAPHIC_MAX_ON_SCREEN,
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

/** A scene of ten elements and a camera track is well under this; the rest is the model's room to think. */
export const GRAPHIC_ANSWER_TOKENS = 4000

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

Return JSON only: {"scene": {"elements": [element, ...], "camera"?: [key, ...]}}.

Design rules:
- One idea per graphic. One element dominates (usually the figure); everything
  else supports it. A viewer gets it in the first second.
- Fewer elements beat more. Two or three on screen at once is common;
  ${GRAPHIC_MAX_ON_SCREEN} on screen at once is the ceiling, and ${MAX_GRAPHIC_ELEMENTS} across the whole slot.
- Size follows role. A figure's value grows to fill its box (it can be very
  large); a text's size is set by its role. Give the dominant element the most
  room; a figure box 6 to 10 columns wide and 3 to 5 rows tall reads as the hero.
- Balance. The grid already ends above the captions: use the whole grid.
  Compose around the middle: the composition's visual centre sits near row 6,
  with roughly equal empty space above and below it.
- Alignment. Every text and figure has an "align" (start, center or end). Align
  the elements that stack in one column the same way: a centred title over a
  centred figure over a centred caption, or all at start. A figure's caption
  ("label") aligns with its value.
- Emphasis. "underline" draws a solid bar under the element; use it on at most
  one element, on the word or figure the narrator stresses. "pulse" is for a
  figure that lands on a spoken number.
- Restraint. Every element must earn its place: no line that only restates
  another element, no decorative rule or shape unless it separates two compared
  things, no label that repeats the title.
- Portrait. The same scene plays in 9:16 for Shorts. When elements sit side by
  side in 16:9 (columns), give each a "portraitCell" that stacks them in the
  portrait frame, centred around row 6. A single-column design needs no portraitCell.
- Colour carries meaning: "collapse" for loss and failure, "recovery" for
  gain, "accent" or "captionHighlight" for the one thing to look at, "series0"
  to "series2" to tell compared things apart. Text is "textPrimary" or
  "textSecondary". Never colour for decoration.
- Time entrances to the words. Each slot comes with the words spoken in it and
  when; a figure should land as its number is said, a logo as its name is
  said. An element enters by "atMs" from the slot's start. An entrance may
  start at any time up to 600 ms before the slot ends, so it can finish.
- Keep a long graphic moving with the narration. A graphic on screen for more
  than about 8 s changes each time the words bring something new: an element
  enters or leaves, a bar grows, a colour shifts, or the camera moves. A long
  stretch where nothing changes while the narrator keeps talking is the
  failure to avoid.
- Build in steps. A step makes way for the next rather than piling up: give
  what the narration has finished with an "exit", and let the next element
  take its cell. Bars can arrive one at a time, each as its amount is named
  (an "atMs" on the item); the scale rescales as a bigger bar grows in.
- Move the camera to what is being said, never at random: push in on the
  element the narrator is talking about (a zoom above 1), or back out to
  "all". "all" and zoom 1 frame the whole composition as laid out; a push
  needs a zoom above 1. The camera rests on an element only while that
  element is on screen.
- Motion earns its place like everything else: one change for each new thing
  said, never motion for its own sake.
- Timing, all from the slot's start. An entrance takes 600 ms. If every
  entrance is at 0, the entrances are staggered 180 ms apart in scene order,
  so give real entrance times whenever an exit, a timed bar, an emphasis or a
  camera key depends on them. An emphasis lasts: pulse 360 ms, underline
  600 ms, colour 400 ms; the word forms play 600 ms (pulse) and 500 ms
  (underline) after the entrance starts. A timed emphasis starts after its
  element's entrance has finished and finishes by the slot's end. An exit
  starts once its element's entrance and emphasis have finished, and its
  ${GRAPHIC_EXIT_MS} ms end by the slot's end. A bar's own "atMs" is at or after its
  element's entrance, and its 700 ms growth finishes before its element
  starts to leave (or by the slot's end); at least one bar grows with the
  entrance. Camera keys run in order, at least 1.5 s apart, and each 1.5 s
  move ends by the slot's end; an element the camera rests on stays on screen
  until the next key (or the slot's end). When anything leaves, at least one
  element that is not a shape stays to the end.
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
- Words on screen say only what the narration or the cited claims say. Never
  add a fact, a judgement, a qualifier or a source note of your own ("never
  audited", "widely cited", "allegedly"): this is a film about real companies
  and real people, and no check reads your words, only your numbers.

Elements:
{"kind": "text", "id", "cell", "content" (max 120 chars), "role": ${GRAPHIC_TYPE_ROLES.map((r) => `"${r}"`).join('|')},
 "color", "align"?: "start"|"center"|"end", "enter"?, "exit"?, "emphasis"?}
{"kind": "figure", "id", "cell", "value" (exactly what is shown, e.g. "$4bn"), "label"?,
 "claimRef": claim number, "color", "align"?: "start"|"center"|"end", "enter"?, "exit"?, "emphasis"?}
{"kind": "logo", "id", "cell", "entity": the exact name, "enter"?, "exit"?, "emphasis"? (a pulse only)}
{"kind": "shape", "id", "cell", "form": "rect"|"rule"|"disc", "color", "opacity"?: 0.05-1, "exit"?, "emphasis"?}
{"kind": "bars", "id", "cell", "items": [{"label", "value": number, "display", "claimRef": claim number, "atMs"?}] (2 to 5),
 "color", "highlightIndex"?, "enter"?, "exit"?, "emphasis"?}
"cell" is {"col", "row", "colSpan", "rowSpan"} on a 12 by 12 grid (0-based).
"portraitCell" (optional, same shape) places the element on the 9:16 Shorts
frame; leave it out to let the layout stack elements in reading order.
"color" is one of ${GRAPHIC_COLORS.join(', ')}.
"enter" is {"kind": "fade"|"rise"|"wipe"|"count", "atMs"} ("count" only on a figure); an entrance takes 600 ms.
"exit" is {"kind": "fade"|"drop"|"wipe", "atMs"}: the element leaves, taking ${GRAPHIC_EXIT_MS} ms. Leave it out and the element stays to the end.
"emphasis" is "pulse"|"underline" (just after the entrance), or
 {"kind": "pulse"|"underline"|"color", "atMs", "to"?} at a time you choose. "color" shifts the element to the colour "to" names and keeps it; never on a logo. "underline" only on a text or a figure.
A bar item's "atMs" is when that bar grows in (700 ms), with its label and value; leave it out and it grows with the element.
"camera" (optional, on the scene) is up to 4 keys {"atMs", "focus": an element id or "all", "zoom"?: 1 to 1.6, default 1}; each starts a 1.5 s move to frame its focus, then holds. "all" and zoom 1 frame the whole composition as laid out.
Ids are unique; one logo per entity.

Example, a single number that is the story (one centred column; no portraitCell needed):
{"scene": {"elements": [
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 3, "colSpan": 10, "rowSpan": 1}, "content": "Raised in one round", "role": "title", "color": "textSecondary", "align": "center", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "figure", "id": "f", "cell": {"col": 1, "row": 4, "colSpan": 10, "rowSpan": 5}, "value": "$4bn", "label": "Series C", "claimRef": 3, "color": "accent", "align": "center", "enter": {"kind": "count", "atMs": 900}, "emphasis": "underline"}]}}

Example, two amounts compared:
{"scene": {"elements": [
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 3, "colSpan": 10, "rowSpan": 1}, "content": "2024 revenue", "role": "title", "color": "textSecondary", "align": "center", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "bars", "id": "b", "cell": {"col": 1, "row": 4, "colSpan": 10, "rowSpan": 5}, "items": [{"label": "Nvidia", "value": 130, "display": "$130bn", "claimRef": 4}, {"label": "Intel", "value": 53, "display": "$53bn", "claimRef": 7}], "color": "series0", "highlightIndex": 0, "enter": {"kind": "wipe", "atMs": 600}}]}}

Example, a relationship between named marks (side by side in 16:9, stacked in 9:16):
{"scene": {"elements": [
 {"kind": "logo", "id": "a", "cell": {"col": 1, "row": 3, "colSpan": 4, "rowSpan": 4}, "portraitCell": {"col": 2, "row": 2, "colSpan": 8, "rowSpan": 3}, "entity": "Acme", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "logo", "id": "b", "cell": {"col": 7, "row": 3, "colSpan": 4, "rowSpan": 4}, "portraitCell": {"col": 2, "row": 5, "colSpan": 8, "rowSpan": 3}, "entity": "Rival", "enter": {"kind": "fade", "atMs": 1400}},
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 8, "colSpan": 10, "rowSpan": 1}, "portraitCell": {"col": 1, "row": 9, "colSpan": 10, "rowSpan": 1}, "content": "Bought for $900m", "role": "body", "color": "textPrimary", "align": "center", "enter": {"kind": "rise", "atMs": 2200}}]}}

Example, a long slot built in steps (22.3 s; "bolder" said at 1.0 s, "back in the market" at 5.6 s, "4 billion" at 10.9 s, "Four times" at 14.2 s, "six months earlier" at 18.5 s):
{"scene": {"elements": [
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 3, "colSpan": 10, "rowSpan": 1}, "content": "Stability AI valuation", "role": "title", "color": "textSecondary", "align": "center", "enter": {"kind": "fade", "atMs": 1000}, "exit": {"kind": "fade", "atMs": 13700}},
 {"kind": "text", "id": "x", "cell": {"col": 1, "row": 3, "colSpan": 10, "rowSpan": 1}, "content": "Four times", "role": "title", "color": "accent", "align": "center", "enter": {"kind": "rise", "atMs": 14200}},
 {"kind": "bars", "id": "b", "cell": {"col": 1, "row": 4, "colSpan": 10, "rowSpan": 5}, "items": [{"label": "Oct 2022", "value": 1, "display": "$1bn", "claimRef": 5}, {"label": "Sought, 2023", "value": 4, "display": "$4bn", "claimRef": 6, "atMs": 10900}], "color": "series0", "highlightIndex": 1, "enter": {"kind": "wipe", "atMs": 5600}, "emphasis": {"kind": "color", "atMs": 14200, "to": "accent"}}],
 "camera": [{"atMs": 14200, "focus": "b", "zoom": 1.15}, {"atMs": 18500, "focus": "all"}]}}`

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
                // toPlannedScene writes a gone claim as 0, which the check
                // refuses; this says what to do with one (final review M3).
                'The current design, which the producer wants changed (claimRef 0: an element citing a claim no longer in the list must cite a listed claim or be dropped):\n' +
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

/** The shortest slot the mock builds in two steps (decision 290). */
export const MOCK_STAGED_MIN_MS = 8000

/**
 * Deterministic design for MOCK_PROVIDERS=1: the figure's digits truly come
 * from the cited claim. A slot of 8 s or more is built in two steps (decision
 * 290): halfway through, the title leaves, a second line takes its cell, and
 * the camera pushes in on the figure, so tests and e2e see a staged graphic
 * without spending.
 */
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
  const hasFigure = ref !== undefined && digits !== undefined
  const titleCell = { col: 0, row: 0, colSpan: 7, rowSpan: 2 }
  const staged = input.durationMs >= MOCK_STAGED_MIN_MS
  const half = Math.floor(input.durationMs / 2)
  const stepTwoAt = half + GRAPHIC_EXIT_MS
  return {
    elements: [
      {
        kind: 'text',
        id: 't1',
        cell: titleCell,
        content: title,
        role: 'title',
        color: 'textSecondary',
        align: 'start',
        enter: { kind: 'fade', atMs: 0 },
        ...(staged ? { exit: { kind: 'fade' as const, atMs: half } } : {}),
      },
      ...(staged
        ? [
            {
              kind: 'text' as const,
              id: 't2',
              cell: titleCell,
              content: '[mock] Then the next step',
              role: 'title' as const,
              color: 'textSecondary' as const,
              align: 'start' as const,
              enter: { kind: 'rise' as const, atMs: stepTwoAt },
            },
          ]
        : []),
      ...(hasFigure
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
    ...(staged && hasFigure ? { camera: [{ atMs: stepTwoAt, focus: 'f1', zoom: 1.2 }] } : {}),
  } as PlannedGraphicScene
}
