import { GRAPHIC_GRID } from '@boom-busters/schemas'
import type {
  BrandKitTokens,
  GraphicCell,
  GraphicColor,
  GraphicElement,
  GraphicScene,
  GraphicTypeRole,
} from '@boom-busters/schemas'
import { frameScale, typeStyle, withAlpha } from '../components/brand'
import { captionSafeArea } from './captions'
import { MARKER_ALPHA, easeInOut } from './motion'

/**
 * Graphic geometry, pure and unit-tested (decision 268, Plan B). The board's
 * SVG preview and the Remotion card both call this, so the approved graphic
 * is the rendered graphic. Nothing here touches the DOM: text is fitted with
 * an estimate rather than measured, because a measurement made in the
 * board's browser and one made in the render's Chromium would disagree.
 */

export interface GraphicFrame {
  width: number
  height: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface ElementBox extends Box {
  id: string
  /** Text and figures only: the fitted size, so both drawers use one number. */
  fontPx?: number
}

const GRAPHIC_MARGIN_PX = 36
const GRAPHIC_GUTTER_PX = 8
/**
 * A conservative average glyph width, in em, for the fit estimate: `fitFontPx`'s own
 * estimate of how wide text draws, and the board preview's only way to approximate
 * the same width for an `underline` emphasis wash without measuring text it cannot
 * measure the same way the render's Chromium would.
 */
export const AVERAGE_GLYPH_EM = 0.56
const MIN_FONT_PX = 12
const ENTER_MS = 600
const BAR_LENGTH_FRACTION = 0.62
const BAR_LABEL_MAX_PX = 28
const BAR_LABEL_HEIGHT_FRACTION = 0.32
const RULE_THICKNESS_PX = 3
const RULE_MIN_THICKNESS_PX = 2
/** The gap `GraphicCard` gives a bars row's flex children, scaled with the frame. */
const BARS_GAP_PX = 12
/** The gap `GraphicCard` gives a figure's caption below its value, scaled with the frame. */
const FIGURE_LABEL_GAP_PX = 6
/** The frame minus the caption band and the margin: where elements may sit. */
export function safeArea(frame: GraphicFrame): Box {
  const margin = Math.round(GRAPHIC_MARGIN_PX * frameScale(frame.width, frame.height))
  const captions = captionSafeArea(frame.width, frame.height)
  // The caption block's top: its bottom edge less roughly two lines of caption.
  const captionTop =
    frame.height * captions.bottomFraction -
    140 * captions.fontScale * frameScale(frame.width, frame.height)
  return {
    x: margin,
    y: margin,
    w: frame.width - margin * 2,
    h: Math.max(1, Math.min(frame.height - margin, captionTop) - margin),
  }
}

export function roleBasePx(role: GraphicTypeRole): number {
  switch (role) {
    case 'heading':
      return 72
    case 'title':
      return 48
    case 'body':
      return 32
    case 'numbers':
      return 96
    case 'captions':
      return 24
  }
}

export function tokenColor(name: GraphicColor, brand: BrandKitTokens): string {
  const { colors } = brand
  switch (name) {
    case 'collapse':
      return colors.semantic.collapse
    case 'recovery':
      return colors.semantic.recovery
    case 'series0':
    case 'series1':
    case 'series2': {
      const index = Number(name.slice('series'.length))
      return colors.chartSeries[index] ?? colors.accent
    }
    default:
      return colors[name]
  }
}

/**
 * The size a role actually renders at: the fitted size from the layout, scaled
 * by the brand's setting for that role. The Remotion card reaches this through
 * `typeStyle`; the board's SVG preview has no CSS helper and would otherwise
 * compute its own, so both read it from here and cannot disagree.
 */
export function roleFontPx(role: GraphicTypeRole, basePx: number, brand: BrandKitTokens): number {
  return Number(typeStyle(brand.typography[role], basePx, 1).fontSize)
}

/** The base size of the caption under a figure, before the role's own scale. */
export function figureLabelBasePx(frame: GraphicFrame): number {
  return roleBasePx('captions') * frameScale(frame.width, frame.height)
}

/** The gap between a bars row's label, its bar and its value, scaled with the frame. */
export function barsGapPx(frame: GraphicFrame): number {
  return BARS_GAP_PX * frameScale(frame.width, frame.height)
}

/** The gap between a figure's value and its caption below it, scaled with the frame. */
export function figureLabelGapPx(frame: GraphicFrame): number {
  return FIGURE_LABEL_GAP_PX * frameScale(frame.width, frame.height)
}

/**
 * The accent wash an `underline` emphasis draws behind its text once fully revealed:
 * the same colour and alpha `markerSweep` (`lib/motion.ts`) sweeps in to, at rest. The
 * board's preview shows the resting frame, so it reads this colour directly rather
 * than reproducing the sweep's animation.
 */
export function emphasisWashColor(brand: BrandKitTokens): string {
  return withAlpha(brand.colors.accent, MARKER_ALPHA)
}

/**
 * The largest size at or under `basePx` at which `text` fits `boxWidth` by the estimate.
 * Never returns below `minPx` (default `MIN_FONT_PX`, unscaled, for Task 4's existing
 * callers and tests): an extreme label can overflow its box rather than shrink past
 * legibility. `graphicLayout` passes a frame-scaled floor, the same shape
 * `ChartReveal.tsx` passes `fitFigureSize` (`20 * scale`, not a bare `20`): a 1080p
 * legibility floor applied unscaled at a quarter that size is not a floor, it is the
 * size everything shrinks TO.
 */
export function fitFontPx(
  text: string,
  boxWidth: number,
  basePx: number,
  minPx: number = MIN_FONT_PX,
): number {
  const glyphs = Math.max(1, text.length)
  const fitted = Math.floor(boxWidth / (glyphs * AVERAGE_GLYPH_EM))
  return Math.max(minPx, Math.min(basePx, fitted))
}

export interface BarsGeometry {
  /** Height of one item's row inside the `bars` element's own box. */
  rowH: number
  /** The row's label and value font size, fitted the way text and figures are. */
  labelPx: number
}

/**
 * `bars`: one row per item, its label sized to the row height and capped by
 * the frame scale like every other role size here. `GraphicCard` and the
 * board's preview both call this for the row and label geometry, rather than
 * deriving it separately (decision 268, Plan B). Bars are the element most
 * likely to carry the numbers a card is built around, so a preview that fit
 * them on its own could drift from the render.
 */
export function barsGeometry(box: Box, itemCount: number, frame: GraphicFrame): BarsGeometry {
  const scale = frameScale(frame.width, frame.height)
  const rowH = box.h / Math.max(1, itemCount)
  const labelPx = Math.max(
    MIN_FONT_PX * scale,
    Math.min(BAR_LABEL_MAX_PX * scale, rowH * BAR_LABEL_HEIGHT_FRACTION),
  )
  return { rowH, labelPx }
}

/** A bar's drawn length: its value's share of the row's max, times the box width, times the entrance grow. */
export function barLengthPx(boxWidth: number, proportion: number, grow = 1): number {
  return boxWidth * BAR_LENGTH_FRACTION * proportion * grow
}

/** The `rule` shape's thickness, scaled with the frame like everything else here. */
export function ruleThicknessPx(frame: GraphicFrame): number {
  return Math.max(RULE_MIN_THICKNESS_PX, RULE_THICKNESS_PX * frameScale(frame.width, frame.height))
}

function cellBox(cell: GraphicCell, safe: Box, scale: number): Box {
  const cellW = safe.w / GRAPHIC_GRID
  const cellH = safe.h / GRAPHIC_GRID
  const gutter = Math.round((GRAPHIC_GUTTER_PX / 2) * scale)
  return {
    x: safe.x + cellW * cell.col + gutter,
    y: safe.y + cellH * cell.row + gutter,
    w: cellW * cell.colSpan - gutter * 2,
    h: cellH * cell.rowSpan - gutter * 2,
  }
}

function readingOrder(a: GraphicElement, b: GraphicElement): number {
  return a.cell.row - b.cell.row || a.cell.col - b.cell.col
}

/**
 * Portrait: an element with its own `portraitCell` keeps it, exactly as given, since a
 * pin is the author's business and may overlap whatever it likes. Every other element
 * is stacked full-width, in reading order, each one reserving a row for every element
 * still to come, so the stack can never run out mid-flow and never needs a clamp.
 *
 * Invariant 1, that auto-flowed elements never collide with one another, outranks
 * invariant 3: the flow starts below the pins when the rows left there can seat every
 * flowed element, and takes the whole grid when they cannot. An element overlapping a
 * pin the author placed on purpose is recoverable and visible; two auto-flowed elements
 * overlapping each other is content silently vanishing, which is what this function
 * exists to prevent. With at most six elements and twelve rows, the whole-grid fallback
 * always has room to give every element at least one row.
 *
 * Reading order decides which row an element gets, never the order of the returned
 * array, so `elements` always comes back in scene order and paint order cannot flip
 * between orientations.
 */
export function reflowPortrait(scene: GraphicScene): GraphicScene {
  const pinnedBottom = scene.elements.reduce(
    (bottom, element) =>
      element.portraitCell
        ? Math.max(bottom, element.portraitCell.row + element.portraitCell.rowSpan)
        : bottom,
    0,
  )

  const flowing = scene.elements
    .map((element, index) => ({ element, index }))
    .filter((entry) => !entry.element.portraitCell)
    .sort((a, b) => readingOrder(a.element, b.element))

  const top = GRAPHIC_GRID - pinnedBottom >= flowing.length ? pinnedBottom : 0
  let remaining = GRAPHIC_GRID - top
  let left = flowing.length
  let cursor = top

  const cellByIndex = new Map<number, GraphicCell>()
  for (const entry of flowing) {
    const want = Math.min(entry.element.cell.rowSpan, GRAPHIC_GRID)
    // Reserve one row for every element still to be placed, so the running total can
    // never exceed what is left and this never needs a clamp.
    const rowSpan = Math.max(1, Math.min(want, remaining - (left - 1)))
    cellByIndex.set(entry.index, { col: 0, row: cursor, colSpan: GRAPHIC_GRID, rowSpan })
    cursor += rowSpan
    remaining -= rowSpan
    left -= 1
  }

  const elements = scene.elements.map((element, index) =>
    element.portraitCell ? element : { ...element, portraitCell: cellByIndex.get(index)! },
  )
  return { elements }
}

/** Whether two grid rectangles share any cell. */
function cellsIntersect(a: GraphicCell, b: GraphicCell): boolean {
  return (
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  )
}

/**
 * Landscape: elements the planner placed on top of one another, pulled apart.
 *
 * Nothing used to do this. `reflowPortrait` runs only when the frame is taller than it
 * is wide, so on 16:9 — every film this app renders — the planner's cells were used
 * exactly as written, and two text elements given the same rows drew over each other in
 * the finished video. The scene rules cannot catch it either: they check ids, counts and
 * one logo per entity, and say nothing about geometry. So the first thing that ever
 * noticed a collision was a human watching the render.
 *
 * Shapes are the deliberate exception, in both directions: a `rect` or `disc` behind a
 * figure and a `rule` under a heading are backgrounds, drawn to be overlapped. They
 * neither block another element nor move themselves, so a card built on a panel keeps
 * its panel.
 *
 * Everything else is placed in scene order, first claim winning, and a colliding element
 * slides DOWN to the first row where its whole cell is clear and still on the grid.
 * Down rather than anywhere: it keeps the planner's column and width, which carry the
 * composition, and it keeps reading order, which carries the meaning. An element that
 * fits nowhere keeps the cell it was given — an overlap a human can see and fix beats an
 * element silently dropped, which is the failure this whole function exists to avoid.
 *
 * A scene whose elements already sit clear of one another is returned unchanged, so this
 * is a no-op for every well-formed card and cannot move a golden on its own.
 */
export function separateOverlaps(scene: GraphicScene): GraphicScene {
  const taken: GraphicCell[] = []
  const elements = scene.elements.map((element) => {
    if (element.kind === 'shape') return element

    const planned = element.cell
    if (!taken.some((cell) => cellsIntersect(planned, cell))) {
      taken.push(planned)
      return element
    }

    // Downward from where it was asked to sit, and only then upward. Down
    // first is what keeps reading order: a figure that collided with the
    // heading above it must not be answered by putting it above the heading.
    const maxRow = GRAPHIC_GRID - planned.rowSpan
    const below = Array.from(
      { length: Math.max(0, maxRow - planned.row + 1) },
      (_, i) => planned.row + i,
    )
    const above = Array.from(
      { length: Math.min(planned.row, maxRow + 1) },
      (_, i) => planned.row - 1 - i,
    )
    for (const row of [...below, ...above]) {
      const candidate = { ...planned, row }
      if (!taken.some((cell) => cellsIntersect(candidate, cell))) {
        taken.push(candidate)
        return { ...element, cell: candidate }
      }
    }
    // Nowhere clear at this size: keep what was planned rather than lose the element.
    taken.push(planned)
    return element
  })
  return { elements }
}

/** Every element's box, in scene order for landscape and reading order for portrait. */
export function graphicLayout(
  scene: GraphicScene,
  frame: GraphicFrame,
  _brand: BrandKitTokens,
): ElementBox[] {
  const portrait = frame.height > frame.width
  const laid = portrait ? reflowPortrait(scene) : separateOverlaps(scene)
  const safe = safeArea(frame)
  const scale = frameScale(frame.width, frame.height)
  return laid.elements.map((element) => {
    const cell = portrait ? (element.portraitCell ?? element.cell) : element.cell
    const box = cellBox(cell, safe, scale)
    if (element.kind === 'text') {
      return {
        id: element.id,
        ...box,
        fontPx: fitFontPx(
          element.content,
          box.w,
          roleBasePx(element.role) * scale,
          MIN_FONT_PX * scale,
        ),
      }
    }
    if (element.kind === 'figure') {
      return {
        id: element.id,
        ...box,
        fontPx: fitFontPx(element.value, box.w, roleBasePx('numbers') * scale, MIN_FONT_PX * scale),
      }
    }
    if (element.kind === 'bars') {
      return {
        id: element.id,
        ...box,
        fontPx: barsGeometry(box, element.items.length, frame).labelPx,
      }
    }
    return { id: element.id, ...box }
  })
}

/** The gap between auto-staggered entrances, and the slow lift across the whole shot. */
const STAGGER_MS = 180
const DRIFT = 0.012

/**
 * When each element enters, by id.
 *
 * `enter` is optional in the planned brief and defaults to `{ kind: 'fade', atMs: 0 }`,
 * so the ordinary case — a planner that wrote no entrances at all — gave every element
 * the same offset of zero. Six things fading up in perfect unison is one cross-fade, not
 * a motion graphic, and it is most of why composed graphics read as static.
 *
 * So: when NOTHING in the scene asks for a time, the elements enter in scene order, one
 * short gap apart. The moment any element carries a non-zero `atMs` the planner has
 * timed the card on purpose and every offset is left exactly as written — including the
 * zeroes, which are then a choice rather than a default.
 *
 * The ambiguity is real and unavoidable: a scene deliberately timed to open all at once
 * is indistinguishable from one that never mentioned timing, because the schema fills
 * both in the same way. This resolves it toward movement, which is what a card on screen
 * for six seconds needs, and any planner that wants simultaneity can still have it by
 * timing one element off zero.
 */
export function staggeredEnterMs(scene: GraphicScene): Map<string, number> {
  const timed = scene.elements.some((element) => element.enter.atMs > 0)
  return new Map(
    scene.elements.map((element, index) => [
      element.id,
      timed ? element.enter.atMs : index * STAGGER_MS,
    ]),
  )
}

/**
 * The slow scale a graphic drifts through across the whole slot, so the card is never a
 * dead still — the same device `HeadlineCard` already carries, and for the same reason.
 *
 * It needs the slot's length, which is exactly what `GraphicCard` was never given:
 * `ChartReveal` and `AnimatedMap` both take `durationInFrames` and spread their motion
 * over it, while the graphic card knew only `useCurrentFrame()` and so could do nothing
 * but a 600 ms entrance followed by five frozen seconds.
 */
export function graphicDrift(frameIndex: number, durationInFrames: number): number {
  if (durationInFrames <= 1) return 1
  return 1 + DRIFT * easeInOut(Math.min(1, Math.max(0, frameIndex / (durationInFrames - 1))))
}

/** Eased 0..1 from `atMs` over the entrance's length, at this frame. */
export function enterProgress(
  frameIndex: number,
  fps: number,
  atMs: number,
  durationMs = ENTER_MS,
): number {
  const t = (frameIndex / fps) * 1000 - atMs
  if (t <= 0) return 0
  return easeInOut(Math.min(1, t / durationMs))
}

/**
 * The figure part-way through its count: each digit group scaled by
 * `progress`, formatted with the same number of decimals and the same
 * thousands separators the final value shows, every other character kept.
 */
export function countedValue(value: string, progress: number): string {
  if (progress >= 1) return value
  return value.replace(/\d[\d,]*(?:\.\d+)?/g, (group) => {
    const decimals = group.includes('.') ? group.split('.')[1]!.length : 0
    const grouped = group.includes(',')
    const number = Number(group.replace(/,/g, '')) * Math.max(0, progress)
    const fixed = number.toFixed(decimals)
    if (!grouped) return fixed
    const [whole, fraction] = fixed.split('.')
    const withCommas = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return fraction === undefined ? withCommas : `${withCommas}.${fraction}`
  })
}
