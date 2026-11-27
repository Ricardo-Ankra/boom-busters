import {
  HEADLINE_WORDS_MAX,
  PlannedPackageSchema,
  searchBriefLine,
  THUMBNAIL_IDEAS,
} from '@boom-busters/schemas'
import type { BibleInUse, PictureBrief, PlannedPackage, ThumbnailIdea } from '@boom-busters/schemas'
import { z } from 'zod'
import { exampleEntriesBlock, fillSlots, literalBibleText } from './bible'
import { parseJsonCompletion } from './json'
import { claimList } from './script'
import type { ScriptClaim } from './script'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The thumbnail set planner and the picture prompt (design 2026-11-24, 7.1 to
 * 7.3). One LLM request plans up to three packages, each a thumbnail and its
 * title on one idea; a second, plain text prompt goes to the image model for
 * one picture. Nothing here calls a provider.
 */

/** YouTube truncates at 100; anything longer would publish less than shown. */
const TITLE_MAX_CHARS = 100

/** What each idea means, one line each, in the order the schema lists them. */
const IDEA_MEANINGS: Record<ThumbnailIdea, string> = {
  person: 'person is a principal of the story, shown as themselves',
  figure: 'figure is the number the story turns on',
  object: 'object is the product, building or document at the centre of it',
  moment: 'moment is the turning point, the instant things changed',
  contrast: 'contrast is before and after',
}

/** A quoted one-line value, literal to `fillSlots`. */
const quoted = (text: string): string => literalBibleText(JSON.stringify(searchBriefLine(text)))

function titleFrameRules(
  frame: { pattern: string; required: readonly string[] } | undefined,
): string {
  if (!frame) return ''
  const required = frame.required.filter((value) => searchBriefLine(value) !== '')
  const lines = [
    `- Every title follows this pattern exactly, with its parts already filled: ${quoted(frame.pattern)}.`,
    ...(required.length > 0 ? [`- Every title contains: ${required.map(quoted).join(', ')}.`] : []),
  ]
  return `\n${lines.join('\n')}`
}

/** The cast, one line each, with the guardrail that governs how the person is drawn. */
function castBlock(cast: readonly { name: string; role: string; guardrail: string }[]): string {
  if (cast.length === 0) return 'Cast: nobody. Plan no person.'
  const lines = cast.map(
    (member) =>
      `- ${quoted(member.name)} (${quoted(member.role)})${
        member.guardrail.trim() !== '' ? `: ${quoted(member.guardrail)}` : ''
      }`,
  )
  return `Cast:\n${lines.join('\n')}`
}

/** The stills a picture may be built from, each with its slot id and who it shows. */
function stillsBlock(
  stills: readonly { slotId: string; shows: string; depicts: readonly string[] }[],
): string {
  if (stills.length === 0) return 'Stills: none. Name no still.'
  const lines = stills.map(
    (still) =>
      `- slot ${still.slotId}: ${quoted(still.shows)}; shows ${
        still.depicts.length > 0 ? still.depicts.map(quoted).join(', ') : 'nobody in the cast'
      }`,
  )
  return `Stills:\n${lines.join('\n')}`
}

