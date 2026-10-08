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
  camera?: readonly { atMs: number; focus: string; zoom?: number }[]
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

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * The timing rules a designed graphic is held to (decision 290), in the words
 * the designer's retry and the card read: the first rule broken, or null.
 * Rule 1 is stage 1's late entrance, unchanged; the rest keep exits, emphasis,
 * bars and the camera inside the slot and inside each element's time on
 * screen, hold the screen to six elements, and keep a stepped graphic from
 * ending on an empty frame.
 */
export function sceneTimingIssue(scene: GraphicTimingScene, durationMs: number): string | null {
  const late = lateEntranceIssue(scene, durationMs)
  if (late !== null) return late

  const enters = graphicEnterTimes(scene)
  const onScreen = graphicOnScreen(scene)
  for (const element of scene.elements) {
    const enterAt = enters.get(element.id) ?? 0
    const settled = enterAt + GRAPHIC_ENTER_MS
    const emphasis = emphasisWindow(element.emphasis, enterAt)

    // Rule 2: an exit waits for the entrance and any emphasis, and ends inside the slot.
    if (element.exit) {
      const ready = Math.max(settled, emphasis ? emphasis.atMs + emphasis.durationMs : 0)
      if (element.exit.atMs < ready) {
        return `element "${element.id}" leaves at ${element.exit.atMs} ms, before its entrance and emphasis finish at ${ready} ms`
      }
      const latest = durationMs - GRAPHIC_EXIT_MS
      if (element.exit.atMs > latest) {
        return `element "${element.id}" leaves at ${element.exit.atMs} ms, but this ${seconds(durationMs)} slot needs its exit to start by ${latest} ms`
      }
    }

    // Rule 3: a timed emphasis falls while the element is fully on screen.
    // Against an exit, rule 2 has already held it; here only the slot's end is left.
    if (emphasis && typeof element.emphasis === 'object') {
      if (emphasis.atMs < settled) {
        return `element "${element.id}" is emphasised at ${emphasis.atMs} ms, before its entrance finishes at ${settled} ms`
      }
      const ends = emphasis.atMs + emphasis.durationMs
      if (ends > durationMs) {
        return `element "${element.id}" is emphasised at ${emphasis.atMs} ms, but this ${seconds(durationMs)} slot ends before its ${emphasis.kind} emphasis finishes at ${ends} ms`
      }
    }

    // Rule 4: each timed bar grows while its element is on screen; one grows at the entrance.
    if (element.items) {
      const leaveBy = element.exit?.atMs ?? durationMs
      const when = element.exit ? 'when its element starts to leave' : 'when the slot ends'
      for (const [index, item] of element.items.entries()) {
        if (item.atMs === undefined) continue
        if (item.atMs < enterAt) {
          return `bar ${index + 1} of "${element.id}" grows at ${item.atMs} ms, before its element enters at ${enterAt} ms`
        }
        if (item.atMs + GRAPHIC_BAR_GROW_MS > leaveBy) {
          return `bar ${index + 1} of "${element.id}" grows at ${item.atMs} ms, but must finish growing by ${leaveBy} ms, ${when}`
        }
      }
      const times = barItemTimes(element, enterAt)
      if (times.length > 0 && !times.includes(enterAt)) {
        return `element "${element.id}" would enter empty: at least one bar must grow at its entrance, ${enterAt} ms`
      }
    }
  }

  // Rule 5: the camera's keys in order, each move inside the slot, each focus on screen while it rests.
  const keys = scene.camera ?? []
  for (const [index, key] of keys.entries()) {
    const n = index + 1
    const previous = keys[index - 1]
    if (previous && key.atMs < previous.atMs + GRAPHIC_CAMERA_MOVE_MS) {
      return `camera key ${n} at ${key.atMs} ms must start at least ${GRAPHIC_CAMERA_MOVE_MS} ms after camera key ${index} at ${previous.atMs} ms`
    }
    const latest = durationMs - GRAPHIC_CAMERA_MOVE_MS
    if (key.atMs > latest) {
      return `camera key ${n} at ${key.atMs} ms cannot finish its move in this ${seconds(durationMs)} slot; it must start by ${latest} ms`
    }
    if (key.focus === 'all') continue
    const span = onScreen.get(key.focus)
    if (!span) {
      return `camera key ${n} focuses "${key.focus}", which is not an element of this graphic`
    }
    if (span.fromMs > key.atMs) {
      return `camera key ${n} focuses "${key.focus}" at ${key.atMs} ms, before it enters at ${span.fromMs} ms`
    }
    const restsUntil = keys[index + 1]?.atMs ?? durationMs
    if (span.toMs < restsUntil) {
      return `camera key ${n} rests on "${key.focus}" until ${restsUntil} ms, but it starts to leave at ${span.toMs} ms`
    }
  }

  // Rule 6: no more than six on screen at once.
  const crowd = maxOnScreen(scene)
  if (crowd.count > GRAPHIC_MAX_ON_SCREEN) {
    return `${crowd.count} elements are on screen together at ${crowd.atMs} ms; at most ${GRAPHIC_MAX_ON_SCREEN} may be`
  }

  // Rule 7: a graphic that steps never ends on an empty frame. Stage 1 never stepped.
  const steps = scene.elements.some((element) => element.exit)
  if (steps && !scene.elements.some((element) => element.kind !== 'shape' && !element.exit)) {
    return 'every element leaves before the end; at least one that is not a shape must stay on screen until the slot ends'
  }
  return null
}

