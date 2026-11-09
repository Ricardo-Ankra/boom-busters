import {
  LAST_RESORT_TECHNIQUES,
  MOTION_MS,
  isHouseTechnique,
  MotionIdentityDraftSchema,
  ReferenceReadingEditSchema,
} from '@boom-busters/schemas'
import type {
  MotionIdentity,
  MotionIdentityDraft,
  ReferencePurpose,
  ReferenceReading,
  ReferenceReadingEdit,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { outputBudget, type LLMTaskRequest, type MsgImage } from '../llm/types'
import { parseJsonCompletion } from './json'

/**
 * The two motion prompts (spec 2026-11-04, sections 7.3 and 8.4).
 *
 * A reading is the model's study notes on one reference's window: its
 * grammar, never its content. The reader is shown the dense sheet and a few
 * single frames and answers text only; the reading is what the identity
 * draft and, later, the derivation read, so a reference's pixels never reach
 * a per-shot call.
 *
 * The identity draft proposes the whole `MotionIdentity` from the readings,
 * the owner's brief, the brand's colours and fonts and the catalogue. It is
 * parsed through the identity schema, so every bound holds and the two last
 * resorts stay in the techniques. Both run on the `graphics` route.
 */

export const READING_INPUT_TOKENS = 9000
export const READING_OUTPUT_TOKENS = 1200
export const DRAFT_OUTPUT_TOKENS = 2500

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export interface ReferenceForReading {
  title: string
  purpose: ReferencePurpose
  negative: boolean
  carryOver: string
  avoid: string
  /** The marked window's length; null for a still. */
  windowMs: number | null
}

export interface ReadingImages {
  denseSheet: MsgImage | null
  frames: { atMs: number; image: MsgImage }[]
}

const READING_SYSTEM = [
  'You read motion-graphics references for a video channel and write a one-page reading of each.',
  'A reading is study notes on the grammar of what you see: the medium, the palette, the type, how text enters and leaves, what moves and how fast, what holds, and what the clip does not do.',
  'It is never about the content. Name no brand, product, person, logo, title or word that appears on screen; describe the shape of the text, not what it says. Nothing you write will be copied into a film; it tells a designer what to borrow.',
  'Text only. Answer one JSON object and nothing else, with these keys:',
  '- "medium": the kind of image (flat vector, photographic, 3D, textured paper, film grain), in one sentence.',
  '- "palette": up to six colours as hex or plain words, darkest first.',
  '- "type": the typeface family in words (grotesk, serif, mono), its weight, case and spacing, in one sentence.',
  '- "enters": how things arrive, with the length in words (a quarter second, slow), in one or two sentences.',
  '- "exits": how things leave, in one or two sentences.',
  '- "motion": what moves and how fast, what holds and for how long, what the camera does, in up to three sentences.',
  '- "absent": what this clip does not do that others do (no glow, no blur, no overshoot, nothing decorative), in one sentence.',
  '- "notes": anything else a designer should borrow or avoid, under 800 characters. For a negative reference, say what must not be copied.',
  'Each of medium, type, enters, exits, motion and absent is under 400 characters.',
  'Write plainly. Use no dash characters.',
].join('\n')

/** The reference's window, read once. */
export function buildReferenceReadingRequest(
  reference: ReferenceForReading,
  images: ReadingImages,
): LLMTaskRequest {
  const listed: string[] = []
  const attached: MsgImage[] = []
  if (images.denseSheet) {
    listed.push(
      'Image 1: the dense sheet, every frame of the marked window a twelfth of a second apart, left to right then down, with its time under each tile.',
    )
    attached.push(images.denseSheet)
  }
  for (const frame of images.frames) {
    listed.push(`Image ${attached.length + 1}: Frame at ${seconds(frame.atMs)}, full size.`)
    attached.push(frame.image)
  }
  const what =
    reference.windowMs === null
      ? 'A still. It teaches look, not motion: read enters, exits and motion from what the composition implies, and say so.'
      : `A clip's marked window of ${seconds(reference.windowMs)}.`
  const content = [
    `Reference: "${reference.title}".`,
    what,
    `Purpose: ${reference.purpose}.${reference.negative ? ' This is a negative reference: it shows what the channel must not do.' : ''}`,
    `The owner's carry-over line: ${reference.carryOver}`,
    reference.avoid ? `The owner's avoid line: ${reference.avoid}` : '',
    '',
    `${attached.length} image${attached.length === 1 ? '' : 's'}, in this order:`,
    ...listed,
    '',
    'Write the reading.',
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
  return {
    task: 'graphics',
    system: READING_SYSTEM,
    messages: [{ role: 'user', content, images: attached }],
    maxTokens: outputBudget(READING_OUTPUT_TOKENS),
  }
}

const LINE_MAX = 400
const NOTES_MAX = 800
const PALETTE_MAX = 6

const cut = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** The reading as answered, every field trimmed to its limit and a missing one empty. */
export function parseReferenceReading(text: string): ReferenceReadingEdit {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'reference reading')
  const palette = Array.isArray(raw['palette'])
    ? raw['palette']
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().slice(0, 40))
        .filter((entry) => entry.length > 0)
        .slice(0, PALETTE_MAX)
    : []
  return ReferenceReadingEditSchema.parse({
    medium: cut(raw['medium'], LINE_MAX),
    palette,
    type: cut(raw['type'], LINE_MAX),
    enters: cut(raw['enters'], LINE_MAX),
    exits: cut(raw['exits'], LINE_MAX),
    motion: cut(raw['motion'], LINE_MAX),
    absent: cut(raw['absent'], LINE_MAX),
    notes: cut(raw['notes'], NOTES_MAX),
  })
}

