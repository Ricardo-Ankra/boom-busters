import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { ChartBrief, GraphicBrief, MapBrief } from '@boom-busters/schemas'
import { ChartPreview, GraphicPreview, MapPreview } from './slot-previews'
import type { BrandChartColors } from './slot-previews'

const COLORS: BrandChartColors = {
  accent: '#6366f1',
  surface: '#18181b',
  textPrimary: '#fafafa',
  textSecondary: '#a1a1aa',
  chartSeries: ['#6366f1', '#22c55e', '#f59e0b'],
  collapse: '#ef4444',
}

const brief: MapBrief = {
  type: 'map',
  coversText: 'The money moved from London to Frankfurt.',
  description: 'Route across Europe',
  motion: { kind: 'static' },
  transition: 'cut',
  locations: [
    { label: 'London', lat: 51.5, lon: -0.12 },
    { label: 'Frankfurt', lat: 50.11, lon: 8.68 },
  ],
  route: true,
}

describe('MapPreview', () => {
  it('draws real land behind the markers — the bundled world geometry', () => {
    // The map-has-no-map gap from the Carillion board: since M6.5 the board
    // preview draws the same Natural Earth coastlines as AnimatedMap.
    const { container } = render(<MapPreview brief={brief} colors={COLORS} />)
    expect(screen.getByRole('img', { name: 'Map: London, Frankfurt' })).toBeDefined()
    const land = container.querySelectorAll('path[fill-rule="evenodd"]')
    expect(land.length).toBeGreaterThan(0)
  })

  it('still draws the route and both markers', () => {
    const { container } = render(<MapPreview brief={brief} colors={COLORS} />)
    expect(container.querySelector('polyline')).not.toBeNull()
    expect(screen.getByText('London')).toBeDefined()
    expect(screen.getByText('Frankfurt')).toBeDefined()
  })
})

const CLAIM = '01HQ00000000000000000000AA'

const valuation: ChartBrief = {
  type: 'chart',
  coversText: 'The valuation quadrupled in six months.',
  description: 'Reported valuation, Oct 2022 to Spring 2023',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'bar',
  series: [
    {
      label: 'Reported valuation',
      unit: 'USD Millions',
      points: [
        { x: 'Oct 2022', y: 1000 },
        { x: 'Spring 2023', y: 4000 },
      ],
    },
  ],
  dataRefs: [CLAIM],
  takeaway: 'Four billion dollars, six months, no revenue.',
  reveal: 'draw-on',
}

describe('ChartPreview', () => {
  it('writes each bar its own figure, in money the viewer can read', () => {
    // The Stability chart that started this: a y-axis reading "USD Millions"
    // over "4.0K" is two steps of arithmetic away from the point.
    render(<ChartPreview brief={valuation} colors={COLORS} />)
    expect(screen.getByText('$1 Billion')).toBeDefined()
    expect(screen.getByText('$4 Billion')).toBeDefined()
  })

  it('drops the axis numbers and the corner unit once the bars say them', () => {
    render(<ChartPreview brief={valuation} colors={COLORS} />)
    expect(screen.queryByText('USD Millions')).toBeNull()
    expect(screen.queryByText('4.0k')).toBeNull()
  })

  it('keeps the extremes on a line chart, which has no bar to label', () => {
    render(<ChartPreview brief={{ ...valuation, chartKind: 'line' }} colors={COLORS} />)
    expect(screen.getByText('$4 Billion')).toBeDefined()
    expect(screen.queryByText('USD Millions')).toBeNull()
  })
})

describe('a chart with two measures (decision 259)', () => {
  const dual: ChartBrief = {
    type: 'chart',
    coversText: 'The more it was worth, the more each sale cost them.',
    description: 'Valuation against margin.',
    motion: { kind: 'static' },
    transition: 'cut',
    chartKind: 'line',
    series: [
      {
        label: 'Valuation',
        unit: '$bn',
        points: [
          { x: '2019', y: 1.2 },
          { x: '2022', y: 18.1 },
        ],
      },
      {
        label: 'Operating margin',
        unit: '%',
        axis: 'right',
        points: [
          { x: '2019', y: -4 },
          { x: '2022', y: -148 },
        ],
      },
    ],
    dataRefs: ['01HQ00000000000000000000AA'],
    takeaway: 'The more it was worth, the more each sale cost them.',
    reveal: 'draw-on',
  }

  it('reads each measure in its own unit, on its own side', () => {
    render(<ChartPreview brief={dual} colors={COLORS} />)
    // The valuation's extreme in dollars, the margin's in percent. One shared
    // scale would have written the margin in dollars and flattened it.
    expect(screen.getByText('$18 Billion')).toBeInTheDocument()
    expect(screen.getByText('-148%')).toBeInTheDocument()
    // And each side says which line it belongs to.
    expect(screen.getByText(/Valuation/)).toBeInTheDocument()
    // The long one is cut to the gutter it has, with the ellipsis saying so
    // rather than the SVG edge silently swallowing the rest.
    expect(screen.getByText(/^Operat.*…$/)).toBeInTheDocument()
  })
})

const LOGO_ID = '01HQ00000000000000000000M1'

const graphicBrief: GraphicBrief = {
  type: 'graphic',
  coversText: 'It raised four billion dollars in a single round.',
  description: 'A counting figure beside the mark that backs it.',
  motion: { kind: 'static' },
  transition: 'cut',
  scene: {
    elements: [
      {
        kind: 'text',
        id: 't1',
        cell: { col: 0, row: 0, colSpan: 7, rowSpan: 2 },
        content: 'Raised in a single round',
        role: 'title',
        color: 'textSecondary',
        align: 'start',
        enter: { kind: 'fade', atMs: 0 },
      },
      {
        kind: 'figure',
        id: 'f1',
        cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
        value: '$4bn',
        label: 'valuation',
        claimRef: CLAIM,
        color: 'accent',
        enter: { kind: 'count', atMs: 300 },
      },
      {
        kind: 'logo',
        id: 'l1',
        cell: { col: 8, row: 1, colSpan: 4, rowSpan: 4 },
        entity: 'Stability AI',
        enter: { kind: 'rise', atMs: 200 },
      },
    ],
  },
}

const withAsset: GraphicBrief = {
  ...graphicBrief,
  scene: {
    elements: graphicBrief.scene.elements.map((element) =>
      element.kind === 'logo' ? { ...element, assetId: LOGO_ID } : element,
    ),
  },
}

describe('GraphicPreview', () => {
  it('draws the resting frame from the shared layout, and a dashed box where a mark is missing', () => {
    render(<GraphicPreview brief={graphicBrief} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    const svg = screen.getByRole('img', { name: /graphic: It raised four billion/ })
    expect(svg).toBeInTheDocument()
    expect(screen.getByText('$4bn')).toBeInTheDocument()
    expect(screen.getByText('logo: Stability AI (upload)')).toBeInTheDocument()
  })

  it('draws the mark when the library holds it', () => {
    render(
      <GraphicPreview
        brief={withAsset}
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{ [LOGO_ID]: 'https://r2.example/abc.png' }}
      />,
    )
    expect(document.querySelector('image')?.getAttribute('href')).toBe('https://r2.example/abc.png')
  })
})
