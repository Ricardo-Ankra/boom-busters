import { DEFAULT_MOTION_IDENTITY } from '@boom-busters/schemas'
import type { MotionIdentity } from '@boom-busters/schemas'
import type { Easing } from 'remotion'

/**
 * The house motion tokens (decision 301): the numbers every graphic's motion
 * comes from, in two forms a test holds equal. `motionTokens(Easing, numbers)`
 * builds the typed object house code reads (`MOTION` in `graphic-code.ts`);
 * `motionPreamble(numbers)` is the same object as JavaScript text, declared
 * as a frozen `motion` constant at the top of every stored design's compiled
 * code (`graphicCodeIssue` prepends it), so a design carries the values it
 * was checked with whatever the tokens become later. The numbers come from a
 * channel's motion identity (`motionNumbers`, spec 2026-11-04); the house
 * identity gives the house numbers.
 *
 * Remotion-free on purpose: the web server's Inngest route is bundled with
 * the `react-server` condition and cannot import `remotion`, so this module
 * takes `Easing` as an argument and names it in the preamble text only. The
 * numbers are written once, below, and the preamble is built from them, so
 * the two forms cannot drift on a value; the curves and the two functions are
 * written twice and held equal by `motion-tokens.test.ts`.
 *
 * The values are the starting point, scaled from the Carbon and Material
 * ratios to video; the owner tunes them on the board, one number here.
 */

/** The preamble a stored design carries, recorded as `code.motion`. Bump it when a token's meaning changes. */
export const MOTION_VERSION = 2

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
/** Entrance order: the hero finishes last. */
export const MOTION_ORDER = ['frame', 'title', 'body', 'hero', 'note'] as const
/** Per item of a group, and the whole group's cap. */
export const MOTION_STAGGER_MS = 75
export const MOTION_STAGGER_MAX_MS = 600

export const MOTION_EASE_NAMES = ['enter', 'exit', 'move', 'emphasis', 'linear'] as const
export const MOTION_SPRING_NAMES = ['settle', 'hero', 'snap'] as const
export type MotionEaseName = (typeof MOTION_EASE_NAMES)[number]
export type MotionSpringName = (typeof MOTION_SPRING_NAMES)[number]

export interface MotionTokens {
  readonly ms: MotionLengths
  readonly frames: (ms: number, fps: number) => number
  readonly ease: Readonly<Record<MotionEaseName, (t: number) => number>>
  readonly spring: MotionSprings
  readonly px: { readonly rise: number }
  readonly scale: { readonly enter: number }
  readonly stagger: (index: number, fps: number) => number
  readonly order: typeof MOTION_ORDER
}

/** Milliseconds to whole frames, at least one. */
export function motionFrames(ms: number, fps: number): number {
  return Math.max(1, Math.round((ms * fps) / 1000))
}

