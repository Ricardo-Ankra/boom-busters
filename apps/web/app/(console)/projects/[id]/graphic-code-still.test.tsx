import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as Compositions from '@boom-busters/compositions'
import { GRAPHIC_CODE_SOURCE } from '@boom-busters/compositions'
import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { GraphicCode } from '@boom-busters/schemas'
import { GraphicCodeStill } from './graphic-code-still'

/**
 * The board's still of a design written as code (decision 295): the real
 * sandbox (`buildGraphic`, `graphicPropsFor`) over the still's own one-frame
 * scope. Only the font loader is stubbed: jsdom has no fonts to fetch.
 */
vi.mock('@boom-busters/compositions', async (importOriginal) => ({
  ...(await importOriginal<typeof Compositions>()),
  loadBrandFonts: () => Promise.resolve(),
}))

const BRAND = DEFAULT_SETTINGS.brandKit

/** Plain JS, so each source is its own compiled form. */
const code = (source: string, overrides: Partial<GraphicCode> = {}): GraphicCode => ({
  version: 1,
  source,
  compiled: source,
  title: 'Four billion, counted up',
  facts: [],
  words: [
    { text: 'Four', atMs: 300 },
    { text: 'billion', atMs: 700 },
  ],
  durationMs: 6000,
  ...overrides,
})

/** Writes out what the scope hands the code, so each part can be asserted. */
const PROBE = [
  'function Stamp(props) {',
  '  return React.createElement("span", null, props.label + " " + Remotion.useCurrentFrame())',
  '}',
  'function Graphic(props) {',
  '  const frame = Remotion.useCurrentFrame()',
  '  const video = Remotion.useVideoConfig()',
  '  const acme = props.logos["Acme"]',
  '  return React.createElement(',
  '    Remotion.AbsoluteFill,',
  '    { style: { background: Remotion.withAlpha(props.brand.colors.background, 0.5) } },',
  '    React.createElement("p", null, "at " + frame + " of " + video.durationInFrames + " in " + video.width + "x" + video.height + " at " + video.fps),',
  '    React.createElement(Remotion.Sequence, { from: 100 }, React.createElement(Stamp, { label: "inside" })),',
  '    React.createElement(Remotion.Sequence, { from: 150 }, React.createElement(Stamp, { label: "later" })),',
  '    React.createElement(Remotion.Sequence, { from: 0, durationInFrames: 50 }, React.createElement(Stamp, { label: "over" })),',
  '    acme ? React.createElement(Remotion.Img, { src: acme.src }) : null,',
  '    props.data ? React.createElement("p", null, props.data.takeaway) : null,',
  '  )',
  '}',
].join('\n')

const ACME = {
  Acme: { assetId: 'A1', url: 'https://r2.example/acme.png', width: 400, height: 200 },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GraphicCodeStill (decision 295)', () => {
  it('draws the code 60% of the way through, in the 1080p frame, at a quarter size', () => {
    render(<GraphicCodeStill code={code(PROBE)} brand={BRAND} logos={{}} />)
    // 6 s at 30 fps is 180 frames; 60% of the way through is frame 108.
    expect(screen.getByText('at 108 of 180 in 1920x1080 at 30')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Graphic still: Four billion, counted up' }),
    ).toHaveStyle({ width: '480px', height: '270px' })
  })

  it('draws the portrait frame when asked', () => {
    render(<GraphicCodeStill code={code(PROBE)} brand={BRAND} logos={{}} portrait />)
    expect(screen.getByText('at 108 of 180 in 1080x1920 at 30')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Graphic still:/ })).toHaveStyle({
      width: '270px',
      height: '480px',
    })
  })

  it("counts a Sequence's frames from its start, and shows it only inside its window", () => {
    render(<GraphicCodeStill code={code(PROBE)} brand={BRAND} logos={{}} />)
    expect(screen.getByText('inside 8')).toBeInTheDocument()
    expect(screen.queryByText(/^later/)).toBeNull()
    expect(screen.queryByText(/^over/)).toBeNull()
  })

  it("hands the code the library's marks, by title, and a chart its data", () => {
    const data = {
      series: [
        {
          label: 'Share price',
          unit: 'EUR',
          points: [
            { x: '2020-06-17', y: 104.5 },
            { x: '2020-06-26', y: 1.28 },
          ],
        },
      ],
      takeaway: 'From €104 to €1.28 in nine days.',
    }
    const { container } = render(
      <GraphicCodeStill code={code(PROBE)} brand={BRAND} logos={ACME} data={data} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://r2.example/acme.png')
    expect(screen.getByText('From €104 to €1.28 in nine days.')).toBeInTheDocument()
  })

  it('draws the fixture the composition renders, without falling back to its title', () => {
    render(
      <GraphicCodeStill
        code={code(GRAPHIC_CODE_SOURCE, {
          title: 'The fixture',
          // A stored design carries the preamble the check prepended (decision 301).
          compiled: `${MOTION_PREAMBLE}\n${GRAPHIC_CODE_SOURCE}`,
        })}
        brand={BRAND}
        logos={{}}
      />,
    )
    expect(screen.queryByText('The fixture')).toBeNull()
    const still = screen.getByRole('img', { name: 'Graphic still: The fixture' })
    expect(still.textContent?.trim()).not.toBe('')
  })

  it('shows the title when the code throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <GraphicCodeStill
        code={code('function Graphic() { throw new Error("boom") }')}
        brand={BRAND}
        logos={{}}
      />,
    )
    expect(screen.getByText('Four billion, counted up')).toBeInTheDocument()
  })

  it('shows the title when the code does not even build', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<GraphicCodeStill code={code('function Graphic( {')} brand={BRAND} logos={{}} />)
    expect(screen.getByText('Four billion, counted up')).toBeInTheDocument()
  })
})
