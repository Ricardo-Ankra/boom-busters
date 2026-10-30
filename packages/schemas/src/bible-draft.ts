import { z } from 'zod'
import { EXAMPLE_SLOTS } from './bible-slots'
import { CAST_GUARDRAIL_MAX, DEFAULT_GUARDRAIL_SUFFIX } from './cast'
import { BIBLE_SECTIONS, ChannelBibleSchema } from './channels'
import type { BibleSection, ChannelBible } from './channels'

/**
 * The bible's working draft: what the owner has drafted but not yet saved as a
 * version. Pure shapes and rules; the store and the drafting runs build on them.
 */

export type BibleSectionStatus = 'approved' | 'drafted'

export const BIBLE_SECTION_LABELS: Record<BibleSection, string> = {
  identity: 'Identity',
  voice: 'Voice',
  look: 'Look',
  examples: 'Examples',
  hooks: 'Hooks, openings and titles',
  search: 'Search',
  publishing: 'Publishing',
}

export const BIBLE_SECTION_ORDER: readonly BibleSection[] = [
  'identity',
  'voice',
  'look',
  'examples',
  'hooks',
  'search',
  'publishing',
]

function valueIsEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') {
    const entries = Object.values(value)
    return entries.length === 0
  }
  return false
}

/** Every field the section holds is blank (an empty string, list or map, or null). */
export function sectionIsEmpty(bible: ChannelBible, section: BibleSection): boolean {
  return BIBLE_SECTIONS[section].every((key) => {
    const value = bible[key]
    if (key === 'subjectNoun') {
      const noun = bible.subjectNoun
      return noun.singular === '' && noun.plural === ''
    }
    return valueIsEmpty(value)
  })
}

/**
 * What stops a bible being saved whatever its approvals: an example over its
 * slot's limit, and a default guardrail that overruns the cast guardrail's
 * limit once its fixed ending is added.
 */
export function bibleProblems(bible: ChannelBible, slotIds?: readonly string[]): string[] {
  const problems: string[] = []
  const slots = slotIds ? EXAMPLE_SLOTS.filter((slot) => slotIds.includes(slot.id)) : EXAMPLE_SLOTS
  for (const slot of slots) {
    const text = bible.examples[slot.id]
    if (text !== undefined && text.length > slot.maxLength) {
      problems.push(
        `examples.${slot.id} is ${text.length} characters; the limit is ${slot.maxLength}`,
      )
    }
  }
  const guardrail = bible.examples['direction-default-guardrail']
  if (guardrail !== undefined) {
    const length = guardrail.length + DEFAULT_GUARDRAIL_SUFFIX.length
    if (length > CAST_GUARDRAIL_MAX) {
      problems.push(
        `The default guardrail is ${length} characters with its ending; the limit is ${CAST_GUARDRAIL_MAX}`,
      )
    }
  }
  return problems
}

export const BibleDraftInputsSchema = z.object({
  description: z.string().min(1).max(1000),
  audience: z.string().max(600),
  admiredChannels: z.array(z.string().max(200)).max(5),
  videos: z.array(z.string().max(200)).max(10),
  avoid: z.string().max(600),
})
export type BibleDraftInputs = z.infer<typeof BibleDraftInputsSchema>

export const ResearchSourceSchema = z.object({
  videoId: z.string(),
  channel: z.string(),
  title: z.string(),
  own: z.boolean(),
})
export type ResearchSource = z.infer<typeof ResearchSourceSchema>

export const BibleResearchDigestSchema = z.object({
  patterns: z
    .array(
      z.object({
        kind: z.enum(['title', 'hook', 'opening', 'audience']),
        pattern: z.string().min(1).max(300),
        quote: z.string().max(200).nullable(),
        sources: z.array(ResearchSourceSchema).min(1).max(5),
      }),
    )
    .max(40),
  videos: z
    .array(
      z.object({
        videoId: z.string(),
        channel: z.string(),
        title: z.string(),
        views: z.number().nullable(),
        own: z.boolean(),
      }),
    )
    .max(60),
})
export type BibleResearchDigest = z.infer<typeof BibleResearchDigestSchema>

