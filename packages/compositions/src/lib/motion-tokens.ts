import type { Easing } from 'remotion'

/**
 * The house motion tokens (decision 301): the numbers every graphic's motion
 * comes from, in two forms a test holds equal. `motionTokens(Easing)` builds
 * the typed object house code reads (`MOTION` in `graphic-code.ts`).
 * `MOTION_PREAMBLE` is the same object as JavaScript text, declared as a
 * frozen `motion` constant at the top of every stored design's compiled code
 * (`graphicCodeIssue` prepends it), so a design carries the values it was
 * checked with whatever the tokens become later.
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
export const MOTION_VERSION = 1

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
  readonly ms: typeof MOTION_MS
  readonly frames: (ms: number, fps: number) => number
  readonly ease: Readonly<Record<MotionEaseName, (t: number) => number>>
  readonly spring: typeof MOTION_SPRING
  readonly px: typeof MOTION_PX
  readonly scale: typeof MOTION_SCALE
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
 * The typed tokens, built with the caller's `Easing`: `MOTION` in
 * `graphic-code.ts` passes Remotion's. The dry run never calls this; it runs
 * `MOTION_PREAMBLE`, which reads the sandbox's `Remotion.Easing`.
 */
export function motionTokens(easing: typeof Easing): MotionTokens {
  return deepFreeze({
    ms: { ...MOTION_MS },
    frames: motionFrames,
    ease: {
      enter: easing.out(easing.poly(4)),
      exit: easing.in(easing.cubic),
      move: easing.inOut(easing.cubic),
      emphasis: easing.out(easing.exp),
      linear: easing.linear,
    },
    spring: {
      settle: { ...MOTION_SPRING.settle },
      hero: { ...MOTION_SPRING.hero },
      snap: { ...MOTION_SPRING.snap },
    },
    px: { ...MOTION_PX },
    scale: { ...MOTION_SCALE },
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
export const MOTION_PREAMBLE = `// The house motion tokens (decision 301), version ${MOTION_VERSION}. Read-only.
const motion = Object.freeze({
  ms: Object.freeze(${JSON.stringify(MOTION_MS)}),
  frames: function (ms, fps) { return Math.max(1, Math.round((ms * fps) / 1000)) },
  ease: Object.freeze({
    enter: Remotion.Easing.out(Remotion.Easing.poly(4)),
    exit: Remotion.Easing.in(Remotion.Easing.cubic),
    move: Remotion.Easing.inOut(Remotion.Easing.cubic),
    emphasis: Remotion.Easing.out(Remotion.Easing.exp),
    linear: Remotion.Easing.linear,
  }),
  spring: Object.freeze({
    settle: Object.freeze(${JSON.stringify(MOTION_SPRING.settle)}),
    hero: Object.freeze(${JSON.stringify(MOTION_SPRING.hero)}),
    snap: Object.freeze(${JSON.stringify(MOTION_SPRING.snap)}),
  }),
  px: Object.freeze(${JSON.stringify(MOTION_PX)}),
  scale: Object.freeze(${JSON.stringify(MOTION_SCALE)}),
  stagger: function (index, fps) { return Math.round((Math.min(index * ${MOTION_STAGGER_MS}, ${MOTION_STAGGER_MAX_MS}) * fps) / 1000) },
  order: Object.freeze(${JSON.stringify(MOTION_ORDER)}),
})`
