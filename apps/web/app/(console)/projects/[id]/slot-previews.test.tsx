import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  barLengthPx,
  barsGeometry,
  figureLabelBasePx,
  graphicLayout,
  roleFontPx,
  underlineBar,
} from '@boom-busters/compositions/graphic'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { ChartBrief, MapBrief } from '@boom-busters/schemas'
import { ChartPreview, GraphicPreview, GraphicSteps, MapPreview } from './slot-previews'
import type { DesignedGraphicBrief } from './slot-previews'
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

const graphicBrief: DesignedGraphicBrief = {
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
        emphasis: 'underline',
      },
      {
        kind: 'figure',
        align: 'start',
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
      {
        kind: 'shape',
        id: 's1',
        cell: { col: 0, row: 6, colSpan: 2, rowSpan: 2 },
        form: 'disc',
        color: 'textSecondary',
        opacity: 1,
        enter: { kind: 'fade', atMs: 0 },
      },
    ],
  },
}

const withAsset: DesignedGraphicBrief = {
  ...graphicBrief,
  scene: {
    elements: graphicBrief.scene.elements.map((element) =>
      element.kind === 'logo' ? { ...element, assetId: LOGO_ID } : element,
    ),
  },
}

/** The preview's own resting frame (`GRAPHIC_WIDTH`/`GRAPHIC_HEIGHT` in `slot-previews.tsx`). */
const GRAPHIC_FRAME = { width: 480, height: 270 }