export function buildThumbnailSetRequest(input: {
  /** The channel bible the project froze. */
  bible: BibleInUse
  /** The channel's name, from its row: the name is not part of the bible. */
  channelName: string
  caseTitle: string
  /** The hook the title has to live up to: the script's opening paragraph. */
  hook: string
  /** Verified claims, with the ids a package must cite. */
  claims: ScriptClaim[]
  /** The cast that is not dismissed, with each person's guardrail. */
  cast: { name: string; role: string; guardrail: string }[]
  /** The film's stills a picture can be built from. */
  stills: { slotId: string; shows: string; depicts: string[] }[]
  /** How many packages to plan: the free places. */
  places: number
  /** Ideas already in the set. */
  heldIdeas: ThumbnailIdea[]
  /** The format's title pattern, filled, for a master; absent changes nothing in the prompt. */
  titleFrame?: { pattern: string; required: readonly string[] }
  /** The channel's thumbnail style, in the owner's words. */
  styleNote: string
  /** What the style reference thumbnails show, one note each. */
  referenceNotes: string[]
  /** How earlier ideas performed, when the channel has tests to report. */
  pastResults?: string
}): LLMTaskRequest {
  const ideaLines = THUMBNAIL_IDEAS.map((idea) => `  - ${IDEA_MEANINGS[idea]}`).join('\n')
  const held = input.heldIdeas.length > 0 ? input.heldIdeas.join(', ') : 'none'
  const notes = input.referenceNotes.filter((note) => note.trim() !== '')
  const styleNote = input.styleNote.trim()

  const shape =
    'Return JSON: {"packages": [{"idea": "person|figure|object|moment|contrast", ' +
    '"angle": string, "title": string, "headline": string, ' +
    '"picture": {"subject": string, "framing": string, "textSide": "left|right", ' +
    '"stillSlotIds": [string], "depicts": [string]}, "claimIds": [string]}]}'

  const system = fillSlots(
    `You plan YouTube thumbnail packages for ${literalBibleText(input.channelName)}, a documentary
channel. A package is one thumbnail and its title, built on one idea. ${literalBibleText(input.bible.bible.titleStyle)} -
never clickbait the video cannot pay off, never ALL CAPS, no emoji.

${shape}

Return exactly ${input.places} packages.

Rules:
- A full set is three different ideas; never plan two packages on one idea. The ideas:
${ideaLines}
- Ideas already taken, never plan these again: ${held}.
- The thumbnail promises only what the claims support: every package names the claim ids it rests on in "claimIds", using the ids in the claim list, and every figure in the title or headline appears in a claim it names.
- A claim marked ALLEGED is an allegation: frame it as an allegation or a question, never as fact about a named person.
- A person may appear only if they are in the cast, and only with a still that shows them: "depicts" holds only a person who is in the cast, and "stillSlotIds" must include a still that shows that person. A picture with nobody named needs no still.
- The picture description must not name or describe a real person unless that person is listed in "depicts". A "person" package must list who is shown in "depicts". A person who is shown appears as in the named film still.
- The headline is at most ${HEADLINE_WORDS_MAX} words and adds to the title, never repeats it: the title carries the subject, the headline carries the tension.
- The title is at most ${TITLE_MAX_CHARS} characters.${titleFrameRules(input.titleFrame)}
- "picture.subject" says what fills the frame. "picture.textSide" is the side the headline will sit on, "left" or "right", chosen so the subject sits on the other side.
- "angle" is one sentence on why this idea is the right one for this story.${
      styleNote !== '' ? `\n- The channel's thumbnail style: ${quoted(styleNote)}.` : ''
    }${
      notes.length > 0
        ? `\n- The reference thumbnails show: ${notes.map(quoted).join('; ')}. Take their craft, never their subjects.`
        : ''
    }${exampleEntriesBlock("The channel's own titles, for the style", input.bible.bible.titles)}`,
    input.bible,
  )

  const past = input.pastResults?.trim() ?? ''
  return {
    task: 'metadata',
    system,
    messages: [
      {
        role: 'user',
        content: `Case: ${input.caseTitle}\n\nOpening hook:\n${input.hook}`,
      },
      { role: 'user', content: `Claims:\n${claimList(input.claims)}` },
      { role: 'user', content: castBlock(input.cast) },
      { role: 'user', content: stillsBlock(input.stills) },
      ...(past !== '' ? [{ role: 'user' as const, content: `Past results:\n${past}` }] : []),
    ],
    maxTokens: outputBudget(2500),
  }
}

/** Blank and whitespace-only entries removed from a list the planner may have padded. */
function withoutBlanks(value: unknown): unknown {
  return Array.isArray(value)
    ? value.filter((entry) => !(typeof entry === 'string' && entry.trim() === ''))
    : value
}

/** One planned entry with its picture's lists cleaned, before the schema sees it. */
function cleanEntry(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null) return entry
  const picture = (entry as { picture?: unknown }).picture
  if (typeof picture !== 'object' || picture === null) return entry
  const record = picture as Record<string, unknown>
  return {
    ...entry,
    picture: {
      ...record,
      depicts: withoutBlanks(record['depicts']),
      stillSlotIds: withoutBlanks(record['stillSlotIds']),
    },
  }
}

const SetEnvelopeSchema = z.object({ packages: z.array(z.unknown()) })

/**
 * The planner's packages out of a completion. An entry that fails the schema
 * is skipped, not thrown: the rules downstream vet what is left.
 */
export function parseThumbnailSet(text: string): PlannedPackage[] {
  const envelope = parseJsonCompletion(text, SetEnvelopeSchema, 'thumbnail set')
  const kept: PlannedPackage[] = []
  for (const entry of envelope.packages) {
    const result = PlannedPackageSchema.safeParse(cleanEntry(entry))
    if (result.success) kept.push(result.data)
  }
  return kept
}

/**
 * A mock set, obviously mock. Deterministic: ideas in schema order, skipping
 * `person` (a mock never names a face) and held ideas, cut to the free places.
 */
export function mockThumbnailSet(input: {
  workingTitle: string
  places: number
  heldIdeas: ThumbnailIdea[]
  claimIds: string[]
}): PlannedPackage[] {
  const stem = input.workingTitle.trim().slice(0, 48) || 'Untitled'
  const claimId = input.claimIds[0] ?? ''
  return THUMBNAIL_IDEAS.filter((idea) => idea !== 'person' && !input.heldIdeas.includes(idea))
    .slice(0, Math.max(0, input.places))
    .map((idea, index) => ({
      idea,
      angle: `[mock] The ${idea} idea for ${stem}.`,
      title: `[mock] ${stem}, the ${idea} version`,
      headline: `[mock] ${idea}`,
      picture: {
        // No stem: a working title that is a cast member's name would trip the name rule.
        subject: `[mock] a ${idea}`,
        framing: '',
        textSide: index % 2 === 0 ? ('left' as const) : ('right' as const),
        stillSlotIds: [],
        depicts: [],
      },
      claimIds: [claimId],
    }))
}

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`

/**
 * The text prompt for one picture. The order is fixed on purpose: the image
 * model follows the opening of a prompt and its framing over trailing
 * instructions, and a named detail pulls itself into the frame. So it opens
 * with the format, the subject's size and the clear third, then the subject,
 * then the people and the style, and closes on what must not appear.
 */
export function buildThumbnailPicturePrompt(input: {
  picture: PictureBrief
  styleNote: string
  guardrails: { name: string; guardrail: string }[]
  /** What actually travels with the request; a count of zero says nothing. */
  attached: { people: string[]; stills: number; styles: number }
}): string {
  const { picture, attached } = input
  const parts: string[] = [
    'A 16:9 photograph.',
    'The subject fills at least half the frame height.',
    `The ${picture.textSide} third is plain and uncluttered, kept clear for a headline.`,
    `${picture.subject.trim().replace(/[.]+$/, '')}.`,
  ]
  if (picture.framing.trim() !== '') parts.push(`${picture.framing.trim().replace(/[.]+$/, '')}.`)

  for (const guard of input.guardrails) {
    parts.push(guardrailLine(guard))
    if (attached.stills > 0) {
      parts.push(
        `Show ${guard.name} in the setting and situation of the attached film still, not in an invented one.`,
      )
    }
  }

  const travelling: string[] = []
  if (attached.people.length > 0) {
    travelling.push(
      `${plural(attached.people.length, 'portrait')} of ${attached.people.join(', ')}`,
    )
  }
  if (attached.stills > 0) travelling.push(`${plural(attached.stills, 'film still')}`)
  if (travelling.length > 0) {
    parts.push(`Attached for likeness and setting: ${travelling.join(' and ')}.`)
  }
  if (attached.styles > 0) {
    parts.push(
      `${plural(attached.styles, 'style reference image')} attached: take their lighting, colour and craft, never their subjects.`,
    )
  }
  if (input.styleNote.trim() !== '') parts.push(`Style: ${input.styleNote.trim()}`)

  parts.push(...closingLines(input.guardrails))
  return parts.join(' ')
}

/**
 * The text prompt for a change to a stored picture, which travels with it as
 * the image to edit. It opens with the edit and what stays, because the model
 * follows the opening of a prompt over its trailing lines, then repeats the
 * format, the people and the style, and closes on the same rules as a new picture.
 */
export function buildThumbnailChangePrompt(input: {
  note: string
  textSide: 'left' | 'right'
  styleNote: string
  guardrails: { name: string; guardrail: string }[]
  /** What actually travels with the request, besides the picture to edit. */
  attached: { people: string[] }
}): string {
  const parts: string[] = [
    'Edit the attached picture.',
    `Change only this: ${input.note.trim().replace(/[.]+$/, '')}.`,
    'Keep everything else as it is: the composition, the framing, the people, the light and the colour.',
    'A 16:9 photograph.',
    `The ${input.textSide} third stays plain and uncluttered, kept clear for a headline.`,
  ]
  for (const guard of input.guardrails) parts.push(guardrailLine(guard))
  if (input.attached.people.length > 0) {
    parts.push(
      `Attached for likeness: ${plural(input.attached.people.length, 'portrait')} of ${input.attached.people.join(', ')}.`,
    )
  }
  if (input.styleNote.trim() !== '') parts.push(`Style: ${input.styleNote.trim()}`)
  parts.push(...closingLines(input.guardrails))
  return parts.join(' ')
}

/** One person's line: what the picture shows of them, or that they appear as themselves. */
function guardrailLine(guard: { name: string; guardrail: string }): string {
  const text = guard.guardrail.trim()
  return `${guard.name}: ${text === '' ? 'shown as themselves.' : text}`
}

/** The two closing lines every picture prompt ends on. */
function closingLines(guardrails: { name: string }[]): string[] {
  const people =
    guardrails.length === 0
      ? 'No recognisable real person appears.'
      : `No recognisable real person appears other than ${guardrails.map((guard) => guard.name).join(', ')}.`
  return [people, 'No text, no letters, no logos, no watermark, no interface elements.']
}
