import { z } from 'zod'
import { EXAMPLE_SLOT_IDS, type BibleInUse } from './bible-slots'
import { FIRST_CHANNEL_EXAMPLES } from './first-channel-examples'
import { defaultFormat, FormatsSchema } from './formats'
import { UlidSchema } from './ids'
import { PUBLISH_DISCLAIMER } from './publish'
import { ResearchProfileKeySchema } from './research-profiles'

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
export const SLOT_ID_PATTERN = /^[a-z]+(?:-[a-z0-9]+)+$/

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
 * A BCP-47 style code, because it goes to YouTube and VidIQ as one: empty
 * (send none) or a language with optional subtags, never a name like "English".
 */
export const BibleLanguageSchema = z
  .string()
  .trim()
  .max(12)
  .regex(/^$|^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Use a language code such as en or pt-BR')

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
    researchProfile: ResearchProfileKeySchema.default('investigation'),
    narrationRegister: z.string().max(2000).default(''),
    voiceDos: z.array(z.string().max(300)).max(12).default([]),
    voiceDonts: z.array(z.string().max(300)).max(12).default([]),
    hedgingRules: z.string().max(4000).default(''),
    visualRegister: z.string().max(2000).default(''),
    examples: z.record(z.string().regex(SLOT_ID_PATTERN), z.string().max(6000)).default({}),
    hooks: z.array(BibleExampleEntrySchema).max(12).default([]),
    openings: z.array(BibleExampleEntrySchema).max(12).default([]),
    titles: z.array(BibleExampleEntrySchema).max(12).default([]),
    language: BibleLanguageSchema.default(''),
    country: z.string().max(2).default(''),
    channelTags: z.array(z.string().max(30)).max(15).default([]),
    channelHashtag: z
      .string()
      .regex(/^$|^[A-Za-z0-9]{1,30}$/, 'Letters and digits only, without #')
      .default(''),
    channelFooter: z.string().max(1000).default(''),
    formats: FormatsSchema.default(() => [defaultFormat()]),
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
          keywords: z.array(z.string().trim().min(1).max(60)).max(6).default([]),
        }),
      )
      .default([]),
    scriptRulesMd: z.string().max(20000).default(''),
    directionRulesMd: z.string().max(20000).default(''),
  })
  .strict()
export type ChannelBible = z.infer<typeof ChannelBibleSchema>

/**
 * A stored bible written before formats: adds the one format its old
 * `keywordContext` named (else "Main"), gives each category an empty keyword
 * list, and drops `keywordContext`. A bible that has `formats` is returned as is.
 */
export function upgradeStoredBible(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const stored = raw as Record<string, unknown>
  if ('formats' in stored) return raw
  const { keywordContext, ...rest } = stored
  const context = typeof keywordContext === 'string' ? keywordContext.trim() : ''
  const name = context ? context.charAt(0).toUpperCase() + context.slice(1) : 'Main'
  const categories = Array.isArray(rest.caseCategories)
    ? rest.caseCategories.map((c) =>
        typeof c === 'object' && c !== null && !('keywords' in c) ? { ...c, keywords: [] } : c,
      )
    : rest.caseCategories
  return {
    ...rest,
    ...(categories === undefined ? {} : { caseCategories: categories }),
    formats: [defaultFormat(name)],
  }
}

/**
 * Strict on write, strip on read: a stored version may carry a key the schema
 * has since dropped, and reading it must still work. Writes keep the strict one.
 * A version stored before formats is upgraded first.
 */
export const ChannelBibleReadSchema = z.preprocess(
  upgradeStoredBible,
  z.object({
    ...ChannelBibleSchema.shape,
    // A language written before the rule reads as empty, so the upload sends none.
    language: BibleLanguageSchema.catch('').default(''),
  }),
)

export const EMPTY_BIBLE: ChannelBible = ChannelBibleSchema.parse({})

export type BibleSection =
  'identity' | 'formats' | 'voice' | 'look' | 'examples' | 'hooks' | 'search' | 'publishing'

/** The units the owner drafts, approves and redrafts. Every field sits in exactly one. */
export const BIBLE_SECTIONS: Record<BibleSection, readonly (keyof ChannelBible)[]> = {
  identity: [
    'subject',
    'whatACaseIs',
    'subjectKind',
    'subjectNoun',
    'caseCategories',
    'audience',
    'researchProfile',
  ],
  formats: ['formats'],
  voice: ['narrationRegister', 'voiceDos', 'voiceDonts', 'hedgingRules', 'scriptRulesMd'],
  look: ['visualRegister', 'directionRulesMd'],
  examples: ['examples'],
  hooks: ['hooks', 'openings', 'titles'],
  search: ['language', 'country', 'channelTags', 'channelHashtag'],
  publishing: [
    'titleStyle',
    'ctaLine',
    'disclaimer',
    'youtubeCategoryId',
    'auditionLine',
    'channelFooter',
  ],
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
/** The first channel's version 1, fixed so the migration and `ensureFirstChannel` agree on it. */
export const FIRST_CHANNEL_BIBLE_ID = '01BB0000000000000000000002'
export const FIRST_CHANNEL_SLUG = 'boom-busters'
export const FIRST_CHANNEL_NAME = 'Boom & Busters'
export const FIRST_CHANNEL_HANDLE = '@BoomAndBusters'

export const FIRST_CHANNEL_BIBLE: ChannelBible = {
  subject: 'corporate collapses, frauds, meltdowns and turnarounds',
  whatACaseIs:
    'A good case has: a documented paper trail (court filings, regulator actions, major-outlet reporting), a clear turn where the story changes, and consequences that can be shown rather than described. A bad case is one where the only sources are other YouTube videos, or where the interesting part is speculation about what someone was thinking.',
  subjectKind: "the company's common name as Wikipedia titles it",
  audience: 'adults who watch long-form money documentaries',
  researchProfile: 'investigation',
  narrationRegister: 'plain, specific, unhurried',
  visualRegister:
    "the Netflix money documentary. Dark, patient, photographic realism. The people, in the rooms where it happened: principals at the table, in the corridor, at the podium, re-created with a reconstruction's restraint. Empty rooms, documents and objects are punctuation between them, not the film.",
  titleStyle: 'Sober, specific, curiosity-driven',
  ctaLine: 'The full story is on the channel',
  caseCategories: [
    { key: 'collapse', label: 'Collapse', keywords: [] },
    { key: 'con', label: 'Con', keywords: [] },
    { key: 'meltdown', label: 'Meltdown', keywords: [] },
    { key: 'turnaround', label: 'Turnaround', keywords: [] },
    { key: 'empire', label: 'Empire', keywords: [] },
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
  examples: FIRST_CHANNEL_EXAMPLES,
  hooks: [],
  openings: [],
  titles: [],
  language: 'en',
  country: 'US',
  channelTags: [],
  channelHashtag: '',
  channelFooter: '',
  formats: [defaultFormat('Documentary')],
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
