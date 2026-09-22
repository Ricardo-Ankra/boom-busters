import { GRAPHIC_GRID } from '@boom-busters/schemas'
import type {
  BrandKitTokens,
  GraphicCell,
  GraphicColor,
  GraphicElement,
  GraphicScene,
  GraphicTypeRole,
} from '@boom-busters/schemas'
import { frameScale, typeStyle } from '../components/brand'
import { captionSafeArea } from './captions'
import { easeInOut } from './motion'

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

export const GRAPHIC_MARGIN_PX = 36
export const GRAPHIC_GUTTER_PX = 8
/** A conservative average glyph width, in em, for the fit estimate. */
export const AVERAGE_GLYPH_EM = 0.56
const MIN_FONT_PX = 12
const ENTER_MS = 600
/** A bar's drawn length, as a fraction of its element's box width, at full grow. */
export const BAR_LENGTH_FRACTION = 0.62
const BAR_LABEL_MAX_PX = 28
const BAR_LABEL_HEIGHT_FRACTION = 0.32
const RULE_THICKNESS_PX = 3
const RULE_MIN_THICKNESS_PX = 2

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

/**
 * The largest size at or under `basePx` at which `text` fits `boxWidth` by the estimate.
 * Never returns below `MIN_FONT_PX`: an extreme label can overflow its box rather than
 * shrink past legibility, because text under 12px reads as a smudge on a phone.
 */
export function fitFontPx(text: string, boxWidth: number, basePx: number): number {
  const glyphs = Math.max(1, text.length)
  const fitted = Math.floor(boxWidth / (glyphs * AVERAGE_GLYPH_EM))
  return Math.max(MIN_FONT_PX, Math.min(basePx, fitted))
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
    MIN_FONT_PX,
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

/** Every element's box, in scene order for landscape and reading order for portrait. */
export function graphicLayout(
  scene: GraphicScene,
  frame: GraphicFrame,
  _brand: BrandKitTokens,
): ElementBox[] {
  const portrait = frame.height > frame.width
  const laid = portrait ? reflowPortrait(scene) : scene
  const safe = safeArea(frame)
  const scale = frameScale(frame.width, frame.height)
  return laid.elements.map((element) => {
    const cell = portrait ? (element.portraitCell ?? element.cell) : element.cell
    const box = cellBox(cell, safe, scale)
    if (element.kind === 'text') {
      return {
        id: element.id,
        ...box,
        fontPx: fitFontPx(element.content, box.w, roleBasePx(element.role) * scale),
      }
    }
    if (element.kind === 'figure') {
      return {
        id: element.id,
        ...box,
        fontPx: fitFontPx(element.value, box.w, roleBasePx('numbers') * scale),
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
