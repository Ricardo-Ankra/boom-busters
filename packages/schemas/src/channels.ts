import { z } from 'zod'
import { UlidSchema } from './ids'

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
export const ChannelBibleSchema = z.object({
  subject: z.string().max(2000).default(''),
  whatACaseIs: z.string().max(2000).default(''),
  subjectKind: z.string().max(2000).default(''),
  audience: z.string().max(2000).default(''),
  narrationRegister: z.string().max(2000).default(''),
  visualRegister: z.string().max(2000).default(''),
  titleStyle: z.string().max(2000).default(''),
  ctaLine: z.string().max(2000).default(''),
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
export type ChannelBible = z.infer<typeof ChannelBibleSchema>

export const EMPTY_BIBLE: ChannelBible = ChannelBibleSchema.parse({})

/** Complete enough to run: every field but the call to action and the two rules files is filled, with two or more categories. */
export function isBibleComplete(bible: ChannelBible): boolean {
  const required = [
    bible.subject,
    bible.whatACaseIs,
    bible.subjectKind,
    bible.audience,
    bible.narrationRegister,
    bible.visualRegister,
    bible.titleStyle,
  ]
  return required.every((v) => v.trim().length > 0) && bible.caseCategories.length >= 2
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
}

export const CreateChannelInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  handle: z.string().trim().max(40).nullable(),
  slug: ChannelSlugSchema,
  startFrom: z.union([z.literal('defaults'), z.object({ copyFromChannelId: UlidSchema })]),
})
export type CreateChannelInput = z.infer<typeof CreateChannelInputSchema>