/** The frame offset of the index-th item of a group: 75 ms each, the whole group within 600 ms. */
export function motionStagger(index: number, fps: number): number {
  return Math.round((Math.min(index * MOTION_STAGGER_MS, MOTION_STAGGER_MAX_MS) * fps) / 1000)
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
 * The numbers a channel's identity sets (spec 2026-11-04, section 8.1): the
 * lengths overlaid, the springs from its overshoot, the rise and scale-in
 * from its entrance, and the curve set `enter` and `move` take. The house
 * identity gives the house numbers, so `HOUSE_NUMBERS` is what every design
 * stored before the identity was checked with.
 */
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

export const HOUSE_NUMBERS: MotionNumbers = motionNumbers(DEFAULT_MOTION_IDENTITY)

/**
 * The two curves a set changes, in both forms: the typed function and the
 * `Remotion.Easing` expression the preamble writes. `exit`, `emphasis` and
 * `linear` never change.
 */
const EASE_SETS: Record<
  EaseSet,
  {
    enter: (e: typeof Easing) => (t: number) => number
    move: (e: typeof Easing) => (t: number) => number
    enterText: string
    moveText: string
  }
> = {
  soft: {
    enter: (e) => e.out(e.poly(4)),
    move: (e) => e.inOut(e.cubic),
    enterText: 'Remotion.Easing.out(Remotion.Easing.poly(4))',
    moveText: 'Remotion.Easing.inOut(Remotion.Easing.cubic)',
  },
  crisp: {
    enter: (e) => e.out(e.exp),
    move: (e) => e.inOut(e.poly(4)),
    enterText: 'Remotion.Easing.out(Remotion.Easing.exp)',
    moveText: 'Remotion.Easing.inOut(Remotion.Easing.poly(4))',
  },
  gentle: {
    enter: (e) => e.out(e.sin),
    move: (e) => e.inOut(e.sin),
    enterText: 'Remotion.Easing.out(Remotion.Easing.sin)',
    moveText: 'Remotion.Easing.inOut(Remotion.Easing.sin)',
  },
}

/**
 * The typed tokens, built with the caller's `Easing` and a channel's numbers
 * (the house numbers by default): `MOTION` in `graphic-code.ts` passes
 * Remotion's. The dry run never calls this; it runs the preamble, which reads
 * the sandbox's `Remotion.Easing`.
 */
export function motionTokens(
  easing: typeof Easing,
  numbers: MotionNumbers = HOUSE_NUMBERS,
): MotionTokens {
  const set = EASE_SETS[numbers.easeSet]
  return deepFreeze({
    ms: { ...numbers.ms },
    frames: motionFrames,
    ease: {
      enter: set.enter(easing),
      exit: easing.in(easing.cubic),
      move: set.move(easing),
      emphasis: easing.out(easing.exp),
      linear: easing.linear,
    },
    spring: {
      settle: { ...numbers.spring.settle },
      hero: { ...numbers.spring.hero },
      snap: { ...numbers.spring.snap },
    },
    px: { ...numbers.px },
    scale: { ...numbers.scale },
    stagger: motionStagger,
    order: [...MOTION_ORDER],
  }) as MotionTokens
}

/**
 * The tokens as the sandbox sees them: a frozen `motion` constant declared
 * before the design's code, inside the strict function body, reading
 * `Remotion.Easing` and nothing else. The curves and the two functions here
 * must match `motionTokens`; the numbers are the constants above.
 */
export function motionPreamble(numbers: MotionNumbers = HOUSE_NUMBERS): string {
  const set = EASE_SETS[numbers.easeSet]
  return `// The house motion tokens (decision 301), version ${MOTION_VERSION}. Read-only.
const motion = Object.freeze({
  ms: Object.freeze(${JSON.stringify(numbers.ms)}),
  frames: function (ms, fps) { return Math.max(1, Math.round((ms * fps) / 1000)) },
  ease: Object.freeze({
    enter: ${set.enterText},
    exit: Remotion.Easing.in(Remotion.Easing.cubic),
    move: ${set.moveText},
    emphasis: Remotion.Easing.out(Remotion.Easing.exp),
    linear: Remotion.Easing.linear,
  }),
  spring: Object.freeze({
    settle: Object.freeze(${JSON.stringify(numbers.spring.settle)}),
    hero: Object.freeze(${JSON.stringify(numbers.spring.hero)}),
    snap: Object.freeze(${JSON.stringify(numbers.spring.snap)}),
  }),
  px: Object.freeze(${JSON.stringify(numbers.px)}),
  scale: Object.freeze(${JSON.stringify(numbers.scale)}),
  stagger: function (index, fps) { return Math.round((Math.min(index * ${MOTION_STAGGER_MS}, ${MOTION_STAGGER_MAX_MS}) * fps) / 1000) },
  order: Object.freeze(${JSON.stringify(MOTION_ORDER)}),
})`
}

/** The house preamble: what every design stored before the identity carries. */
export const MOTION_PREAMBLE = motionPreamble()
