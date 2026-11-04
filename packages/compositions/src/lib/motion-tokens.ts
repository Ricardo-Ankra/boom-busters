import { DEFAULT_MOTION_IDENTITY, motionNumbers } from '@boom-busters/schemas'
import type { EaseSet, MotionLengths, MotionNumbers, MotionSprings } from '@boom-busters/schemas'
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

// The numbers live in the schemas package (spec 8.1), so the designer's prompt
// can state a channel's values; re-exported here for the house code that reads them.
export {
  MOTION_MS,
  MOTION_PX,
  MOTION_SCALE,
  MOTION_SPRING,
  MOTION_SPRING_NAMES,
  motionNumbers,
} from '@boom-busters/schemas'
export type {
  EaseSet,
  MotionLengths,
  MotionNumbers,
  MotionSpringConfig,
  MotionSpringName,
  MotionSprings,
} from '@boom-busters/schemas'

/** Entrance order: the hero finishes last. */
export const MOTION_ORDER = ['frame', 'title', 'body', 'hero', 'note'] as const
/** Per item of a group, and the whole group's cap. */
export const MOTION_STAGGER_MS = 75
export const MOTION_STAGGER_MAX_MS = 600

export const MOTION_EASE_NAMES = ['enter', 'exit', 'move', 'emphasis', 'linear'] as const
export type MotionEaseName = (typeof MOTION_EASE_NAMES)[number]

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
