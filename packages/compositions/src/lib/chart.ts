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
 *   level to this one, falling segments flagged for the collapse colour;
 * - every bar carries its own figure, written the way the viewer would say it
 *   ("$4 Billion"), because that figure is the thing the chart came to show
 *   (decision 254).
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

/**
 * A figure written the way a viewer would say it out loud: "$4 Billion",
 * "€1.9 Billion", "42%", "£104.5" (decision 254). It replaces the old compact
 * form, which asked the viewer to read "4.0k" against a "USD Millions" label
 * parked in the corner and do the multiplication themselves.
 *
 * `unit` is prose from the planner ("USD Millions", "€bn", "%", "GBP"), so it
 * is parsed for a currency and a scale, and THE SCALE IS FOLDED INTO THE
 * NUMBER: 4000 in "USD Millions" is four billion dollars, and four billion
 * dollars is what the screen says. A unit that is neither currency nor scale
 * ("barrels", "jobs") rides along as a suffix while it is short enough to sit
 * under a bar.
 */
export function formatFigure(value: number, unit: string): string {
  const { prefix, scale, suffix } = parseUnit(unit)
  const magnitude = value * scale
  const sign = magnitude < 0 ? '-' : ''
  const size = Math.abs(magnitude)

  const step = WORD_SCALES.find((one) => size >= one.at)
  if (step) {
    const scaled = size / step.at
    return `${sign}${prefix}${trimNumber(scaled, scaled < 10 ? 1 : 0)} ${step.word}${suffix}`
  }
  return `${sign}${prefix}${group(trimNumber(size, size >= 100 ? 0 : 2))}${suffix}`
}

const WORD_SCALES = [
  { at: 1e12, word: 'Trillion' },
  { at: 1e9, word: 'Billion' },
  { at: 1e6, word: 'Million' },
] as const

/** Currencies that have a symbol everyone reads; anything else keeps its code. */
const CURRENCY_SYMBOLS = ['$', '€', '£', '¥', '₹']
const CURRENCY_CODES: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  INR: '₹',
  CHF: 'CHF ',
  CNY: 'CN¥',
  AUD: 'A$',
  CAD: 'C$',
  NZD: 'NZ$',
  ZAR: 'R',
  BRL: 'R$',
  SEK: 'SEK ',
  NOK: 'NOK ',
  DKK: 'DKK ',
  HKD: 'HK$',
  SGD: 'S$',
  KRW: '₩',
  MXN: 'MX$',
  RUB: '₽',
}

const SCALE_TOKENS: Record<string, number> = {
  trillion: 1e12,
  trillions: 1e12,
  tn: 1e12,
  billion: 1e9,
  billions: 1e9,
  bn: 1e9,
  b: 1e9,
  million: 1e6,
  millions: 1e6,
  mn: 1e6,
  m: 1e6,
  thousand: 1e3,
  thousands: 1e3,
  k: 1e3,
}

function parseUnit(raw: string): { prefix: string; scale: number; suffix: string } {
  const text = raw.trim()
  // A percentage is its own thing: no currency, no scale, sign written after.
  if (text.includes('%')) return { prefix: '', scale: 1, suffix: '%' }

  let prefix = ''
  let rest = text
  const symbol = CURRENCY_SYMBOLS.find((one) => rest.includes(one))
  if (symbol !== undefined) {
    prefix = symbol
    rest = rest.replace(symbol, ' ')
  } else {
    const code = (rest.match(/[A-Za-z]{3}/g) ?? []).find(
      (one) => CURRENCY_CODES[one.toUpperCase()] !== undefined,
    )
    if (code !== undefined) {
      prefix = CURRENCY_CODES[code.toUpperCase()] ?? ''
      rest = rest.replace(code, ' ')
    }
  }

  let scale = 1
  const leftover: string[] = []
  for (const token of rest.split(/[^A-Za-z]+/).filter(Boolean)) {
    const step = SCALE_TOKENS[token.toLowerCase()]
    if (step !== undefined && scale === 1) {
      scale = step
      continue
    }
    // Fragments shorter than three letters ("US", "of") are noise, not nouns.
    if (token.length >= 3) leftover.push(token)
  }
  const noun = leftover.join(' ')
  return { prefix, scale, suffix: noun !== '' && noun.length <= 12 ? ` ${noun}` : '' }
}

/** Fixed decimals, then trailing zeros dropped: 4.0 reads "4", 1.90 "1.9". */
function trimNumber(value: number, decimals: number): string {
  return `${Number(value.toFixed(decimals))}`
}

