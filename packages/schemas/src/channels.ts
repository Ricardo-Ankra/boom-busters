import { z } from 'zod'
import { EXAMPLE_SLOT_IDS, type BibleInUse } from './bible-slots'
import { UlidSchema } from './ids'
import { PUBLISH_DISCLAIMER } from './publish'

/** A channel slug: lower-case letters, digits and inner dashes, 1 to 40 characters. */
export const CHANNEL_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

/** Slugs that would collide with a top-level route. */
export const RESERVED_SLUGS = [
  'settings',
  'projects',
  'cases',
  'calendar',
  'costs',
  'new',
  'c',
  'api',
] as const

export const ChannelSlugSchema = z
  .string()
  .regex(CHANNEL_SLUG_PATTERN)
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), {
    message: 'That slug is reserved',
  })

/** Lower-case, runs of anything outside [a-z0-9] become one dash, trimmed, at most 40 characters. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

/**
 * The channel bible: the per-channel facts the prompts used to hard-code.
 * Every field defaults to empty so a new channel starts as a blank form.
 */
/** A slot id: kebab-case with at least one dash, as `script-opening-line`. */
const SLOT_ID_PATTERN = /^[a-z]+(-[a-z0-9]+)+$/

/** One drafted hook, opening or title, with the videos it was drawn from. */
export const BibleExampleEntrySchema = z.object({
  text: z.string().min(1).max(2500),
  note: z.string().max(300),
  drawnFrom: z
    .array(z.object({ videoId: z.string(), channel: z.string(), title: z.string() }))
    .max(5),
})
export type BibleExampleEntry = z.infer<typeof BibleExampleEntrySchema>

/**
 * The channel bible: the per-channel facts the prompts used to hard-code.
 * Every field defaults to empty so a new channel starts as a blank form.
 * Strict: an unknown key is refused, so a typo in a draft fails loudly.
 */
export const ChannelBibleSchema = z
  .object({
    subject: z.string().max(2000).default(''),
    whatACaseIs: z.string().max(2000).default(''),
    subjectKind: z.string().max(2000).default(''),
    subjectNoun: z
      .object({
        singular: z.string().max(60).default(''),
        plural: z.string().max(60).default(''),
      })
      .default({ singular: '', plural: '' }),
    audience: z.string().max(2000).default(''),
    narrationRegister: z.string().max(2000).default(''),
    voiceDos: z.array(z.string().max(300)).max(12).default([]),
    voiceDonts: z.array(z.string().max(300)).max(12).default([]),
    hedgingRules: z.string().max(4000).default(''),
    visualRegister: z.string().max(2000).default(''),
    examples: z.record(z.string().regex(SLOT_ID_PATTERN), z.string().max(6000)).default({}),
    hooks: z.array(BibleExampleEntrySchema).max(12).default([]),
    openings: z.array(BibleExampleEntrySchema).max(12).default([]),
    titles: z.array(BibleExampleEntrySchema).max(12).default([]),
    language: z.string().max(12).default(''),
    country: z.string().max(2).default(''),
    keywordContext: z.string().max(60).default(''),
    channelTags: z.array(z.string().max(30)).max(15).default([]),
    titleStyle: z.string().max(2000).default(''),
    ctaLine: z.string().max(2000).default(''),
    disclaimer: z.string().max(1000).default(''),
    youtubeCategoryId: z
      .string()
      .regex(/^\d{1,3}$/)
      .nullable()
      .default(null),
    auditionLine: z.string().max(400).default(''),
    caseCategories: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/),
          label: z.string().min(1).max(40),
        }),
      )
      .default([]),
    scriptRulesMd: z.string().max(20000).default(''),
    directionRulesMd: z.string().max(20000).default(''),
  })
  .strict()
export type ChannelBible = z.infer<typeof ChannelBibleSchema>

export const EMPTY_BIBLE: ChannelBible = ChannelBibleSchema.parse({})

export type BibleSection =
  'identity' | 'voice' | 'look' | 'examples' | 'hooks' | 'search' | 'publishing'

/** The units the owner drafts, approves and redrafts. Every field sits in exactly one. */
export const BIBLE_SECTIONS: Record<BibleSection, readonly (keyof ChannelBible)[]> = {
  identity: ['subject', 'whatACaseIs', 'subjectKind', 'subjectNoun', 'caseCategories', 'audience'],
  voice: ['narrationRegister', 'voiceDos', 'voiceDonts', 'hedgingRules', 'scriptRulesMd'],
  look: ['visualRegister', 'directionRulesMd'],
  examples: ['examples'],
  hooks: ['hooks', 'openings', 'titles'],
  search: ['language', 'country', 'keywordContext', 'channelTags'],
  publishing: ['titleStyle', 'ctaLine', 'disclaimer', 'youtubeCategoryId', 'auditionLine'],
}

