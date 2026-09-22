import { GRAPHIC_GRID } from '@boom-busters/schemas'
import type {
  BrandKitTokens,
  GraphicCell,
  GraphicColor,
  GraphicElement,
  GraphicScene,
  GraphicTypeRole,
} from '@boom-busters/schemas'
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

// Same arithmetic as `frameScale` in `../components/brand.ts`. Duplicated on purpose:
// nothing in `lib/` imports from `components/` elsewhere in this package, and inverting
// that layering for one line is worse than the duplication. If one changes, check the
// other.
function scaleOf(frame: GraphicFrame): number {
  return Math.min(frame.width, frame.height) / 1080
}

/** The frame minus the caption band and the margin: where elements may sit. */
export function safeArea(frame: GraphicFrame): Box {
  const margin = Math.round(GRAPHIC_MARGIN_PX * scaleOf(frame))
  const captions = captionSafeArea(frame.width, frame.height)
  // The caption block's top: its bottom edge less roughly two lines of caption.
  const captionTop =
    frame.height * captions.bottomFraction - 140 * captions.fontScale * scaleOf(frame)
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
 * The largest size at or under `basePx` at which `text` fits `boxWidth` by the estimate.
 * Never returns below `MIN_FONT_PX`: an extreme label can overflow its box rather than
 * shrink past legibility, because text under 12px reads as a smudge on a phone.
 */
export function fitFontPx(text: string, boxWidth: number, basePx: number): number {
  const glyphs = Math.max(1, text.length)
  const fitted = Math.floor(boxWidth / (glyphs * AVERAGE_GLYPH_EM))
  return Math.max(MIN_FONT_PX, Math.min(basePx, fitted))
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
 * is stacked full-width, in reading order, starting below the lowest edge any pin
 * reaches, each keeping its row span while the stack still fits. When it does not,
 * every auto-flowed span shrinks in proportion to the room left rather than clamping
 * each start in turn, which is what let elements pile onto the same row before: with at
 * most six elements and twelve rows, the stack always fits once nothing is pinned.
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
  const available = Math.max(0, GRAPHIC_GRID - pinnedBottom)

  const toFlow = scene.elements
    .map((element, index) => ({ element, index }))
    .filter((entry) => !entry.element.portraitCell)
    .sort((a, b) => readingOrder(a.element, b.element))

  const spans = toFlow.map((entry) => Math.min(entry.element.cell.rowSpan, GRAPHIC_GRID))
  const wanted = spans.reduce((sum, span) => sum + span, 0)
  const shrink = wanted > available

  const cellByIndex = new Map<number, GraphicCell>()
  let cursor = pinnedBottom
  toFlow.forEach((entry, i) => {
    const rowSpan = shrink ? Math.max(1, Math.floor((spans[i]! * available) / wanted)) : spans[i]!
    // A very large pin can still starve the flow of room even after shrinking to one
    // row each; never let a cell claim a row outside the grid, since that is not a
    // valid GraphicCell. In that unsatisfiable corner this can overlap the pin, which
    // is the lesser failure next to handing a renderer an out-of-grid cell.
    const row = Math.min(cursor, GRAPHIC_GRID - rowSpan)
    cellByIndex.set(entry.index, { col: 0, row, colSpan: GRAPHIC_GRID, rowSpan })
    cursor += rowSpan
  })

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
  const scale = scaleOf(frame)
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