/** Thousands separators, written here rather than left to a host locale. */
function group(digits: string): string {
  const [whole = '', fraction] = digits.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
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
  /** The number the bar stands for: what its figure says. */
  value: number
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
        value,
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
        value,
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
  /** The level the bar arrives at: what its figure says. */
  value: number
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
      value: to,
    }
  })
}

/** Rough width of one monospaced figure character, in ems. */
export const FIGURE_CHAR_EM = 0.58

export interface BarFigure {
  key: string
  /** Centre of the bar this figure belongs to. */
  x: number
  /** The end of the bar the figure sits against. */
  edgeY: number
  /** A bar that fell carries its figure underneath, not above. */
  below: boolean
  text: string
  categoryIndex: number
  /** Distance to the next figure's centre, the width the type must fit in. */
  slotWidth: number
}

/**
 * The house rule for bar charts (decision 254): every bar says its own number,
 * at the end of the bar: above when it grew upward, underneath when it fell.
 * No y-axis numbers and no unit parked in a corner; the figure carries its own
 * currency and magnitude, because the figure is what the chart came to show.
 *
 * One figure per bar for grouped bars and waterfalls; one per column for a
 * stack, reading the column's TOTAL, since that is the number a stacked
 * column is making. Kinds that are not bars get none: a line has no bar to sit
 * a figure on, and labelling every point would be noise.
 */
export function barFigures(
  series: readonly ChartSeries[],
  kind: ChartKind,
  layout: ChartLayout,
): BarFigure[] {
  if (kind === 'bar') {
    // Figures sit bar-centre to bar-centre; with one series that is the whole
    // band, with several it is one bar's width.
    const slotWidth =
      series.length > 1 ? (layout.bandWidth * 0.7) / series.length : layout.bandWidth
    return barGeometry(series, layout).map((rect) => ({
      key: rect.key,
      x: rect.x + rect.width / 2,
      edgeY: rect.value < 0 ? rect.y + rect.height : rect.y,
      below: rect.value < 0,
      text: formatFigure(rect.value, layout.unit),
      categoryIndex: rect.categoryIndex,
      slotWidth,
    }))
  }

  if (kind === 'stacked') {
    const rects = stackedGeometry(series, layout)
    return layout.labels.flatMap((label, categoryIndex) => {
      const column = rects.filter((rect) => rect.categoryIndex === categoryIndex)
      if (column.length === 0) return []
      const total = series.reduce(
        (sum, one) => sum + (one.points.find((point) => point.x === label)?.y ?? 0),
        0,
      )
      const top = column.reduce((best, rect) => (rect.y < best.y ? rect : best))
      const bottom = column.reduce((best, rect) =>
        rect.y + rect.height > best.y + best.height ? rect : best,
      )
      return [
        {
          key: label,
          x: top.x + top.width / 2,
          edgeY: total < 0 ? bottom.y + bottom.height : top.y,
          below: total < 0,
          text: formatFigure(total, layout.unit),
          categoryIndex,
          slotWidth: layout.bandWidth,
        },
      ]
    })
  }

  if (kind === 'waterfall' && series[0] !== undefined) {
    return waterfallGeometry(series[0], layout).map((bar) => ({
      key: bar.key,
      x: bar.x + bar.width / 2,
      // A falling bar arrives at its bottom edge; that is where the level is.
      edgeY: bar.falling ? bar.y + bar.height : bar.y,
      below: bar.falling,
      text: formatFigure(bar.value, layout.unit),
      categoryIndex: bar.categoryIndex,
      slotWidth: layout.bandWidth,
    }))
  }

  return []
}

/** The text baseline for a figure at `fontSize`, clear of the bar it labels. */
export function figureBaseline(figure: BarFigure, fontSize: number): number {
  const gap = fontSize * 0.45
  return figure.below ? figure.edgeY + gap + fontSize * 0.78 : figure.edgeY - gap
}

/**
 * ONE type size for every figure on a chart: the largest that still fits the
 * tightest of them in its slot, never below `min`. Uniform beats per-bar
 * sizing: a chart whose numbers change size between bars looks broken, and a
 * figure that overruns its neighbour is worse than a smaller one.
 */
export function fitFigureSize(figures: readonly BarFigure[], base: number, min: number): number {
  let size = base
  for (const figure of figures) {
    const characters = Math.max(1, figure.text.length)
    size = Math.min(size, figure.slotWidth / (characters * FIGURE_CHAR_EM))
  }
  return Math.max(min, Math.min(base, size))
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
