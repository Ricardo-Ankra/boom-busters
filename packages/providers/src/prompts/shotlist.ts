import {
  figureDigitGroups,
  HERO_SLOTS_ENABLED,
  PlannedSlotSchema,
  PlannedBriefSchema,
  renderDirectorsBook,
  STILL_GENERATIONS,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  BrandKitStored,
  DirectorsBook,
  PlannedBrief,
  PlannedSlot,
  ShotListOutput,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { claimList, type ScriptClaim } from './script'
import { DIRECTION_CRAFT } from './direction-craft'
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
 * Answer-token budget for a chapter's shot list, sized from its narration.
 *
 * The flat 8,000 the prompt shipped with was enough while a brief was a
 * query and a sentence. Under the Director's Book (decision 252) every brief
 * carries a shot size, and a still prompt carries three physical facts, the
 * era lock, palette, identity string, the Brand Kit anchors and a guardrail
 * line, so a slot runs 300 to 400 tokens and a six-minute chapter no longer
 * fits: the first live run cut off mid-JSON, three retries at full price.
 *
 * Slots are at least 4 s, so narration seconds / 5 is a generous count of how
 * many the model could plan; 400 tokens each is the long end of a still.
 * Over-asking costs nothing (max_tokens is a ceiling, the ledger settles on
 * tokens produced); under-asking costs the whole call. `outputBudget` adds
 * thinking headroom and clamps to the provider ceiling.
 */
export const SHOT_LIST_FLOOR_TOKENS = 8000
const SECONDS_PER_PLANNED_SLOT = 5
const TOKENS_PER_SLOT = 400

export function shotListAnswerTokens(paragraphs: readonly ShotParagraph[]): number {
  const narrationSeconds = paragraphs.reduce((sum, paragraph) => sum + paragraph.seconds, 0)
  const slots = Math.ceil(narrationSeconds / SECONDS_PER_PLANNED_SLOT)
  return Math.max(SHOT_LIST_FLOOR_TOKENS, slots * TOKENS_PER_SLOT)
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

  // Positive direction only. Two bans have been taken out of this string for
  // the same reason: it rides on every prompt, so a blanket "no identifiable
  // real faces" fought every likeness the bible asked for (decision 252), and
  // "no text, no logos, no watermarks" fought every company mark a film about
  // a company needs (decision 263). The bible decides both, per shot, and a
  // slot that truly needs an exclusion has its own negative prompt. "cinematic"
  // went with them: it is on the bible's banned list, so every still the
  // planner wrote warned about a word this function had supplied.
  return (
    `${grain}; muted documentary colour grade anchored on ${primary} and ${accent} ` +
    `against ${background}; sombre, photographic realism`
  )
}

function slotShapes(hasSets: boolean): string {
  return `Every slot: {"paragraphIndex": number, "seconds": number, "brief": {...}}

Every brief carries "shotSize": "wide"|"medium"|"close"|"macro"|"aerial"|"graphic"
(charts and maps are "graphic").

"brief" is one of, by "type":
- {"type": "stock", "coversText", "description", "shotSize", "motion", "transition",
   "query", "rejectionCriteria": [string]}
- {"type": "archival", "coversText", "description", "shotSize", "motion", "transition",
   "query", "mustShow", "eraRange"? (ONE string like "1995–2008", never an array)}
- {"type": "still", "coversText", "description", "shotSize", "motion", "transition",
   "prompt", "negativePrompt"?, "depicts"?: [each real person shown by likeness, by
   full name alone: "Jane Doe", never "Jane Doe, chief executive"]${
     hasSets ? ',\n   "set"?: the exact name of one set listed above, alone' : ''
   }}
- {"type": "hero", "coversText", "description", "shotSize", "motion", "transition",
   "prompt", "cameraMovement", "loop": boolean, "depicts"?} (only when hero is enabled)
- {"type": "chart", "coversText", "description", "motion", "transition",
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
- {"type": "map", "coversText", "description", "motion", "transition",
   "locations": [{"label", "lat": number, "lon": number}] (max 8),
   "route": boolean}
- {"type": "headline", "coversText", "description", "motion", "transition",
   "sourceRef": claim number}
- {"type": "graphic", "coversText", "description", "motion", "transition",
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

"motion" is {"kind": "static"} or {"kind": "kenburns", "direction": "in"|"out",
"speed": "slow"|"medium"|"fast"}. Never "pan": the renderer cannot do one.
"transition" is "cut" or "dissolve".`
}

export function buildShotListRequest(input: {
  caseTitle: string
  chapterTitle: string
  /** 1-based position in the script; names the Director's Book entry to follow. */
  chapterNumber?: number
  paragraphs: readonly ShotParagraph[]
  claims: readonly ScriptClaim[]
  /** From `stillStyleAnchors` — appended verbatim to every still prompt. */
  styleAnchors: string
  /** The per-film Director's Book (decision 252). Absent on projects planned before it. */
  direction?: DirectorsBook
  /**
   * Exact names of cast members the producer has photographed (decision 253).
   * Their stills are generated FROM those photographs, so their prompts must
   * carry no physical description at all: the photograph decides the face and
   * a written one only argues with it.
   */
  photographed?: readonly string[]
  /**
   * The film's sets (decision 264): the rooms it returns to, each held as
   * reference photographs. A brief that names one is generated with those
   * photographs attached, so the room is the same room every time. Absent
   * on a project with no sets, and then no rule about them is sent.
   */
  sets?: readonly { name: string; look: string }[]
  /**
   * Titles of the marks the logo library holds (decision 268, Plan B). A
   * graphic's "logo" may name anyone; naming one from this list means the
   * render finds the mark without an upload first.
   */
  logos?: readonly string[]
}): LLMTaskRequest {
  const paragraphList = input.paragraphs
    .map(
      (paragraph) =>
        `[paragraph ${paragraph.index} — ${Math.round(paragraph.seconds)}s of narration]\n${paragraph.text}`,
    )
    .join('\n\n')

  // The claim list and the book are the cacheable prefix: identical for every
  // chapter of one film, exactly like the drafting and self-check prompts.
  const photographed = (input.photographed ?? []).filter((name) => name.trim().length > 0)
  const sets = (input.sets ?? []).filter((set) => set.name.trim().length > 0)
  const logos = (input.logos ?? []).filter((title) => title.trim().length > 0)
  const prefix =
    `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` +
    (input.direction ? `\n\nDirector's book:\n${renderDirectorsBook(input.direction)}` : '') +
    (photographed.length > 0
      ? `\n\nPhotographed (the producer holds reference photographs of these people; ` +
        `their "Identity" line above is planning context for you and must never ` +
        `be written into a prompt):\n${photographed.map((name) => `- ${name}`).join('\n')}`
      : '') +
    (sets.length > 0
      ? `\n\nSets (the rooms this film returns to; the producer holds reference ` +
        `photographs of each, so naming one puts the shot in that exact room):\n` +
        sets.map((set) => `- ${set.name}: ${set.look}`).join('\n')
      : '') +
    (logos.length > 0
      ? `\n\nLogos (marks the producer holds; a graphic's "logo" names one exactly):\n` +
        logos.map((title) => `- ${title}`).join('\n')
      : '')

  const chapterHead =
    input.direction && input.chapterNumber !== undefined
      ? `This is chapter ${input.chapterNumber} of the book: follow its entry.\n\n`
      : ''

  return {
    task: 'shotlist',
    system: `You are planning the visuals for one chapter of a documentary about
a corporate collapse. The narration is already recorded; your slots are what is
on screen while it plays. The bible below is the house's fixed direction; the
Director's Book in the first message is this film's.

${DIRECTION_CRAFT}

Return JSON: {"slots": [...]}

${slotShapes(sets.length > 0)}

Planning rules:
- The sentence decides the frame. Read "coversText" before anything else and
  show what it says: the place it names, the object it mentions, the thing
  that happened, the person doing what the sentence says they did.
  A sentence that names a person shows that person, listed in "depicts".
- Stage an abstract sentence, never symbolise it. "Financial pressure and
  disagreements inside the boardroom" is the principals at the boardroom
  table; it is not a server, a chair or a document standing in for them.
  Only a sentence with no person and no place in it reaches for the book,
  and then for the chapter's location first and a motif last.
- The era lock is a constraint on what may appear, not a list to paste.
  Name only the period objects actually in your frame.
- Motifs are seasoning, not the meal. Use each motif at most once across the chapter,
  never in consecutive slots, and never as the subject of a frame unless the
  sentence is about it. A still whose sentence gives you a concrete subject
  needs no motif at all.
  There is no minimum: a chapter with no motif in it is fine.
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
- "still" is an AI-GENERATED image. Write the prompt as the bible's "What a
  still prompt must contain" says: prose, subject first, three physical
  facts, lens and light named, then the book's palette line (the era lock
  only limits which period objects you name; never paste its list), then
  these Brand Kit anchors verbatim: "${input.styleAnchors}".
  People come in three kinds and they never mix:
  (a) A name in "Photographed" above. Name them by full name and role, add
      "the person in the reference photo", and write NO physical description
      of them whatever: no age, build, height, hair, beard, glasses, skin or
      face. The photograph is the likeness and any written description fights
      it. Clothing, posture, place, light and what they are doing are still
      yours to direct. Stage them physically in the scene: seated in a chair
      or standing on the floor, at true scale, with any furniture between
      them and the camera in front of them. List them in "depicts" by name
      alone, never with the role after it: the name is how the photographs
      are found.
  (b) A named person NOT in that list. Name them by full name and role, then
      their identity string from the book as one sentence — with no
      photograph it is the only thing standing between the image and a
      stand-in. List them in "depicts" by name alone.
  (c) Anyone unnamed: investors, employees, staff, an aide, a driver, a
      crowd. No name and no identity string. Describe them by
      role, age range, build and clothing, with a natural, realistic face,
      visible and in focus, resembling no real or public person.
      Never blur, hide or turn a face away as a device.
${
  sets.length > 0
    ? `  Sets are the rooms this film returns to, and the producer holds
  photographs of each. When the sentence puts us in one,
  name it in "set" by name alone and write the shot that happens
  inside it: where the camera stands in the room and what part of it we
  see, who is there, what they are doing, the light.
  Name the room in the prompt as well, in the same words the list above
  uses, so the sentence and the photographs attached to it are plainly
  about one place.
  The photographs give the room's design, not the picture.
  Every still in a set is a new photograph from its own camera position,
  never the photographs' framing: "from the head of the table", "low across
  the table from the window side", "through the glass wall from the
  corridor", "close over one investor's shoulder".
  Two stills of the same room never share a camera position.
  Do not describe its walls, furniture, layout or materials; the
  photographs state those, and a written description only argues with
  them. Its light and weather are still yours. A sentence that happens
  somewhere else names no set: a room on every slot is the same mistake as
  a motif on every slot.
`
    : ''
}  Never quote the guardrail:
  it decides what you plan, not what the image model reads, and a model
  reads "never in handcuffs" as a request for handcuffs. Put its concrete
  nouns in "negativePrompt" instead.
  ${STILL_GENERATIONS} variants are generated per prompt.
- "headline" puts a REAL news headline on screen, in the house clipping
  format. Plan one where the narration leans on what a publication reported:
  "the Financial Times reported", "the paper found", "when the story broke".
  "sourceRef" is the NUMBER of the claim whose article it shows, and that
  claim must be marked NEWS ARTICLE in the list above; anything else has no
  article behind it to quote. You write NO part of the card: not the outlet,
  not the headline, not the byline, not the date. Those are read from the
  article itself, so inventing them is impossible rather than discouraged.
  AT MOST ONE headline shot per chapter, and never two in a row: it is a
  bright card in a dark film and it works by being rare.
- A "graphic" is for a beat that is one or two cited figures, a company's or a person's
  mark, or a relationship between named things (a before and after, a comparison of two or
  three amounts, three dated moments). It is never a chart with fewer points: a value moving
  through time is a "chart". Every "figure" and every "bars" item cites the claim NUMBER its
  value comes from, and the digits shown must appear in that claim. Colours and type roles
  are the names listed; there is no other styling. Six elements at most; leave the
  bottom two rows clear for captions. A "logo" names the company or person exactly as
  listed under Logos; if no mark is listed for them, still name them and the producer
  will upload it.
- Narration may contain bracketed tags — [pause], [sighs]. They are direction
  for the narrator, not content; never plan a visual around one and never quote
  one in "coversText".
${HERO_SLOTS_ENABLED ? '' : '- Never emit type "hero". It is disabled.\n'}`,
    messages: [
      { role: 'user', content: prefix },
      {
        role: 'user',
        content: `${chapterHead}Chapter "${input.chapterTitle}":\n\n${paragraphList}`,
      },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(shotListAnswerTokens(input.paragraphs)),
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
// Repair (decision 271)
// ---------------------------------------------------------------------------

export interface ShotRepairTarget {
  /** The brief as it stands, in planned or stored form. */
  brief: unknown
  /** What is wrong with it, in the words the plan screen uses. */
  problems: readonly string[]
}

/**
 * One corrective call for the briefs a chapter's craft check flagged.
 *
 * Built on the chapter's own shot-list request: the system prompt and the
 * cacheable prefix (the claim list and the book) are carried unchanged, so the
 * repair is asked under exactly the rules the plan was, and the automatic pass
 * that follows a plan is served that prefix from cache. The answer is briefs,
 * never slots, so a repair can change what a slot shows and never when.
 */
export function buildShotRepairRequest(
  base: LLMTaskRequest,
  targets: readonly ShotRepairTarget[],
  options: { allowStockToStill: boolean },
): LLMTaskRequest {
  const listing = targets
    .map(
      (target, at) =>
        `Brief ${at + 1}:\n${JSON.stringify(target.brief)}\nProblems:\n` +
        target.problems.map((problem) => `- ${problem}`).join('\n'),
    )
    .join('\n\n')
  const typeRule = options.allowStockToStill
    ? 'Keep each brief\'s "type", except that a "stock" brief whose problem names a person or a set may become a "still".'
    : 'Keep each brief\'s "type" exactly as it is.'
  return {
    ...base,
    messages: [
      ...base.messages,
      {
        role: 'user',
        content:
          'Some briefs in your plan for this chapter break the rules above. Rewrite ONLY ' +
          `these ${targets.length}, fixing every problem listed for each, and keep each ` +
          `brief's "coversText" exactly as it is.\n\n${listing}\n\n${typeRule}\n\n` +
          `Return JSON: {"briefs": [...]} holding exactly ${targets.length} brief ` +
          `object${targets.length === 1 ? '' : 's'}, one per brief above, in the same order.`,
      },
    ],
    maxTokens: outputBudget(Math.max(SHOT_LIST_FLOOR_TOKENS, targets.length * TOKENS_PER_SLOT)),
  }
}

const ShotRepairEnvelopeSchema = z.object({ briefs: z.array(z.unknown()) })

/** A sentence with its ends trimmed and every run of whitespace made one space. */
function normaliseSentence(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * The replacements, one per original, in order. `null` keeps the original:
 * a reply that is missing, malformed, changes a type the caller did not
 * allow, or answers a different sentence than the brief it sits against. A
 * repair can make a brief better and can never make one vanish or land on the
 * wrong slot: a model that skips a brief shifts every later answer up one,
 * and the sentence is how that shift shows, so a reply whose `coversText`
 * differs from the original's (beyond whitespace) is refused rather than
 * overwritten. An accepted reply carries the original `coversText` exactly,
 * because the board anchors a slot to its sentence by it.
 *
 * Stock may become a still only when the call allows it AND the original is
 * cleared for it (`mayBecomeStill`, from the schemas predicate of that name),
 * so the job never retypes more slots than the button disclosed.
 *
 * Throws on an answer that is not JSON at all; the caller decides whether
 * that keeps the plan (the automatic pass) or reports a failure (the button).
 */
export function parseShotRepair(
  text: string,
  originals: readonly { type: string; coversText: string; mayBecomeStill?: boolean }[],
  options: { allowStockToStill: boolean },
): (PlannedBrief | null)[] {
  const envelope = parseJsonCompletion(text, ShotRepairEnvelopeSchema, 'shot repair')
  return originals.map((original, at) => {
    const parsed = PlannedBriefSchema.safeParse(envelope.briefs[at])
    if (!parsed.success) return null
    if (normaliseSentence(parsed.data.coversText) !== normaliseSentence(original.coversText)) {
      return null
    }
    const next = parsed.data.type
    const allowed =
      next === original.type ||
      (options.allowStockToStill &&
        original.type === 'stock' &&
        next === 'still' &&
        original.mayBecomeStill === true)
    return allowed ? { ...parsed.data, coversText: original.coversText } : null
  })
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
  /**
   * 1-based positions of claims a headline card may cite (decision 257). The
   * mock cannot judge that itself, and a mock slot the runner then rejects
   * would make the offline board disagree with the live one.
   */
  newsClaimRefs?: readonly number[]
  /** The claim list's text, in prompt order, so the mock graphic's figure truly cites claim 1. */
  claimTexts?: readonly string[]
  /** Titles the logo library holds (decision 268, Plan B); the mock names the first one. */
  logoTitles?: readonly string[]
}): ShotListOutput {
  const slots: ShotListOutput['slots'] = input.paragraphs.map((paragraph, index) => ({
    paragraphIndex: paragraph.index,
    seconds: Math.max(4, Math.min(15, paragraph.seconds)),
    brief: {
      type: 'stock',
      coversText: paragraph.text.slice(0, 120) || '[mock] empty paragraph',
      description:
        '[mock] Deserted open-plan office at dusk, cool blue grade, empty desks. ' +
        'No provider planned this slot.',
      // Alternating sizes, so the plan lint has something honest to read.
      shotSize: index % 2 === 0 ? 'wide' : 'medium',
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
        shotSize: 'graphic',
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
        shotSize: 'graphic',
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

  // A composed graphic in mock mode, so the board and the e2e run exercise
  // it too. The figure's digits truly come from the cited claim's text
  // (decision 268, Plan B): `figureCitesClaim` checks this for real on the
  // live path, and a mock that invented its own digits would let a graphic
  // that fails that check ship untested. A claim with no digits gets no
  // graphic, because a figure that cites nothing would be rejected and
  // silently dropped.
  const graphicClaimText = input.claimTexts?.[0] ?? ''
  const graphicDigits = figureDigitGroups(graphicClaimText)[0]
  if (first && input.claimCount > 0 && graphicDigits !== undefined) {
    const value = graphicClaimText.toLowerCase().includes('billion')
      ? `$${graphicDigits}bn`
      : graphicDigits
    const logoTitle = input.logoTitles?.[0]

    slots.push({
      paragraphIndex: first.index,
      seconds: 6,
      brief: {
        type: 'graphic',
        coversText: first.text.slice(0, 120) || '[mock] empty paragraph',
        description: '[mock] The figure, large, with the mark beside it.',
        shotSize: 'graphic',
        motion: { kind: 'static' },
        transition: 'cut',
        scene: {
          elements: [
            {
              kind: 'text',
              id: 't1',
              cell: { col: 0, row: 0, colSpan: 7, rowSpan: 2 },
              content: '[mock] Raised in one round',
              role: 'title',
              color: 'textSecondary',
              align: 'start',
              enter: { kind: 'fade', atMs: 0 },
            },
            {
              kind: 'figure',
              id: 'f1',
              cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
              value,
              claimRef: 1,
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
      },
    })
  }

  // A headline card in mock mode, so the board and the e2e run have one to
  // show. Mirrors the real rule: it cites a claim, and nothing else.
  if (second && input.newsClaimRefs && input.newsClaimRefs.length > 0) {
    slots.push({
      paragraphIndex: second.index,
      seconds: 7,
      brief: {
        type: 'headline',
        coversText: second.text.slice(0, 120) || '[mock] empty paragraph',
        description: '[mock] The morning the story broke.',
        shotSize: 'graphic',
        motion: { kind: 'static' },
        transition: 'cut',
        sourceRef: input.newsClaimRefs[0] as number,
      },
    })
  }

  return { slots }
}
