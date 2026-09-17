import type { ChartSeries } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  barFigures,
  barGeometry,
  categoryReveal,
  chartLayout,
  figureBaseline,
  fitFigureSize,
  formatFigure,
  lineGeometry,
  polylineLength,
  stackedGeometry,
  waterfallGeometry,
} from './chart'

const FRAME = { width: 1000, height: 500, pad: { top: 50, right: 50, bottom: 50, left: 100 } }

const revenue: ChartSeries = {
  label: 'Revenue',
  unit: '£bn',
  points: [
    { x: '2014', y: 4.1 },
    { x: '2015', y: 4.6 },
    { x: '2016', y: 5.2 },
  ],
}

const profit: ChartSeries = {
  label: 'Profit',
  unit: '£bn',
  points: [
    { x: '2015', y: 0.2 },
    { x: '2016', y: -0.5 },
    { x: '2017', y: -1.1 },
  ],
}

describe('chartLayout', () => {
  it('takes the x domain as the union of labels in first-seen order', () => {
    const layout = chartLayout([revenue, profit], 'line', FRAME)
    expect(layout.labels).toEqual(['2014', '2015', '2016', '2017'])
  })

  it('always includes zero in the y domain — no truncated-axis drama', () => {
    const layout = chartLayout([revenue], 'line', FRAME)
    expect(layout.yMin).toBe(0)
    // And zero projects inside the plot, at its bottom edge.
    expect(layout.y(0)).toBe(FRAME.height - FRAME.pad.bottom)
  })

  it('pads the top so the peak never kisses the frame', () => {
    const layout = chartLayout([revenue], 'line', FRAME)
    expect(layout.yMax).toBeGreaterThan(5.2)
    expect(layout.y(5.2)).toBeGreaterThan(FRAME.pad.top)
  })

  it('sums series per category for the stacked domain', () => {
    const layout = chartLayout([revenue, revenue], 'stacked', FRAME)
    expect(layout.rawMax).toBeCloseTo(10.4)
  })
})

describe('lineGeometry', () => {
  it('projects every point and measures the polyline for draw-on', () => {
    const layout = chartLayout([revenue], 'line', FRAME)
    const [series] = lineGeometry([revenue], layout)
    expect(series!.points).toHaveLength(3)
    expect(series!.length).toBeCloseTo(polylineLength(series!.points))
    expect(series!.length).toBeGreaterThan(layout.plotWidth * 0.9)
  })
})

describe('barGeometry', () => {
  it('splits each category band between the series', () => {
    const layout = chartLayout([revenue, profit], 'bar', FRAME)
    const rects = barGeometry([revenue, profit], layout)
    // revenue has 3 categories, profit has 3 — six bars, absent points skipped.
    expect(rects).toHaveLength(6)
    const in2015 = rects.filter((rect) => rect.key.startsWith('2015:'))
    expect(in2015).toHaveLength(2)
    expect(in2015[0]!.x).toBeLessThan(in2015[1]!.x)
  })

  it('draws negative bars downward from the baseline', () => {
    const layout = chartLayout([profit], 'bar', FRAME)
    const rects = barGeometry([profit], layout)
    const loss = rects.find((rect) => rect.key.startsWith('2017:'))!
    expect(loss.y).toBe(layout.y(0))
    expect(loss.height).toBeCloseTo(Math.abs(layout.y(-1.1) - layout.y(0)))
  })
})

describe('stackedGeometry', () => {
  it('stacks series in order per category', () => {
    const layout = chartLayout([revenue, revenue], 'stacked', FRAME)
    const rects = stackedGeometry([revenue, revenue], layout)
    const [bottom, top] = rects.filter((rect) => rect.key.startsWith('2014:'))
    expect(bottom!.y).toBeGreaterThan(top!.y)
    expect(top!.y + top!.height).toBeCloseTo(bottom!.y, 5)
  })
})

describe('waterfallGeometry', () => {
  const levels: ChartSeries = {
    label: 'Cash',
    unit: '£m',
    points: [
      { x: 'Start', y: 500 },
      { x: 'H1', y: 320 },
      { x: 'H2', y: 90 },
      { x: 'Rescue', y: 250 },
    ],
  }

  it('spans each bar from the previous level, first bar from zero', () => {
    const layout = chartLayout([levels], 'waterfall', FRAME)
    const bars = waterfallGeometry(levels, layout)
    expect(bars[0]!.fromY).toBe(layout.y(0))
    expect(bars[1]!.fromY).toBeCloseTo(layout.y(500))
  })

  it('flags falling segments for the collapse colour', () => {
    const layout = chartLayout([levels], 'waterfall', FRAME)
    const bars = waterfallGeometry(levels, layout)
    expect(bars.map((bar) => bar.falling)).toEqual([false, true, true, false])
  })
})

describe('categoryReveal', () => {
  it('cascades left to right and every category completes', () => {
    expect(categoryReveal(0, 0, 4)).toBe(0)
    expect(categoryReveal(1, 3, 4)).toBe(1)
    // Midway, early categories are ahead of late ones.
    expect(categoryReveal(0.5, 0, 4)).toBeGreaterThan(categoryReveal(0.5, 3, 4))
  })
})