/** One thing a drafting run writes: a section, one craft file's examples, or one slot. */
export type BibleDraftUnit =
  | { section: Exclude<BibleSection, 'examples'> }
  | { section: 'examples'; source: string }
  | { section: 'examples'; slotId: string }

const PlainSectionSchema = z.enum(['identity', 'voice', 'look', 'hooks', 'search', 'publishing'])

export const BibleDraftUnitSchema = z.union([
  z.object({ section: z.literal('examples'), slotId: z.string().min(1) }),
  z.object({ section: z.literal('examples'), source: z.string().min(1) }),
  z.object({ section: PlainSectionSchema }),
])

/** The units to draft, in section order, with examples split by the craft file they feed. */
export function bibleDraftUnits(
  sections: readonly BibleSection[] = BIBLE_SECTION_ORDER,
): BibleDraftUnit[] {
  const units: BibleDraftUnit[] = []
  for (const section of BIBLE_SECTION_ORDER) {
    if (!sections.includes(section)) continue
    if (section === 'examples') {
      for (const source of new Set(EXAMPLE_SLOTS.map((slot) => slot.source))) {
        units.push({ section, source })
      }
    } else {
      units.push({ section })
    }
  }
  return units
}

export function unitKey(unit: BibleDraftUnit): string {
  if ('slotId' in unit) return `slot:${unit.slotId}`
  if ('source' in unit) return `examples:${unit.source}`
  return unit.section
}

export const BibleDraftJobSchema = z.object({
  kind: z.enum(['research', 'draft']),
  state: z.enum(['running', 'done', 'failed']),
  current: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().datetime(),
})
export type BibleDraftJob = z.infer<typeof BibleDraftJobSchema>

const JOB_STALE_MS = 30 * 60_000

/** Running, and started under thirty minutes ago: an older one is taken as dead. */
export function jobIsRunning(job: BibleDraftJob, now: Date = new Date()): boolean {
  return job.state === 'running' && now.getTime() - Date.parse(job.startedAt) < JOB_STALE_MS
}

/** Flags by field path (`examples.<id>`, `hooks.<i>`, `openings.<i>`, `titles.<i>`). */
export const TooCloseSchema = z.record(
  z.string(),
  z.object({ source: z.string(), run: z.string() }),
)
export type TooCloseFlags = z.infer<typeof TooCloseSchema>

const SectionStatusSchema = z.enum(['approved', 'drafted'])

export const BibleDraftSchema = z.object({
  channelId: z.string(),
  baseBibleId: z.string(),
  bible: ChannelBibleSchema,
  statuses: z.object({
    identity: SectionStatusSchema,
    voice: SectionStatusSchema,
    look: SectionStatusSchema,
    examples: SectionStatusSchema,
    hooks: SectionStatusSchema,
    search: SectionStatusSchema,
    publishing: SectionStatusSchema,
  }),
  tooClose: TooCloseSchema,
  errors: z.record(z.string(), z.string()),
  inputs: BibleDraftInputsSchema.nullable(),
  research: BibleResearchDigestSchema.nullable(),
  job: BibleDraftJobSchema.nullable(),
  updatedAt: z.string(),
})
export type BibleDraft = z.infer<typeof BibleDraftSchema>

/**
 * Why a draft cannot become a version yet. A drafted section that holds
 * nothing never blocks: there is nothing in it to approve.
 */
export function bibleSaveBlockers(draft: BibleDraft): string[] {
  const blockers: string[] = []
  for (const section of BIBLE_SECTION_ORDER) {
    if (draft.statuses[section] === 'drafted' && !sectionIsEmpty(draft.bible, section)) {
      blockers.push(`${BIBLE_SECTION_LABELS[section]} is drafted, not approved`)
    }
  }
  for (const path of Object.keys(draft.tooClose)) {
    blockers.push(`${path} is too close to its source`)
  }
  return [...blockers, ...bibleProblems(draft.bible)]
}

/** The stages the Bible tab can show the composed system prompt for. */
export const PREVIEW_STAGES = [
  'script',
  'shotlist',
  'direction',
  'graphics',
  'metadata',
  'dossier',
] as const
export type PreviewStage = (typeof PREVIEW_STAGES)[number]