/** Mock mode's reading: marked, and carrying the owner's own line so the draft has something to read. */
export function mockReferenceReading(reference: ReferenceForReading): ReferenceReadingEdit {
  return {
    medium: '[mock] flat typography on a plain ground',
    palette: ['#111111', '#f2f2f2'],
    type: '[mock] a grotesk, heavy, tight',
    enters: '[mock] rises a little and settles',
    exits: '[mock] a hard cut',
    motion: `[mock] one thing holds while another changes; a ${reference.purpose} reference`,
    absent: '[mock] no glow, no blur, no overshoot',
    notes: `[mock] Carry over: ${reference.carryOver}${reference.avoid ? `. Avoid: ${reference.avoid}` : ''}`,
  }
}

export interface ReadingForDraft {
  title: string
  purpose: ReferencePurpose
  negative: boolean
  carryOver: string
  avoid: string
  reading: ReferenceReading | null
}

export interface IdentityDraftInput {
  current: MotionIdentity
  brief: string
  readings: ReadingForDraft[]
  brand: { colors: Record<string, string>; fonts: Record<string, string> }
  techniques: { technique: string; description: string }[]
}

const HOUSE_LENGTHS = (['enter', 'exit', 'reveal', 'draw', 'count', 'move', 'gap'] as const)
  .map((key) => `${key} ${MOTION_MS[key]}`)
  .join(', ')

function draftSystem(techniques: IdentityDraftInput['techniques']): string {
  const catalogue = techniques.map((entry) => `- ${entry.technique}: ${entry.description}`)
  return [
    "You draft a video channel's motion identity: the handful of settings every motion graphic on the channel is designed and checked with.",
    "You are given the readings of the references the owner chose, the owner's brief, the brand's colours and fonts, the technique catalogue and the current identity. Propose the whole identity, not a patch.",
    'Answer one JSON object and nothing else: {"identity": {...}, "why": "..."}.',
    "The identity's fields and their bounds:",
    '- "signatureEase": "soft" (arrivals settle long, moves ease both ways), "crisp" (arrivals snap in, moves ease hard) or "gentle" (sine curves, nothing abrupt).',
    `- "ms": overrides on the house lengths in milliseconds, each 40 to 3000, for "enter", "exit", "reveal", "draw", "count", "move" and "gap". Leave a key out to keep the house value. The house: ${HOUSE_LENGTHS}.`,
    '- "overshoot": "none" (every spring settles without passing its mark), "hair" (the hero once per beat, a snap on small things) or "welcome" (loose springs).',
    '- "entrance": "rise" (a fade with a small lift), "fade", "scale" (in from 90%), "wipe" (a clip-path reveal) or "slide" (in from the side).',
    '- "changeEveryMs": something changes about this often, 500 to 10000.',
    '- "stillMaxMs": a graphic in which nothing changes for longer is refused, 1000 to 20000 and at least changeEveryMs.',
    '- "cameraRule": under 200 characters completing the sentence "and the camera ...", for example "never moves" or "never stops: a slow push over the whole slot".',
    '- "blurFollowsSpeed": true or false.',
    '- "threeD": "never", "whenMeaningful" or "welcome".',
    '- "never": up to 16 phrases of up to 60 characters the designer must not use. "allow": up to 16 phrases taken out of the house never list (glows, particle bursts, lens flares, camera shake, RGB split, a crossfade from one whole layout to another, decorative gradients, drop shadows for depth). A phrase goes in one list, not both.',
    '- "styleGuideMd": up to 4000 characters of plain prose the designer and the critic read on every call: what the channel\'s graphics look and move like, in the owner\'s register, drawn from the readings. No headings needed.',
    '- "techniques": the techniques this channel designs with, chosen from the catalogue below. Always include kinetic-word-stack and bar-chart; they are the fallbacks every slot can reach.',
    '- "chartsConventional": true keeps bars rising from the baseline and lines drawing on, with no gridlines, ticks or travelling bars.',
    'The catalogue:',
    ...catalogue,
    '"why" is under 1200 characters: what in the readings and the brief led to each choice that differs from the current identity, and why a technique was left out.',
    'Keep a current value when nothing argues against it. Write plainly. Use no dash characters.',
  ].join('\n')
}