/**
 * What a bible still lacks to run, by field key (`examples.<slot-id>` for a
 * slot). Optional: the call to action, the two rules files, the voice lists,
 * hooks, openings, titles, every search field and the YouTube category.
 */
export function missingBibleFields(
  bible: ChannelBible,
  slotIds: readonly string[] = EXAMPLE_SLOT_IDS,
): string[] {
  const text: [string, string][] = [
    ['subject', bible.subject],
    ['whatACaseIs', bible.whatACaseIs],
    ['subjectKind', bible.subjectKind],
    ['audience', bible.audience],
    ['narrationRegister', bible.narrationRegister],
    ['visualRegister', bible.visualRegister],
    ['titleStyle', bible.titleStyle],
    ['subjectNoun.singular', bible.subjectNoun.singular],
    ['subjectNoun.plural', bible.subjectNoun.plural],
    ['hedgingRules', bible.hedgingRules],
    ['disclaimer', bible.disclaimer],
    ['auditionLine', bible.auditionLine],
  ]
  const missing = text.filter(([, value]) => value.trim().length === 0).map(([key]) => key)
  if (bible.caseCategories.length < 2) missing.push('caseCategories')
  for (const id of slotIds) {
    if ((bible.examples[id] ?? '').trim().length === 0) missing.push(`examples.${id}`)
  }
  return missing
}

/** Complete enough to run: nothing required is missing, and every slot in use has an entry. */
export function isBibleComplete(
  bible: ChannelBible,
  slotIds: readonly string[] = EXAMPLE_SLOT_IDS,
): boolean {
  return missingBibleFields(bible, slotIds).length === 0
}

export const FIRST_CHANNEL_ID = '01BB0000000000000000000001'
export const FIRST_CHANNEL_SLUG = 'boom-busters'
export const FIRST_CHANNEL_NAME = 'Boom & Busters'
export const FIRST_CHANNEL_HANDLE = '@BoomAndBusters'

export const FIRST_CHANNEL_BIBLE: ChannelBible = {
  subject: 'corporate collapses, frauds, meltdowns and turnarounds',
  whatACaseIs:
    'A good case has: a documented paper trail (court filings, regulator actions, major-outlet reporting), a clear turn where the story changes, and consequences that can be shown rather than described. A bad case is one where the only sources are other YouTube videos, or where the interesting part is speculation about what someone was thinking.',
  subjectKind: "the company's common name as Wikipedia titles it",
  audience: 'adults who watch long-form money documentaries',
  narrationRegister: 'plain, specific, unhurried',
  visualRegister:
    "the Netflix money documentary. Dark, patient, photographic realism. The people, in the rooms where it happened: principals at the table, in the corridor, at the podium, re-created with a reconstruction's restraint. Empty rooms, documents and objects are punctuation between them, not the film.",
  titleStyle: 'Sober, specific, curiosity-driven',
  ctaLine: 'The full story is on the channel',
  caseCategories: [
    { key: 'collapse', label: 'Collapse' },
    { key: 'con', label: 'Con' },
    { key: 'meltdown', label: 'Meltdown' },
    { key: 'turnaround', label: 'Turnaround' },
    { key: 'empire', label: 'Empire' },
  ],
  scriptRulesMd: '',
  directionRulesMd: '',
  subjectNoun: { singular: 'company', plural: 'companies' },
  voiceDos: [],
  voiceDonts: [],
  hedgingRules: `The hard rules:
- Assert nothing the claim list does not support.
- Where a claim is NOT adjudicated, write "alleged", "reportedly", "according
  to" — never state it as established fact.
- Never invent figures, dates, quotes or names.
- Legal care is inline: "alleged", "reportedly", "according to". Never a
  sentence of its own saying that nothing was proven, that no court has
  found, or that this is an interpretation. The one exception is the film's
  single such sentence, where a chapter's constraints ask for it.`,
  examples: {},
  hooks: [],
  openings: [],
  titles: [],
  language: 'en',
  country: 'US',
  keywordContext: 'documentary',
  channelTags: [],
  disclaimer: PUBLISH_DISCLAIMER,
  youtubeCategoryId: null,
  auditionLine:
    'In June 2020, Wirecard admitted that roughly two billion euros of cash on its balance sheet ' +
    'probably did not exist. The auditors had signed the accounts for years.',
}

export const FIRST_CHANNEL_IN_USE: BibleInUse = {
  bible: FIRST_CHANNEL_BIBLE,
  slotIds: EXAMPLE_SLOT_IDS,
}

export const CreateChannelInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  handle: z.string().trim().max(40).nullable(),
  slug: ChannelSlugSchema,
  startFrom: z.union([z.literal('defaults'), z.object({ copyFromChannelId: UlidSchema })]),
})
export type CreateChannelInput = z.infer<typeof CreateChannelInputSchema>
