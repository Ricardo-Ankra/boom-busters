import type { ChartSeries } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  barGeometry,
  categoryReveal,
  chartLayout,
  lineGeometry,
  niceNumber,
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

describe('niceNumber', () => {
  it('compacts like the board preview', () => {
    expect(niceNumber(1_500_000)).toBe('1.5M')
    expect(niceNumber(2_400)).toBe('2.4k')
    expect(niceNumber(120)).toBe('120')
    expect(niceNumber(0.25)).toBe('0.25')
  })
})
