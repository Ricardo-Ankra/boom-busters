import type { ChartKind, ChartSeries } from '@boom-busters/schemas'

/**
 * Chart geometry, pure and unit-tested. The conventions here deliberately
 * mirror the visual board's `ChartPreview` (M5) point for point — same
 * x-domain rule, same zero-inclusive y-domain, same waterfall semantics —
 * because the board is where the human approved the chart. The render may
 * be higher-fidelity than the preview; it must never be a different chart.
 *
 * Conventions:
 * - x domain = the union of every series' labels, in first-seen order;
 * - y domain always includes 0 (no truncated-axis drama) and pads the top 6%;
 * - line/area position points at index/(n-1); bar/stacked/waterfall use bands;
 * - waterfall points are LEVELS, not deltas: each bar spans from the previous
 *   level to this one, falling segments flagged for the collapse colour.
 */

export interface ChartFrame {
  width: number
  height: number
  pad: { top: number; right: number; bottom: number; left: number }
}

export interface ChartLayout {
  labels: string[]
  yMin: number
  yMax: number
  rawMin: number
  rawMax: number
  unit: string
  plotWidth: number
  plotHeight: number
  x: (index: number) => number
  bandX: (index: number) => number
  bandWidth: number
  y: (value: number) => number
}

export function chartLayout(
  series: readonly ChartSeries[],
  kind: ChartKind,
  frame: ChartFrame,
): ChartLayout {
  const plotWidth = frame.width - frame.pad.left - frame.pad.right
  const plotHeight = frame.height - frame.pad.top - frame.pad.bottom

  const labels: string[] = []
  for (const one of series) {
    for (const point of one.points) {
      if (!labels.includes(point.x)) labels.push(point.x)
    }
  }

  const values =
    kind === 'stacked'
      ? labels.map((label) =>
          series.reduce((sum, one) => sum + (one.points.find((p) => p.x === label)?.y ?? 0), 0),
        )
      : series.flatMap((one) => one.points.map((point) => point.y))

  const rawMin = Math.min(...values, 0)
  const rawMax = Math.max(...values)
  const span = rawMax - rawMin || 1
  const yMin = rawMin
  const yMax = rawMax + span * 0.06

  return {
    labels,
    yMin,
    yMax,
    rawMin,
    rawMax,
    unit: series[0]?.unit ?? '',
    plotWidth,
    plotHeight,
    x: (index) =>
      frame.pad.left +
      (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth),
    bandX: (index) => frame.pad.left + (index / labels.length) * plotWidth,
    bandWidth: plotWidth / Math.max(1, labels.length),
    y: (value) => frame.pad.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight,
  }
}

/** Compact number for axis extremes — identical to the board preview's. */
export function niceNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return Math.abs(value) >= 100 ? value.toFixed(0) : `${Number(value.toFixed(2))}`
}

export interface XYPoint {
  x: number
  y: number
}

export interface LineSeries {
  /** Index into brand.colors.chartSeries — in order, never randomly. */
  colourIndex: number
  points: XYPoint[]
  /** Total polyline length in px, for stroke-dash draw-on reveals. */
  length: number
}

export function lineGeometry(series: readonly ChartSeries[], layout: ChartLayout): LineSeries[] {
  return series.map((one, index) => {
    const points = one.points.map((point) => ({
      x: layout.x(layout.labels.indexOf(point.x)),
      y: layout.y(point.y),
    }))
    return { colourIndex: index, points, length: polylineLength(points) }
  })
}

export function polylineLength(points: readonly XYPoint[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index]!.x - points[index - 1]!.x
    const dy = points[index]!.y - points[index - 1]!.y
    length += Math.hypot(dx, dy)
  }
  return length
}

export interface BarRect {
  key: string
  x: number
  y: number
  width: number
  height: number
  colourIndex: number
  categoryIndex: number
}

/** Grouped bars: each category band split between the series. */
export function barGeometry(series: readonly ChartSeries[], layout: ChartLayout): BarRect[] {
  const rects: BarRect[] = []
  layout.labels.forEach((label, categoryIndex) => {
    series.forEach((one, seriesIndex) => {
      const value = one.points.find((point) => point.x === label)?.y
      if (value === undefined) return
      const width = (layout.bandWidth * 0.7) / series.length
      rects.push({
        key: `${label}:${one.label}`,
        x: layout.bandX(categoryIndex) + layout.bandWidth * 0.15 + width * seriesIndex,
        y: layout.y(Math.max(0, value)),
        width,
        height: Math.abs(layout.y(value) - layout.y(0)),
        colourIndex: seriesIndex,
        categoryIndex,
      })
    })
  })
  return rects
}

/** Stacked bars: series stacked upward per category, in series order. */
export function stackedGeometry(series: readonly ChartSeries[], layout: ChartLayout): BarRect[] {
  const rects: BarRect[] = []
  layout.labels.forEach((label, categoryIndex) => {
    let running = 0
    series.forEach((one, seriesIndex) => {
      const value = one.points.find((point) => point.x === label)?.y ?? 0
      const base = running
      running += value
      rects.push({
        key: `${label}:${one.label}`,
        x: layout.bandX(categoryIndex) + layout.bandWidth * 0.15,
        y: layout.y(base + value),
        width: layout.bandWidth * 0.7,
        height: Math.abs(layout.y(base + value) - layout.y(base)),
        colourIndex: seriesIndex,
        categoryIndex,
      })
    })
  })
  return rects
}

export interface WaterfallBar {
  key: string
  x: number
  y: number
  width: number
  height: number
  /** Falling segments render in the semantic collapse colour. */
  falling: boolean
  categoryIndex: number
  /** The level the bar grows away from — the anchor for reveals. */
  fromY: number
}

/** Waterfall over the FIRST series: bars span previous level → this level. */
export function waterfallGeometry(series: ChartSeries, layout: ChartLayout): WaterfallBar[] {
  let previous = series.points[0]?.y ?? 0
  return series.points.map((point, index) => {
    const from = index === 0 ? 0 : previous
    const to = point.y
    if (index > 0) previous = point.y
    return {
      key: point.x,
      x: layout.bandX(index) + layout.bandWidth * 0.2,
      y: layout.y(Math.max(from, to)),
      width: layout.bandWidth * 0.6,
      height: Math.max(1, Math.abs(layout.y(to) - layout.y(from))),
      falling: to < from,
      categoryIndex: index,
      fromY: layout.y(from),
    }
  })
}

/**
 * Draw-on staggering: how revealed category `index` of `count` is when the
 * whole chart's reveal progress is `progress`. Categories cascade left to
 * right, each finishing before the next is halfway — the beat the narration
 * walks the viewer through.
 */
export function categoryReveal(progress: number, index: number, count: number): number {
  if (count <= 1) return clamp01(progress)
  // Each category's ramp occupies half the total, staggered across the rest.
  const start = (index / count) * 0.5
  return clamp01((progress - start) / 0.5)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