function readingBlock(entry: ReadingForDraft, index: number): string {
  const head = `Reference ${index + 1}: "${entry.title}" (${entry.purpose}${entry.negative ? ', negative' : ''}). Carry over: ${entry.carryOver}.${entry.avoid ? ` Avoid: ${entry.avoid}.` : ''}`
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

/** The identity proposed from the readings and the brief, one call. */
export function buildMotionIdentityDraftRequest(input: IdentityDraftInput): LLMTaskRequest {
  const colours = Object.entries(input.brand.colors)
    .map(([role, value]) => `${role} ${value}`)
    .join(', ')
  const fonts = Object.entries(input.brand.fonts)
    .map(([role, value]) => `${role} ${value}`)
    .join(', ')
  const readings =
    input.readings.length === 0
      ? 'No references yet: draft from the brief and the brand alone.'
      : input.readings.map(readingBlock).join('\n\n')
  const content = [
    `The owner's brief: ${input.brief || '(none)'}`,
    '',
    `The brand's colours: ${colours || 'house'}.`,
    `The brand's fonts: ${fonts || 'house'}.`,
    '',
    readings,
    '',
    'The current identity:',
    '```json',
    JSON.stringify(input.current, null, 2),
    '```',
    '',
    'Propose the identity.',
  ].join('\n')
  return {
    task: 'graphics',
    system: draftSystem(input.techniques),
    messages: [{ role: 'user', content }],
    maxTokens: outputBudget(DRAFT_OUTPUT_TOKENS),
  }
}

/**
 * The proposal, read through the identity schema: a refused bound is a
 * refused answer. The model chooses from the catalogue, so the channel's own
 * keys in `keep` (spec 8.5) are appended when the draft left them out.
 */
export function parseMotionIdentityDraft(
  text: string,
  keep: readonly string[] = [],
): MotionIdentityDraft {
  const draft = parseJsonCompletion(text, MotionIdentityDraftSchema, 'motion identity draft')
  // The draft chooses from the catalogue (spec 8.4); a key of the channel's own
  // stays in use whether or not the draft named it, and a key the model made
  // up, which no version holds, is dropped (spec 8.5).
  const own = new Set(keep.filter((key) => !isHouseTechnique(key)))
  const chosen = draft.identity.techniques.filter((key) => isHouseTechnique(key) || own.has(key))
  const kept = [...own].filter((key) => !chosen.includes(key))
  return { ...draft, identity: { ...draft.identity, techniques: [...chosen, ...kept] } }
}

/** Mock mode's draft: the current identity with the brief folded into the style guide. */
export function mockMotionIdentityDraft(input: IdentityDraftInput): MotionIdentityDraft {
  const techniques = [...input.current.techniques]
  for (const key of LAST_RESORT_TECHNIQUES) if (!techniques.includes(key)) techniques.push(key)
  return {
    identity: {
      ...input.current,
      techniques,
      styleGuideMd: `[mock] ${input.brief}`.slice(0, 4000),
    },
    why: '[mock] The brief, folded into the style guide; everything else kept.',
  }
}
