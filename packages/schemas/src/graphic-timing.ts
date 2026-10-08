/**
 * When things happen inside a graphic (decisions 289 and 290): plain
 * functions over a scene's times, read by the schema's own rules, the
 * designer's checks, the layout, the card, the board's preview and the live
 * harness, so every one of them agrees on when an element is on screen.
 *
 * Structural types only: `graphics.ts` (the zod schemas) imports from here,
 * never the other way round.
 */

/** How long one entrance takes on the card. The render reads this; a check reads it too. */
export const GRAPHIC_ENTER_MS = 600
/** The gap between entrances when a scene times none of them. */
export const GRAPHIC_STAGGER_MS = 180
/** How long one exit takes (decision 290). */
export const GRAPHIC_EXIT_MS = 500
/** How long one bar takes to grow in. */
export const GRAPHIC_BAR_GROW_MS = 700
/** How long a colour emphasis takes to shift. */
export const GRAPHIC_COLOR_SHIFT_MS = 400
/** How long one camera move takes. */
export const GRAPHIC_CAMERA_MOVE_MS = 1500
/** The most elements a graphic shows at any one moment. */
export const GRAPHIC_MAX_ON_SCREEN = 6
/** The word-form pulse: when it fires after its entrance starts, and how long it lasts. */
export const GRAPHIC_PULSE_AFTER_ENTER_MS = 600
export const GRAPHIC_PULSE_MS = 360
/** The word-form underline: when its sweep starts after its entrance starts, and how long it takes. */
export const GRAPHIC_UNDERLINE_AFTER_ENTER_MS = 500
export const GRAPHIC_UNDERLINE_MS = 600

/** The least an element must carry for its times to be read. */
export interface GraphicTimingElement {
  id: string
  kind?: string
  enter: { atMs: number }
  exit?: { atMs: number }
  emphasis?:
    'pulse' | 'underline' | { kind: 'pulse' | 'underline' | 'color'; atMs: number; to?: string }
  items?: readonly { atMs?: number }[]
}

/** The least a scene must carry for its times to be read. */
export interface GraphicTimingScene {
  elements: readonly GraphicTimingElement[]
  camera?: readonly { atMs: number; focus: string }[]
}

/** An element's time on screen: from its entrance's start to its exit's start. */
export interface OnScreen {
  fromMs: number
  toMs: number
}

/** A moment of emphasis: what it does, when it starts and how long it takes. */
export interface EmphasisWindow {
  kind: 'pulse' | 'underline' | 'color'
  atMs: number
  durationMs: number
  /** A colour emphasis: the colour token it shifts to. */
  to?: string
}

/**
 * When each element starts entering, as the card plays it: the authored
 * offsets when any element is timed, otherwise a stagger in scene order. One
 * rule for the card and for the check that keeps entrances inside the slot.
 */
export function graphicEnterTimes(scene: GraphicTimingScene): Map<string, number> {
  const timed = scene.elements.some((element) => element.enter.atMs > 0)
  return new Map(
    scene.elements.map((element, index) => [
      element.id,
      timed ? element.enter.atMs : index * GRAPHIC_STAGGER_MS,
    ]),
  )
}

/**
 * The schema promised that the layout clamps an entrance inside its slot, and
 * nothing did (decision 289). This is the clamp, as a rule the designer is
 * held to: every entrance must have time to finish before the slot ends.
 */
export function lateEntranceIssue(scene: GraphicTimingScene, durationMs: number): string | null {
  const latest = Math.max(0, durationMs - GRAPHIC_ENTER_MS)
  for (const [id, atMs] of graphicEnterTimes(scene)) {
    if (atMs > latest) {
      return `element "${id}" enters at ${atMs} ms, but this ${(durationMs / 1000).toFixed(1)} s slot needs every entrance to start by ${latest} ms`
    }
  }
  return null
}

/**
 * When each element is on screen (decision 290): from its entrance's start to
 * its exit's START, open-ended without an exit. Counting to the exit's start
 * lets an element entering as another leaves take its place: a cross-fade is
 * two elements in one cell, not a collision, and not seven on screen.
 */
export function graphicOnScreen(scene: GraphicTimingScene): Map<string, OnScreen> {
  const enters = graphicEnterTimes(scene)
  return new Map(
    scene.elements.map((element) => [
      element.id,
      {
        fromMs: enters.get(element.id) ?? 0,
        toMs: element.exit?.atMs ?? Number.POSITIVE_INFINITY,
      },
    ]),
  )
}

/** Whether two elements are ever on screen together. */
export function intervalsMeet(a: OnScreen, b: OnScreen): boolean {
  return a.fromMs < b.toMs && b.fromMs < a.toMs
}

/** The most elements on screen at once, and the first moment it happens. */
export function maxOnScreen(scene: GraphicTimingScene): { count: number; atMs: number } {
  const spans = [...graphicOnScreen(scene).values()].sort((a, b) => a.fromMs - b.fromMs)
  let best = { count: 0, atMs: 0 }
  for (const { fromMs } of spans) {
    const count = spans.filter((span) => span.fromMs <= fromMs && fromMs < span.toMs).length
    if (count > best.count) best = { count, atMs: fromMs }
  }
  return best
}

/**
 * When an element's emphasis plays. The word forms keep stage 1's timing,
 * just after the entrance starts; the timed form (decision 290) plays at its
 * own time.
 */
export function emphasisWindow(
  emphasis: GraphicTimingElement['emphasis'],
  enterAtMs: number,
): EmphasisWindow | null {
  if (emphasis === undefined) return null
  if (emphasis === 'pulse') {
    return {
      kind: 'pulse',
      atMs: enterAtMs + GRAPHIC_PULSE_AFTER_ENTER_MS,
      durationMs: GRAPHIC_PULSE_MS,
    }
  }
  if (emphasis === 'underline') {
    return {
      kind: 'underline',
      atMs: enterAtMs + GRAPHIC_UNDERLINE_AFTER_ENTER_MS,
      durationMs: GRAPHIC_UNDERLINE_MS,
    }
  }
  const durationMs =
    emphasis.kind === 'pulse'
      ? GRAPHIC_PULSE_MS
      : emphasis.kind === 'underline'
        ? GRAPHIC_UNDERLINE_MS
        : GRAPHIC_COLOR_SHIFT_MS
  return {
    kind: emphasis.kind,
    atMs: emphasis.atMs,
    durationMs,
    ...(emphasis.to !== undefined ? { to: emphasis.to } : {}),
  }
}

/** When each bar of a bars element grows: its own time, or its element's entrance. */
export function barItemTimes(element: GraphicTimingElement, enterAtMs: number): number[] {
  return (element.items ?? []).map((item) => item.atMs ?? enterAtMs)
}
