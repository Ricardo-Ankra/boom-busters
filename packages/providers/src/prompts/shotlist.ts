import {
  HERO_SLOTS_ENABLED,
  PlannedSlotSchema,
  STILL_GENERATIONS,
  ValidationError,
} from '@boom-busters/schemas'
import type { BrandKitStored, PlannedSlot, ShotListOutput } from '@boom-busters/schemas'
import { z } from 'zod'
import { claimList, type ScriptClaim } from './script'
import { formatIssues, parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The shot-list prompt (build spec section 7.4): the approved script becomes
 * a timed visual plan, one Haiku call per chapter.
 *
 * Per chapter rather than whole-script for the same reasons the self-check
 * runs per chapter: the claim list is the shared cacheable prefix, one bad
 * output re-buys one chapter's plan rather than the whole board, and a
 * chapter's slots fan out to resolution the moment its plan lands.
 *
 * The model plans against paragraphs, never against milliseconds. It sees
 * each paragraph's narration length in seconds (real numbers — the voice
 * stage has already been approved, so every duration is a measured take, not
 * an estimate) and anchors each slot to a paragraph index. The runner turns
 * those anchors into start times deterministically; asking a language model
 * to do timeline arithmetic is asking for drift.
 */

export interface ShotParagraph {
  index: number
  text: string
  /** Measured narration length of this paragraph, from its approved take. */
  seconds: number
}

/**
 * Brand Kit → the style anchors every still prompt must carry, so generated
 * frames sit in the channel's look rather than each inventing their own.
 * Composed from the tokens that read as photography direction: grain and the
 * palette's dominant colours.
 */
export function stillStyleAnchors(brandKit: BrandKitStored): string {
  const { grainPreset } = brandKit.look
  const { primary, accent, background } = brandKit.colors
  const grain = grainPreset === 'none' ? 'clean, no grain' : `${grainPreset} film grain`

  return (
    `${grain}; muted documentary colour grade anchored on ${primary} and ${accent} ` +
    `against ${background}; cinematic, sombre, photographic realism; no text, no logos, ` +
    'no watermarks, no identifiable real faces'
  )
}

const SLOT_SHAPES = `Every slot: {"paragraphIndex": number, "seconds": number, "brief": {...}}

"brief" is one of, by "type":
- {"type": "stock", "coversText", "description", "motion", "transition",
   "query", "rejectionCriteria": [string]}
- {"type": "archival", "coversText", "description", "motion", "transition",
   "query", "mustShow", "eraRange"? (ONE string like "1995–2008", never an array)}
- {"type": "still", "coversText", "description", "motion", "transition",
   "prompt", "negativePrompt"?}
- {"type": "chart", "coversText", "description", "motion", "transition",
   "chartKind": "line"|"area"|"bar"|"stacked"|"waterfall",
   "series": [{"label", "unit", "points": [{"x": string, "y": number}]}],
   "dataRefs": [claim number], "takeaway",
   "annotations"?: [{"atX", "text"}], "reveal": "draw-on"|"none"}
- {"type": "map", "coversText", "description", "motion", "transition",
   "locations": [{"label", "lat": number, "lon": number}] (max 8),
   "route": boolean}

"motion" is {"kind": "static"} or {"kind": "kenburns", "direction": "in"|"out",
"speed": "slow"|"medium"|"fast"} or {"kind": "pan", "path": string}.
"transition" is "cut" or "dissolve".`