/** A camera key that frames the composition as laid out: `'all'`, or any focus at zoom 1. */
function cameraAtRest(key: { focus: string; zoom?: number }): boolean {
  return key.focus === 'all' || (key.zoom ?? 1) <= 1
}

/** Every motion in a graphic: when it starts and how long it runs. */
export function graphicMotions(scene: GraphicTimingScene): { atMs: number; durationMs: number }[] {
  const enters = graphicEnterTimes(scene)
  const motions: { atMs: number; durationMs: number }[] = []
  for (const element of scene.elements) {
    const enterAt = enters.get(element.id) ?? 0
    motions.push({ atMs: enterAt, durationMs: GRAPHIC_ENTER_MS })
    if (element.exit) motions.push({ atMs: element.exit.atMs, durationMs: GRAPHIC_EXIT_MS })
    const emphasis = emphasisWindow(element.emphasis, enterAt)
    if (emphasis) motions.push({ atMs: emphasis.atMs, durationMs: emphasis.durationMs })
    for (const item of element.items ?? []) {
      if (item.atMs !== undefined)
        motions.push({ atMs: item.atMs, durationMs: GRAPHIC_BAR_GROW_MS })
    }
  }
  // A key that keeps a resting camera at rest does not move it, so it is not change.
  let atRest = true
  for (const key of [...(scene.camera ?? [])].sort((a, b) => a.atMs - b.atMs)) {
    const rest = cameraAtRest(key)
    if (!(rest && atRest)) motions.push({ atMs: key.atMs, durationMs: GRAPHIC_CAMERA_MOVE_MS })
    atRest = rest
  }
  return motions
}

/** Every moment something starts to change on screen, ascending and distinct. */
export function graphicChangeTimes(scene: GraphicTimingScene): number[] {
  return [...new Set(graphicMotions(scene).map((motion) => motion.atMs))].sort((a, b) => a - b)
}

/**
 * The longest stretch, from the first entrance to the slot's end, in which
 * nothing on screen moves: decision 290's measure of dead air. The drift does
 * not count; it never stops, and it never reads as change.
 */
export function longestStill(
  scene: GraphicTimingScene,
  durationMs: number,
): { fromMs: number; toMs: number } {
  const motions = graphicMotions(scene).sort((a, b) => a.atMs - b.atMs)
  let best = { fromMs: durationMs, toMs: durationMs }
  let movingUntil = motions[0]?.atMs ?? durationMs
  for (const motion of motions) {
    if (motion.atMs - movingUntil > best.toMs - best.fromMs) {
      best = { fromMs: movingUntil, toMs: motion.atMs }
    }
    movingUntil = Math.max(movingUntil, motion.atMs + motion.durationMs)
  }
  if (durationMs - movingUntil > best.toMs - best.fromMs) {
    best = { fromMs: movingUntil, toMs: durationMs }
  }
  return best
}

/** The distinct moments anything starts to leave, ascending: where a graphic's steps end. */
export function graphicExitTimes(scene: GraphicTimingScene): number[] {
  const times = scene.elements.flatMap((element) => (element.exit ? [element.exit.atMs] : []))
  return [...new Set(times)].sort((a, b) => a - b)
}
