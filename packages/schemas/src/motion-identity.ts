import { z } from 'zod'
import { LAST_RESORT_TECHNIQUES, TECHNIQUES } from './techniques'

/**
 * A channel's motion identity (spec 2026-11-04, section 8.1): every taste
 * value the graphics designer's prompt used to carry for one channel, held
 * per channel in `settings.motion` beside the brand kit. The house values are
 * the defaults, so a settings row saved before this reads unchanged and
 * Boom & Busters designs as it did until the owner edits the Motion tab.
 *
 * The first four fields change the numbers a design is checked with (the
 * tokens preamble, built by the compositions package); the rest are words in
 * the designer's prompt. Nothing here reaches the render: the compiled code
 * carries its own preamble.
 */

/** The house ban list, verbatim from the craft section it came from. */
export const HOUSE_NEVER: readonly string[] = [
  'glows',
  'particle bursts',
  'lens flares',
  'camera shake',
  'RGB split',
  'a crossfade from one whole layout to another',
  'decorative gradients',
  'drop shadows for depth',
]

export const HOUSE_CAMERA_RULE =
  'a slow push over the whole slot, 2 to 4% on motion.ease.move, anchored so nothing leaves the safe area'

const Phrase = z.string().trim().min(1).max(60)
const PhraseList = z.array(Phrase).max(16)
const Length = z.number().int().min(40).max(3000)

const normalise = (phrase: string) => phrase.trim().toLowerCase()

export const MotionIdentitySchema = z
  .object({
    /** The curve set `motion.ease.enter` and `motion.ease.move` take. */
    signatureEase: z.enum(['soft', 'crisp', 'gentle']).default('soft'),
    /** Overrides on the house lengths, in milliseconds. */
    ms: z
      .object({
        enter: Length.optional(),
        exit: Length.optional(),
        reveal: Length.optional(),
        draw: Length.optional(),
        count: Length.optional(),
        move: Length.optional(),
        gap: Length.optional(),
      })
      .default({}),
    /** What the hero and snap springs do past their mark. */
    overshoot: z.enum(['none', 'hair', 'welcome']).default('hair'),
    /** How things arrive. */
    entrance: z.enum(['rise', 'fade', 'scale', 'wipe', 'slide']).default('rise'),
    /** Something changes about this often. */
    changeEveryMs: z.number().int().min(500).max(10000).default(1500),
    /** A graphic in which nothing changes for longer than this is refused. */
    stillMaxMs: z.number().int().min(1000).max(20000).default(6000),
    cameraRule: z.string().trim().max(200).default(HOUSE_CAMERA_RULE),
    blurFollowsSpeed: z.boolean().default(true),
    threeD: z.enum(['never', 'whenMeaningful', 'welcome']).default('whenMeaningful'),
    /** Phrases the designer is told never to use. */
    never: PhraseList.default([...HOUSE_NEVER]),
    /** Phrases removed from the never list for this channel. */
    allow: PhraseList.default([]),
    /** Plain prose for the designer and the critic. */
    styleGuideMd: z.string().max(4000).default(''),
    /** The techniques this channel uses; the two last resorts are always among them. */
    techniques: z.array(z.enum(TECHNIQUES)).default([...TECHNIQUES]),
    /** Bars rise from the baseline, lines draw on, no gridlines or ticks, no travelling bars. */
    chartsConventional: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.stillMaxMs < value.changeEveryMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['stillMaxMs'],
        message: 'the still limit must be at least the change cadence',
      })
    }
    const allowed = new Set(value.allow.map(normalise))
    const both = value.never.find((phrase) => allowed.has(normalise(phrase)))
    if (both !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['allow'],
        message: `"${normalise(both)}" is in both lists`,
      })
    }
    const missing = LAST_RESORT_TECHNIQUES.filter(
      (technique) => !value.techniques.includes(technique),
    )
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['techniques'],
        message: `${missing.join(' and ')} always stay in use`,
      })
    }
  })
export type MotionIdentity = z.infer<typeof MotionIdentitySchema>

export const DEFAULT_MOTION_IDENTITY: MotionIdentity = MotionIdentitySchema.parse({})

/** The never list with the channel's allowances taken out. */
export function motionNeverList(identity: MotionIdentity): string[] {
  const allowed = new Set(identity.allow.map(normalise))
  return identity.never.filter((phrase) => !allowed.has(normalise(phrase)))
}

/** The identity as the designer and the checks read it: allow folded into never. */
export function resolveMotionIdentity(settings: { motion: MotionIdentity }): MotionIdentity {
  return { ...settings.motion, never: motionNeverList(settings.motion), allow: [] }
}
