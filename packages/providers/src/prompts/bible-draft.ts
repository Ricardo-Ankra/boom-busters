import {
  BIBLE_SECTIONS,
  ChannelBibleSchema,
  EMPTY_BIBLE,
  EXAMPLE_SLOTS,
  FIRST_CHANNEL_BIBLE,
  sectionIsEmpty,
} from '@boom-busters/schemas'
import type {
  BibleDraftInputs,
  BibleDraftUnit,
  BibleResearchDigest,
  BibleSection,
  ChannelBible,
  ExampleSlot,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
import { fillSlots, literalBibleText } from './bible'
import { parseJsonCompletion } from './json'

/**
 * Drafting a channel's bible one unit at a time: a section, or one craft
 * file's group of example slots. This builds the request and parses the
 * answer; nothing here calls a model.
 */

const FIELD_NOTES: Record<keyof ChannelBible, string> = {
  subject: 'string: what the channel is about, as a short plain phrase',
  whatACaseIs:
    'string: what makes a subject worth a film here, and what makes one a bad fit, in two or three sentences',
  subjectKind: 'string: what kind of thing each film is about, and how its common name is chosen',
  subjectNoun: "object { singular: string, plural: string }: the one word for a film's subject",
  audience: 'string: who watches, in one line',
  narrationRegister: "string: the narrator's manner, a few plain adjectives",
  voiceDos: 'array of up to 12 strings, each up to 300 characters: things the narration does',
  voiceDonts:
    'array of up to 12 strings, each up to 300 characters: things the narration never does',
  hedgingRules:
    "string: the channel's rules for claims it cannot fully stand behind, as short bullet lines",
  visualRegister: 'string: the look of the films, as one paragraph a picture editor could follow',
  examples: 'object keyed by example id (see the examples listed below)',
  hooks:
    'array of up to 12 entries { text: string, note: string, drawnFrom: [{ videoId, channel, title }] }: opening hook lines for cases this channel could make',
  openings:
    'array of up to 12 entries { text: string, note: string, drawnFrom: [{ videoId, channel, title }] }: the first lines of a film',
  titles:
    'array of up to 12 entries { text: string, note: string, drawnFrom: [{ videoId, channel, title }] }: video titles',
  language: 'string: a language code such as "en"',
  country: 'string: a two-letter country code such as "US"',
  formats:
    'array of 1 to 6 formats { key: lower-case slug, name, primary: boolean (exactly one true), keywords: up to 6 search phrases this format is found by, lead first, intent: "tension" for a film that builds suspense or "calm" for one made to relax or fall asleep to, runtime: { default, min, max } minutes between 3 and 240, wordsPerMinute: the narrator\'s speaking rate (150 if unknown), shotHold: 1 for a normal pace of pictures up to 4 for long holds, titleTemplate: a title pattern using {topic} {formatKeyword} {pillar} {runtime}, or "", titleRequiredSlots: the slots every title must carry, introRule, introLine, outroLine: "" when none }: the kinds of video the channel makes',
  channelHashtag: 'string: one hashtag for every upload, letters and digits only, without #, or ""',
  channelFooter:
    'string: a short closing paragraph for every description, up to 1000 characters, or ""',
  channelTags: "array of up to 15 strings, each up to 30 characters: the channel's own tags",
  titleStyle: 'string: how this channel titles its videos, in one line',
  ctaLine: 'string: the closing line that points viewers to the channel',
  disclaimer: 'string: the standing disclaimer for descriptions, up to 1000 characters',
  youtubeCategoryId: 'string of one to three digits, or null',
  auditionLine: 'string: a sample opening line of narration, up to 400 characters',
  caseCategories:
    'array of at least two { key: lower-case slug, label: string up to 40 characters, keywords: up to 6 search phrases for that pillar }: the pillars (kinds of film) the channel makes',
  scriptRulesMd: 'string: extra rules for the script writer, in markdown; empty when none',
  directionRulesMd: 'string: extra rules for the picture department, in markdown; empty when none',
}

/** The example slots a unit asks for. */
function slotsOf(unit: BibleDraftUnit): readonly ExampleSlot[] {
  if (unit.section !== 'examples') return []
  return EXAMPLE_SLOTS.filter((slot) =>
    'slotId' in unit ? slot.id === unit.slotId : slot.source === unit.source,
  )
}

/** The fields of a unit's schema with their defaults removed, so an answer must name every one. */
function required(key: keyof ChannelBible): z.ZodType {
  const field: z.ZodType = ChannelBibleSchema.shape[key]
  return field instanceof z.ZodDefault ? (field.removeDefault() as z.ZodType) : field
}

/**
 * What the model must answer with for a unit. A section is the strict pick of
 * its fields from the bible's own schema; an examples unit is exactly that
 * group's (or that one slot's) ids, each required and within its slot's limit.
 */
export function bibleUnitSchema(unit: BibleDraftUnit): z.ZodType<Partial<ChannelBible>> {
  if (unit.section === 'examples') {
    const ids = Object.fromEntries(
      slotsOf(unit).map((slot) => [slot.id, z.string().min(1).max(slot.maxLength)]),
    )
    return z.object({ examples: z.object(ids).strict() }).strict() as unknown as z.ZodType<
      Partial<ChannelBible>
    >
  }
  const picked = Object.fromEntries(BIBLE_SECTIONS[unit.section].map((key) => [key, required(key)]))
  return z.object(picked).strict() as unknown as z.ZodType<Partial<ChannelBible>>
}

export function parseBibleUnit(unit: BibleDraftUnit, text: string): Partial<ChannelBible> {
  return parseJsonCompletion(text, bibleUnitSchema(unit), 'bible section')
}

/** Examples merge by key; every other key is replaced. */
export function mergeBibleUnit(
  draft: ChannelBible,
  _unit: BibleDraftUnit,
  answer: Partial<ChannelBible>,
): ChannelBible {
  const { examples, ...rest } = answer
  const merged: ChannelBible = { ...draft, ...rest }
  if (examples) merged.examples = { ...draft.examples, ...examples }
  return merged
}

function inputsBlock(inputs: BibleDraftInputs): string {
  const lines = [`Description: ${inputs.description}`]
  if (inputs.audience) lines.push(`Audience: ${inputs.audience}`)
  if (inputs.admiredChannels.length > 0) {
    lines.push(`Channels the owner admires: ${inputs.admiredChannels.join('; ')}`)
  }
  if (inputs.videos.length > 0)
    lines.push(`Videos the owner points to: ${inputs.videos.join('; ')}`)
  if (inputs.avoid) lines.push(`To avoid: ${inputs.avoid}`)
  return lines.join('\n')
}

function digestBlock(research: BibleResearchDigest): string {
  const patterns = research.patterns.map((p) => {
    const quote = p.quote ? ` Quote: "${p.quote}"` : ''
    const from = p.sources
      .map((s) => `${s.title} (${s.channel}, ${s.own ? 'own' : 'other'}, ${s.videoId})`)
      .join('; ')
    return `- [${p.kind}] ${p.pattern}${quote} From: ${from}`
  })
  const videos = research.videos.map(
    (v) =>
      `- ${v.title} (${v.channel}, ${v.own ? 'own' : 'other'}, ${v.videoId}, ${v.views ?? 'views unknown'} views)`,
  )
  return `Patterns:\n${patterns.join('\n')}\n\nVideos:\n${videos.join('\n')}`
}

/** The sections the draft already holds, except the unit's own words. */
function draftBlock(draft: ChannelBible, unit: BibleDraftUnit): string {
  const own = new Set(slotsOf(unit).map((slot) => slot.id))
  const parts: string[] = []
  for (const section of Object.keys(BIBLE_SECTIONS) as BibleSection[]) {
    if (section === unit.section && section !== 'examples') continue
    if (sectionIsEmpty(draft, section)) continue
    const fields: Partial<ChannelBible> = {}
    for (const key of BIBLE_SECTIONS[section]) {
      if (key === 'examples') {
        const kept = Object.fromEntries(
          Object.entries(draft.examples).filter(([id]) => !own.has(id)),
        )
        if (Object.keys(kept).length > 0) fields.examples = kept
      } else {
        Object.assign(fields, { [key]: draft[key] })
      }
    }
    if (Object.keys(fields).length > 0) parts.push(`${section}: ${JSON.stringify(fields, null, 2)}`)
  }
  return parts.join('\n\n')
}

function keysOf(unit: BibleDraftUnit): readonly (keyof ChannelBible)[] {
  return BIBLE_SECTIONS[unit.section]
}

function fieldsBlock(unit: BibleDraftUnit): string {
  if (unit.section !== 'examples') {
    return keysOf(unit)
      .map((key) => `- ${key}: ${FIELD_NOTES[key]}`)
      .join('\n')
  }
  const lines = slotsOf(unit).map(
    (slot) => `- ${slot.id} (${slot.kind}, up to ${slot.maxLength} characters): ${slot.teaches}`,
  )
  return `- examples: ${FIELD_NOTES.examples}\n\nAnswer {"examples": {...}} with exactly these ids, each a string:\n${lines.join('\n')}`
}

function shapeExample(unit: BibleDraftUnit): string {
  if (unit.section === 'examples') {
    const examples = Object.fromEntries(
      slotsOf(unit).map((slot) => [slot.id, FIRST_CHANNEL_BIBLE.examples[slot.id] ?? '']),
    )
    return JSON.stringify({ examples }, null, 2)
  }
  const fields = Object.fromEntries(keysOf(unit).map((key) => [key, FIRST_CHANNEL_BIBLE[key]]))
  return JSON.stringify(fields, null, 2)
}

const HOOKS_RULE =
  "Write each entry as this channel's own line for a case it could make. Name the pattern in `note` and list the videos it came from in `drawnFrom`, from the research sources only. Never copy a line from them."

function answerBudget(unit: BibleDraftUnit): number {
  if (unit.section === 'examples') {
    const chars = slotsOf(unit).reduce((sum, slot) => sum + slot.maxLength, 0)
    return Math.ceil(chars / 3) + 300
  }
  return 3000
}

export function buildBibleUnitRequest(input: {
  unit: BibleDraftUnit
  channelName: string
  inputs: BibleDraftInputs | null
  research: BibleResearchDigest | null
  draft: ChannelBible
  steer?: string
  previousError?: string
}): LLMTaskRequest {
  const { unit } = input
  const sections: string[] = []
  const add = (heading: string, body: string) => sections.push(`## ${heading}\n\n${body}`)

  if (input.inputs) add("The owner's inputs", inputsBlock(input.inputs))
  if (input.research) add('Research digest', digestBlock(input.research))
  const drafted = draftBlock(input.draft, unit)
  if (drafted) add('Already drafted for this channel', drafted)
  add('What to write', fieldsBlock(unit))
  add(
    'An example of shape and level of detail, from another channel. Do not reuse its subjects or words.',
    shapeExample(unit),
  )
  if (unit.section === 'hooks') add('Hooks, openings and titles', HOOKS_RULE)
  if (input.steer) add('Steer', `The owner asks: ${input.steer}`)
  if (input.previousError) {
    add('Last answer', `Your last answer was refused: ${input.previousError}`)
  }
  const user =
    `${sections.join('\n\n')}\n\n` +
    'Answer with one JSON object holding exactly the fields above, and nothing else: no prose, no markdown fence.'

  return {
    task: 'bible',
    system: fillSlots(
      `You draft part of the channel bible for the YouTube channel ${literalBibleText(input.channelName)}. The bible is the one place its voice, look and rules are written down, so be specific to this channel and plain in how you write. Never invent facts about real people or organisations.`,
      { bible: EMPTY_BIBLE, slotIds: [] },
    ),
    messages: [
      {
        role: 'user',
        content: fillSlots(literalBibleText(user), { bible: EMPTY_BIBLE, slotIds: [] }),
      },
    ],
    maxTokens: outputBudget(answerBudget(unit)),
  }
}