const barsBrief: DesignedGraphicBrief = {
  type: 'graphic',
  coversText: 'It raised more than it burned.',
  description: 'Two bars compared.',
  motion: { kind: 'static' },
  transition: 'cut',
  scene: {
    elements: [
      {
        kind: 'bars',
        id: 'b1',
        cell: { col: 0, row: 0, colSpan: 12, rowSpan: 4 },
        color: 'collapse',
        enter: { kind: 'fade', atMs: 0 },
        items: [
          { label: 'raised', value: 4, display: '$4bn', claimRef: CLAIM },
          { label: 'burned', value: 3.9, display: '$3.9bn', claimRef: CLAIM },
        ],
      },
    ],
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

  // A title, a heading or a caption drawn at its raw fitted size, with no
  // role scale applied, is wrong for every role whose brand scale is not 1,
  // and would still pass a test that only checks the text is present. These
  // assert the actual rendered number against the one shared function that
  // computes it, `roleFontPx`, so drift between the card and the preview
  // shows up here rather than only on screen.
  it('sizes a title through the role scale, not the raw fitted size from the layout', () => {
    render(<GraphicPreview brief={graphicBrief} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    const brand = resolveBrandKit(DEFAULT_SETTINGS)
    const boxes = graphicLayout(graphicBrief.scene, GRAPHIC_FRAME, brand)
    const titleBox = boxes.find((box) => box.id === 't1')!

    const title = screen.getByText('Raised in a single round')
    expect(title).toHaveAttribute('font-size', String(roleFontPx('title', titleBox.fontPx!, brand)))
  })

  it("sizes the figure's caption through the same shared helper the card uses", () => {
    render(<GraphicPreview brief={graphicBrief} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    const brand = resolveBrandKit(DEFAULT_SETTINGS)

    const label = screen.getByText('valuation')
    expect(label).toHaveAttribute(
      'font-size',
      String(roleFontPx('captions', figureLabelBasePx(GRAPHIC_FRAME), brand)),
    )
  })

  // `numbers` is 1 in DEFAULT_SETTINGS (the report's own explanation for why
  // an unscaled figure value looked right and hid the bug there), so asserting
  // against it alone cannot tell a wired-in `roleFontPx` call apart from the
  // raw value it wraps. A brand kit whose `numbers` role actually scales
  // makes the same two sites (the bars value, and the figure's own value
  // below) fail if the preview ever stops reading the scale.
  const scaledBrand = {
    ...DEFAULT_SETTINGS.brandKit,
    typography: {
      ...DEFAULT_SETTINGS.brandKit.typography,
      numbers: { ...DEFAULT_SETTINGS.brandKit.typography.numbers, sizeScale: 1.3 },
    },
  }

  it('sizes a bars row label and its value through the role scale too', () => {
    render(<GraphicPreview brief={barsBrief} brand={scaledBrand} logoUrls={{}} />)
    const brand = resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: scaledBrand })
    const boxes = graphicLayout(barsBrief.scene, GRAPHIC_FRAME, brand)
    const barsBox = boxes.find((box) => box.id === 'b1')!
    const { labelPx } = barsGeometry(barsBox, 2, GRAPHIC_FRAME)

    const label = screen.getByText('raised')
    expect(label).toHaveAttribute('font-size', String(roleFontPx('captions', labelPx, brand)))

    const value = screen.getByText('$4bn')
    const expectedValuePx = roleFontPx('numbers', labelPx * 1.2, brand)
    expect(value).toHaveAttribute('font-size', String(expectedValuePx))
    // The 1.3 scale must move the number off the raw, unscaled one: proof
    // this cannot pass by the same coincidence `numbers: 1` allows.
    expect(expectedValuePx).not.toBe(Math.round(labelPx * 1.2))
  })

  it("sizes the figure's own value through the numbers role scale, not just its label", () => {
    render(<GraphicPreview brief={graphicBrief} brand={scaledBrand} logoUrls={{}} />)
    const brand = resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: scaledBrand })
    const boxes = graphicLayout(graphicBrief.scene, GRAPHIC_FRAME, brand)
    const figureBox = boxes.find((box) => box.id === 'f1')!

    const value = screen.getByText('$4bn')
    const expectedValuePx = roleFontPx('numbers', figureBox.fontPx!, brand)
    expect(value).toHaveAttribute('font-size', String(expectedValuePx))
    expect(expectedValuePx).not.toBe(figureBox.fontPx)
  })

  it('draws a solid accent bar under emphasised text, not a wash behind it', () => {
    render(<GraphicPreview brief={graphicBrief} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    const brand = resolveBrandKit(DEFAULT_SETTINGS)
    const boxes = graphicLayout(graphicBrief.scene, GRAPHIC_FRAME, brand)
    const box = boxes.find((entry) => entry.id === 't1')!
    const fontPx = roleFontPx('title', box.fontPx!, brand)
    // t1 carries `emphasis: 'underline'`.
    const title = screen.getByText('Raised in a single round')
    const bar = title.previousElementSibling
    expect(bar?.tagName).toBe('rect')
    // The accent colour at full opacity, in the card's own geometry from `underlineBar`.
    expect(bar).toHaveAttribute('fill', brand.colors.accent)
    const expected = underlineBar(fontPx, Number(bar!.getAttribute('width')), 1, GRAPHIC_FRAME)
    const centre = box.y + box.h / 2
    expect(Number(bar!.getAttribute('y'))).toBeCloseTo(centre + expected.topFromCentrePx, 5)
    expect(Number(bar!.getAttribute('height'))).toBeCloseTo(expected.thicknessPx, 5)
    // Below the text's centre line by more than half its size: under the glyphs, not behind them.
    expect(Number(bar!.getAttribute('y'))).toBeGreaterThan(centre + fontPx * 0.4)
    expect(Number(bar!.getAttribute('width'))).toBeGreaterThan(0)
  })

  it('draws the same bar under an underlined figure value', () => {
    const underlined: DesignedGraphicBrief = {
      ...graphicBrief,
      scene: {
        elements: graphicBrief.scene.elements.map((element) =>
          element.kind === 'figure' ? { ...element, emphasis: 'underline' as const } : element,
        ),
      },
    }
    render(<GraphicPreview brief={underlined} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    const brand = resolveBrandKit(DEFAULT_SETTINGS)
    const value = screen.getByText('$4bn')
    const bar = value.previousElementSibling
    expect(bar?.tagName).toBe('rect')
    expect(bar).toHaveAttribute('fill', brand.colors.accent)
    const boxes = graphicLayout(underlined.scene, GRAPHIC_FRAME, brand)
    const fontPx = roleFontPx('numbers', boxes.find((entry) => entry.id === 'f1')!.fontPx!, brand)
    const expected = underlineBar(fontPx, Number(bar!.getAttribute('width')), 1, GRAPHIC_FRAME)
    expect(Number(bar!.getAttribute('height'))).toBeCloseTo(expected.thicknessPx, 5)
    // A figure with no emphasis draws no bar before its value.
    expect(screen.queryAllByText('valuation')[0]?.previousElementSibling?.tagName).not.toBe('rect')
  })

  it('draws a centred figure, its caption and its bar from the middle of the box', () => {
    const centred: DesignedGraphicBrief = {
      ...graphicBrief,
      scene: {
        elements: graphicBrief.scene.elements.map((element) =>
          element.kind === 'figure'
            ? { ...element, align: 'center' as const, emphasis: 'underline' as const }
            : element,
        ),
      },
    }
    render(<GraphicPreview brief={centred} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    const brand = resolveBrandKit(DEFAULT_SETTINGS)
    const box = graphicLayout(centred.scene, GRAPHIC_FRAME, brand).find(
      (entry) => entry.id === 'f1',
    )!
    const middle = box.x + box.w / 2

    const value = screen.getByText('$4bn')
    expect(value).toHaveAttribute('text-anchor', 'middle')
    expect(Number(value.getAttribute('x'))).toBeCloseTo(middle, 5)
    const label = screen.getByText('valuation')
    expect(label).toHaveAttribute('text-anchor', 'middle')
    expect(Number(label.getAttribute('x'))).toBeCloseTo(middle, 5)

    // The bar is centred on the same line as the value it underlines.
    const bar = value.previousElementSibling!
    const barCentre = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2
    expect(barCentre).toBeCloseTo(middle, 5)
  })

  it('draws an end-aligned figure against the right of its box, and a default one at the left', () => {
    const withAlign = (align: 'start' | 'end'): DesignedGraphicBrief => ({
      ...graphicBrief,
      scene: {
        elements: graphicBrief.scene.elements.map((element) =>
          element.kind === 'figure' ? { ...element, align } : element,
        ),
      },
    })
    const brand = resolveBrandKit(DEFAULT_SETTINGS)
    const box = graphicLayout(graphicBrief.scene, GRAPHIC_FRAME, brand).find(
      (entry) => entry.id === 'f1',
    )!

    const { unmount } = render(
      <GraphicPreview brief={withAlign('start')} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />,
    )
    expect(screen.getByText('$4bn')).toHaveAttribute('text-anchor', 'start')
    expect(Number(screen.getByText('$4bn').getAttribute('x'))).toBeCloseTo(box.x, 5)
    unmount()

    render(
      <GraphicPreview brief={withAlign('end')} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />,
    )
    expect(screen.getByText('$4bn')).toHaveAttribute('text-anchor', 'end')
    expect(Number(screen.getByText('$4bn').getAttribute('x'))).toBeCloseTo(box.x + box.w, 5)
    expect(screen.getByText('valuation')).toHaveAttribute('text-anchor', 'end')
  })

  it('draws a disc as an ellipse fitted to its box, matching the card rather than a geometric circle', () => {
    const { container } = render(
      <GraphicPreview brief={graphicBrief} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />,
    )
    const brand = resolveBrandKit(DEFAULT_SETTINGS)
    const boxes = graphicLayout(graphicBrief.scene, GRAPHIC_FRAME, brand)
    const discBox = boxes.find((box) => box.id === 's1')!
    // The card's borderRadius: '50%' on a non-square box is an ellipse, not
    // a circle (GraphicCard.tsx draws it on the raw box, never a square
    // crop), so this box must genuinely differ in width and height for the
    // assertion below to mean anything.
    expect(discBox.w).not.toBeCloseTo(discBox.h, 0)
    expect(container.querySelector('circle')).toBeNull()
    const ellipse = container.querySelector('ellipse')
    expect(ellipse).not.toBeNull()
    expect(ellipse).toHaveAttribute('rx', String(discBox.w / 2))
    expect(ellipse).toHaveAttribute('ry', String(discBox.h / 2))
  })
})

describe('a graphic built in steps (decision 290)', () => {
  const staged: DesignedGraphicBrief = {
    type: 'graphic',
    coversText: 'It was worth one billion, then four.',
    description: 'Two steps.',
    motion: { kind: 'static' },
    transition: 'cut',
    scene: {
      elements: [
        {
          kind: 'text',
          id: 't1',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 2 },
          content: 'On paper',
          role: 'title',
          color: 'textSecondary',
          align: 'start',
          enter: { kind: 'fade', atMs: 0 },
          exit: { kind: 'fade', atMs: 4000 },
        },
        {
          kind: 'text',
          id: 't2',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 2 },
          content: 'Four times',
          role: 'title',
          color: 'textPrimary',
          align: 'start',
          enter: { kind: 'rise', atMs: 4500 },
          emphasis: { kind: 'color', atMs: 6000, to: 'collapse' },
        },
        {
          kind: 'bars',
          id: 'b1',
          cell: { col: 0, row: 3, colSpan: 12, rowSpan: 4 },
          color: 'series0',
          enter: { kind: 'fade', atMs: 300 },
          items: [
            { label: 'then', value: 1, display: '$1bn', claimRef: CLAIM },
            { label: 'later', value: 4, display: '$4bn', claimRef: CLAIM, atMs: 2000 },
          ],
        },
      ],
    },
  }
  const tokens = resolveBrandKit(DEFAULT_SETTINGS)
  const barsBox = graphicLayout(staged.scene, GRAPHIC_FRAME, tokens).find((b) => b.id === 'b1')!
  const barWidth = (display: string) =>
    Number(screen.getByText(display).previousElementSibling?.getAttribute('width'))

  it('draws the end by default: what stays, every bar on the final scale, colours after their shift', () => {
    render(<GraphicPreview brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    expect(screen.queryByText('On paper')).toBeNull()
    expect(screen.getByText('Four times')).toHaveAttribute('fill', tokens.colors.semantic.collapse)
    expect(barWidth('$1bn')).toBeCloseTo(barLengthPx(barsBox.w, 1 / 4))
    expect(barWidth('$4bn')).toBeCloseTo(barLengthPx(barsBox.w, 1))
  })

  it('draws an earlier moment: who is on screen then, the bars grown by then, on their scale then', () => {
    render(
      <GraphicPreview brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} atMs={1000} />,
    )
    expect(screen.getByText('On paper')).toBeInTheDocument()
    expect(screen.queryByText('Four times')).toBeNull()
    expect(screen.queryByText('$4bn')).toBeNull()
    // Alone, the first bar is the full length.
    expect(barWidth('$1bn')).toBeCloseTo(barLengthPx(barsBox.w, 1))
  })

  it('shows a frame per step, labelled by time, and nothing for a graphic that never steps', () => {
    render(<GraphicSteps brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    const list = screen.getByRole('list', { name: 'Graphic steps' })
    expect(
      within(list)
        .getAllByRole('img')
        .map((img) => img.getAttribute('aria-label')),
    ).toEqual(['Step: At 0:04', 'Step: End'])
    expect(within(list).getAllByText('On paper')).toHaveLength(1)

    const { container } = render(
      <GraphicSteps brief={graphicBrief} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('gives every drawing its own clip ids, so two frames of one graphic never share one', () => {
    const { container } = render(
      <>
        <GraphicPreview brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />
        <GraphicPreview
          brief={staged}
          brand={DEFAULT_SETTINGS.brandKit}
          logoUrls={{}}
          atMs={1000}
        />
      </>,
    )
    const ids = [...container.querySelectorAll('clipPath')].map((clip) => clip.id)
    expect(ids.length).toBeGreaterThan(1)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