export function buildShotListRequest(input: {
  caseTitle: string
  chapterTitle: string
  paragraphs: readonly ShotParagraph[]
  claims: readonly ScriptClaim[]
  /** From `stillStyleAnchors` — appended verbatim to every still prompt. */
  styleAnchors: string
}): LLMTaskRequest {
  const paragraphList = input.paragraphs
    .map(
      (paragraph) =>
        `[paragraph ${paragraph.index} — ${Math.round(paragraph.seconds)}s of narration]\n${paragraph.text}`,
    )
    .join('\n\n')

  return {
    task: 'shotlist',
    system: `You are planning the visuals for one chapter of a documentary about
a corporate collapse. The narration is already recorded; your slots are what is
on screen while it plays.

Return JSON: {"slots": [...]}

${SLOT_SHAPES}

Planning rules:
- Cover every paragraph. A slot runs 4-15 seconds ("seconds" is always a
  positive number); a paragraph's slots should add up to roughly its narration
  length.
- Each brief is a full creative direction, not a keyword: subject, composition,
  era, mood, lighting and colour grade in "description". "coversText" quotes
  the sentence(s) the slot plays under, EXACTLY as written.
- Prefer "chart" wherever the narration cites numbers and "map" wherever it
  moves between places — these carry the story better than another stock shot.
- "chart" is the strictest type: every value in "series" must appear in the
  claim list below, verbatim — never estimate, interpolate or invent a number.
  "dataRefs" lists the claim NUMBERS (e.g. [3, 7]) the values come from. If the
  claims do not contain the numbers, do not make a chart. Every series needs at
  least two points — a single figure is not a chart; put it in a stock or still
  slot instead.
- "stock" queries are 2-5 concrete words; "rejectionCriteria" names what would
  make a result unusable (watermarks, wrong era, modern tech in a period
  segment, identifiable faces).
- "archival" is REAL footage or photographs of the actual subject — named
  buildings, events, people — that the producer sources and uploads by hand.
  Nothing is fetched for these slots (decision 214): "query" is guidance on
  where to look and what to search for, "mustShow" is the test the upload
  must pass. Plan one only where authenticity is the point; every archival
  slot is manual work for a human.
- "still" is an AI-GENERATED image. Prompts describe one photographable
  moment in full. Append these style anchors to every prompt verbatim:
  "${input.styleAnchors}".
  ${STILL_GENERATIONS} variants are generated per prompt.
- Narration may contain bracketed tags — [pause], [sighs]. They are direction
  for the narrator, not content; never plan a visual around one and never quote
  one in "coversText".
${HERO_SLOTS_ENABLED ? '' : '- Never emit type "hero". It is disabled.\n'}`,
    messages: [
      // The claim list is the cacheable prefix — identical for every chapter
      // of the same project, exactly like the drafting and self-check prompts.
      { role: 'user', content: `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` },
      { role: 'user', content: `Chapter "${input.chapterTitle}":\n\n${paragraphList}` },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(8000),
  }
}

export interface ShotListParse {
  slots: PlannedSlot[]
  /** Slots dropped because their JSON matched no brief shape, with why. */
  malformed: { index: number; reason: string }[]
}

const ShotListEnvelopeSchema = z.object({
  slots: z.array(z.unknown()).min(1, 'a chapter with narration needs at least one slot'),
})

/**
 * Slot-by-slot rather than one strict parse of the whole list, learned from
 * the first real board: live Haiku's malformations are habits, not noise — a
 * one-point chart series, a zero-second slot — so a retry re-buys the whole
 * chapter's plan and gets the same habit back. Five retries on one chapter
 * failed that way, and the failed *chapter* killed the run. A malformed slot
 * costs a gap on the board that a card can repair; it is never worth the
 * chapter.
 *
 * The envelope stays strict: no JSON, or no slot array at all, is a broken
 * completion, and so is a list where *every* slot is malformed — those throw,
 * and the retry buys a genuinely fresh answer.
 */
export function parseShotList(text: string): ShotListParse {
  const envelope = parseJsonCompletion(text, ShotListEnvelopeSchema, 'shot list')

  const slots: PlannedSlot[] = []
  const malformed: { index: number; reason: string }[] = []
  for (const [index, raw] of envelope.slots.entries()) {
    const result = PlannedSlotSchema.safeParse(raw)
    if (result.success) slots.push(result.data)
    else malformed.push({ index, reason: formatIssues(result.error) })
  }

  if (slots.length === 0) {
    throw new ValidationError(
      `Every slot in the model's shot list was malformed: ${malformed
        .slice(0, 3)
        .map((slot) => `slot ${slot.index} — ${slot.reason}`)
        .join('; ')}`,
      { field: 'shot list' },
    )
  }

  return { slots, malformed }
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/**
 * Mock shot list: one stock slot per paragraph, plus a chart on the first
 * paragraph when any claims exist and a map on the second when there is one.
 *
 * The chart and map are there for the same reason the mock self-check warns:
 * a mock that only ever emitted stock slots would let the chart error card,
 * the claim chips and the map preview all ship untested, and would teach the
 * reviewer that the board is a wall of photographs.
 */
export function mockShotList(input: {
  paragraphs: readonly ShotParagraph[]
  claimCount: number
}): ShotListOutput {
  const slots: ShotListOutput['slots'] = input.paragraphs.map((paragraph) => ({
    paragraphIndex: paragraph.index,
    seconds: Math.max(4, Math.min(15, paragraph.seconds)),
    brief: {
      type: 'stock',
      coversText: paragraph.text.slice(0, 120) || '[mock] empty paragraph',
      description:
        '[mock] Deserted open-plan office at dusk, cool blue grade, empty desks. ' +
        'No provider planned this slot.',
      motion: { kind: 'kenburns', direction: 'in', speed: 'slow' },
      transition: 'cut',
      query: 'empty office dusk',
      rejectionCriteria: ['no watermarks', 'no identifiable faces'],
    },
  }))

  const [first, second] = input.paragraphs

  if (first && input.claimCount > 0) {
    slots.push({
      paragraphIndex: first.index,
      seconds: 8,
      brief: {
        type: 'chart',
        coversText: first.text.slice(0, 120) || '[mock] empty paragraph',
        description: '[mock] Share-price collapse, drawn on in the accent colour.',
        motion: { kind: 'static' },
        transition: 'dissolve',
        chartKind: 'line',
        series: [
          {
            label: '[mock] Share price',
            unit: 'EUR',
            points: [
              { x: '2020-06-17', y: 104.5 },
              { x: '2020-06-22', y: 14.44 },
              { x: '2020-06-26', y: 1.28 },
            ],
          },
        ],
        dataRefs: [1],
        takeaway: '[mock] The nine-day collapse.',
        reveal: 'draw-on',
      },
    })
  }

  if (second) {
    slots.push({
      paragraphIndex: second.index,
      seconds: 6,
      brief: {
        type: 'map',
        coversText: second.text.slice(0, 120) || '[mock] empty paragraph',
        description: '[mock] The money moves from Munich to Manila.',
        motion: { kind: 'static' },
        transition: 'cut',
        locations: [
          { label: 'Munich', lat: 48.14, lon: 11.58 },
          { label: 'Manila', lat: 14.6, lon: 120.98 },
        ],
        route: true,
      },
    })
  }

  return { slots }
}
