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

/** The largest size at or under `basePx` at which `text` fits `boxWidth` by the estimate. */
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
 * Portrait: an element with its own `portraitCell` keeps it; the rest are
 * stacked full-width in reading order, each keeping its row span, and the
 * stack is clamped to the grid so nothing falls off the bottom.
 */
export function reflowPortrait(scene: GraphicScene): GraphicScene {
  const ordered = [...scene.elements].sort(readingOrder)
  let row = 0
  const elements = ordered.map((element) => {
    if (element.portraitCell) return element
    const rowSpan = Math.min(element.cell.rowSpan, GRAPHIC_GRID)
    const start = Math.min(row, GRAPHIC_GRID - rowSpan)
    row = start + rowSpan
    return { ...element, portraitCell: { col: 0, row: start, colSpan: GRAPHIC_GRID, rowSpan } }
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
