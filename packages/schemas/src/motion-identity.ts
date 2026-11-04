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

/** Completes the sentence "Something changes about every X, and the camera ...". */
export const HOUSE_CAMERA_RULE =
  "never stops: a slow push over the whole slot (a scale of 2 to 4% on motion.ease.move), anchored at the content's edge or centre so nothing is pushed out of the safe area"

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

/**
 * The identity as the designer and the checks read it: allow taken out of
 * never, and kept, since the prompt also says what the channel allows (final
 * review of plan 1, issue 3: a phrase may sit in both lists, and allow wins).
 */
export function resolveMotionIdentity(settings: { motion: MotionIdentity }): MotionIdentity {
  return { ...settings.motion, never: motionNeverList(settings.motion) }
}

// ---------------------------------------------------------------------------
// The numbers the tokens are built from (decision 301; spec 8.1). Here, below
// the compositions package, so the designer's prompt can state the channel's
// numbers without depending on Remotion.
// ---------------------------------------------------------------------------

/** Lengths in milliseconds. */
export const MOTION_MS = {
  /** A colour shift, a tick. */
  micro: 120,
  /** A fade with rise. */
  enter: 450,
  /** Exits are shorter than entrances. */
  exit: 300,
  /** A wipe. */
  reveal: 550,
  /** Bars and lines drawn on. */
  draw: 700,
  /** A counter. */
  count: 1000,
  /** A reframe, the camera. */
  move: 900,
  /** Between an exit and the entrance that replaces it. */
  gap: 120,
} as const

/** Spring configs for `Remotion.spring({ config })`. */
export const MOTION_SPRING = {
  /** Critically damped, no overshoot; the default spring. */
  settle: { damping: 200 },
  /** One small overshoot, about 7%, settling under a second; once per beat. */
  hero: { damping: 14, stiffness: 120 },
  /** Quick, a hair of overshoot; small things. */
  snap: { damping: 20, stiffness: 200 },
} as const

/** The rise under a fade, in pixels at 1080p; a design scales it by its unit. */
export const MOTION_PX = { rise: 20 } as const
/** A figure's scale-in, never from zero. */
export const MOTION_SCALE = { enter: 0.96 } as const
export const MOTION_SPRING_NAMES = ['settle', 'hero', 'snap'] as const
export type MotionSpringName = (typeof MOTION_SPRING_NAMES)[number]

export type EaseSet = MotionIdentity['signatureEase']
export type MotionLengths = Readonly<Record<keyof typeof MOTION_MS, number>>
export type MotionSpringConfig = { readonly damping: number; readonly stiffness?: number }
export type MotionSprings = Readonly<Record<MotionSpringName, MotionSpringConfig>>
export interface MotionNumbers {
  readonly ms: MotionLengths
  readonly spring: MotionSprings
  readonly px: { readonly rise: number }
  readonly scale: { readonly enter: number }
  readonly easeSet: EaseSet
}

const SPRINGS: Record<MotionIdentity['overshoot'], MotionSprings> = {
  none: { settle: MOTION_SPRING.settle, hero: MOTION_SPRING.settle, snap: MOTION_SPRING.settle },
  hair: MOTION_SPRING,
  welcome: {
    settle: MOTION_SPRING.settle,
    hero: { damping: 10, stiffness: 120 },
    snap: { damping: 14, stiffness: 200 },
  },
}

/** `Object.freeze` on the object and on each nested object. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * The numbers a channel's identity sets: the lengths overlaid, the springs
 * from its overshoot, the rise and scale-in from its entrance, and the curve
 * set `enter` and `move` take. The house identity gives the house numbers.
 */
export function motionNumbers(identity: MotionIdentity): MotionNumbers {
  const ms: Record<keyof typeof MOTION_MS, number> = { ...MOTION_MS }
  for (const [key, value] of Object.entries(identity.ms)) {
    if (value !== undefined) ms[key as keyof typeof identity.ms] = value
  }
  const rise = identity.entrance === 'rise' ? MOTION_PX.rise : 0
  const enter = identity.entrance === 'scale' ? 0.9 : MOTION_SCALE.enter
  return deepFreeze({
    ms,
    spring: {
      settle: { ...SPRINGS[identity.overshoot].settle },
      hero: { ...SPRINGS[identity.overshoot].hero },
      snap: { ...SPRINGS[identity.overshoot].snap },
    },
    px: { rise },
    scale: { enter },
    easeSet: identity.signatureEase,
  }) as MotionNumbers
}