describe('formatFigure', () => {
  it('folds the unit scale into the number, the way the viewer says it', () => {
    // The case that started this: a bar of 4000 against "USD Millions" is
    // four billion dollars, and the screen must say so.
    expect(formatFigure(4000, 'USD Millions')).toBe('$4 Billion')
    expect(formatFigure(1000, 'USD Millions')).toBe('$1 Billion')
    expect(formatFigure(1.9, '€bn')).toBe('€1.9 Billion')
    expect(formatFigure(0.1, '€bn')).toBe('€100 Million')
    expect(formatFigure(4_000_000_000, 'USD')).toBe('$4 Billion')
    expect(formatFigure(2.4, '$tn')).toBe('$2.4 Trillion')
  })

  it('leaves small numbers alone, grouped and with their currency', () => {
    expect(formatFigure(104.5, '€')).toBe('€105')
    expect(formatFigure(1.28, '€')).toBe('€1.28')
    expect(formatFigure(4000, 'GBP')).toBe('£4,000')
    expect(formatFigure(0, '£bn')).toBe('£0')
  })

  it('writes a percentage as a percentage and keeps a short noun', () => {
    expect(formatFigure(42.5, '%')).toBe('42.5%')
    expect(formatFigure(4000, 'jobs')).toBe('4,000 jobs')
    // A whole sentence of a unit would not fit under a bar; the number wins.
    expect(formatFigure(4000, 'full-time equivalent staff')).toBe('4,000')
  })

  it('keeps the minus in front of the money', () => {
    expect(formatFigure(-1.1, '£bn')).toBe('-£1.1 Billion')
  })

  it('keeps a currency it has no symbol for as its code', () => {
    expect(formatFigure(3, 'ZAR bn')).toBe('R3 Billion')
    expect(formatFigure(3, 'CHF m')).toBe('CHF 3 Million')
  })
})

describe('barFigures', () => {
  const layout = chartLayout([revenue], 'bar', FRAME)

  it('gives every bar its own figure, above the bar', () => {
    const figures = barFigures([revenue], 'bar', layout)
    expect(figures.map((figure) => figure.text)).toEqual([
      '£4.1 Billion',
      '£4.6 Billion',
      '£5.2 Billion',
    ])
    expect(figures.every((figure) => !figure.below)).toBe(true)
    // Centred on the bar it labels.
    const rects = barGeometry([revenue], layout)
    expect(figures[0]!.x).toBeCloseTo(rects[0]!.x + rects[0]!.width / 2)
  })

  it('puts the figure under a bar that went the other way', () => {
    const stacked = chartLayout([profit], 'bar', FRAME)
    const figures = barFigures([profit], 'bar', stacked)
    const falling = figures.find((figure) => figure.text === '-£1.1 Billion')
    expect(falling?.below).toBe(true)
  })

  it('reads a stacked column as its total, once', () => {
    const stackedLayout = chartLayout([revenue, profit], 'stacked', FRAME)
    const figures = barFigures([revenue, profit], 'stacked', stackedLayout)
    expect(figures).toHaveLength(stackedLayout.labels.length)
    // 2015: 4.6 revenue + 0.2 profit.
    expect(figures[1]!.text).toBe('£4.8 Billion')
  })

  it('reads a waterfall bar as the level it arrives at, under it when it fell', () => {
    const fall: ChartSeries = {
      label: 'Cash',
      unit: '€bn',
      points: [
        { x: '2018', y: 1.9 },
        { x: 'H1 19', y: 1.4 },
      ],
    }
    const waterfallLayout = chartLayout([fall], 'waterfall', FRAME)
    const figures = barFigures([fall], 'waterfall', waterfallLayout)
    expect(figures.map((figure) => figure.text)).toEqual(['€1.9 Billion', '€1.4 Billion'])
    expect(figures[0]!.below).toBe(false)
    expect(figures[1]!.below).toBe(true)
  })

  it('gives a line chart none: there is no bar to sit a figure on', () => {
    expect(barFigures([revenue], 'line', layout)).toEqual([])
  })
})

describe('figure type', () => {
  const layout = chartLayout([revenue], 'bar', FRAME)
  const figures = barFigures([revenue], 'bar', layout)

  it('sits above the bar, and under it when the bar fell', () => {
    const above = figureBaseline({ ...figures[0]!, below: false, edgeY: 200 }, 30)
    const below = figureBaseline({ ...figures[0]!, below: true, edgeY: 200 }, 30)
    expect(above).toBeLessThan(200)
    expect(below).toBeGreaterThan(200)
  })

  it('shrinks to fit the tightest figure, and never past the floor', () => {
    expect(fitFigureSize(figures, 30, 18)).toBeLessThanOrEqual(30)
    const cramped = figures.map((figure) => ({ ...figure, slotWidth: 10 }))
    expect(fitFigureSize(cramped, 30, 18)).toBe(18)
    const roomy = figures.map((figure) => ({ ...figure, slotWidth: 10_000 }))
    expect(fitFigureSize(roomy, 30, 18)).toBe(30)
  })

  it('is one size for the whole chart, not one per bar', () => {
    const mixed = [
      { ...figures[0]!, slotWidth: 400 },
      { ...figures[1]!, slotWidth: 120 },
    ]
    const size = fitFigureSize(mixed, 30, 6)
    expect(size).toBeCloseTo(120 / (mixed[1]!.text.length * 0.58))
  })
})
