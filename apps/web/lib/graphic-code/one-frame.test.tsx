import { Thumbnail } from '@remotion/player'
import { render } from '@testing-library/react'
import * as React from 'react'
import { Easing, interpolate, spring } from 'remotion'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGraphic,
  graphicBrand,
  remotionScope,
  safeInsets,
  type GraphicProps,
  type GraphicScope,
} from '@boom-busters/compositions/graphic-code'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import { makeOneFrame } from './one-frame'

/**
 * The one-frame shim against Remotion 4.0.512 itself (final review I3). Each
 * case is rendered twice in jsdom: through Remotion's own `Sequence` and
 * `AbsoluteFill` (`remotionScope`, inside a `Thumbnail`, which gives them the
 * timeline and the video config the Player and the film give them), and
 * through the shim the dry run and the board's still use. Per frame, both
 * must show the same text, the same elements with the same layout and the
 * same error. A Remotion upgrade that changes either component fails here.
 *
 * The cases are plain JavaScript (`h` is `React.createElement`), as compiled
 * code is: esbuild does not run under jsdom.
 */

const WIDTH = 1920
const HEIGHT = 1080
const FPS = 30
const DURATION = 90

const PROPS: GraphicProps = {
  brand: graphicBrand(resolveBrandKit(DEFAULT_SETTINGS)),
  words: [],
  durationMs: (DURATION / FPS) * 1000,
  safeArea: safeInsets({ width: WIDTH, height: HEIGHT }),
  logos: {},
}

const { FrameContext, oneFrameScope } = makeOneFrame(React, { interpolate, spring, Easing })
const SHIM = oneFrameScope({ width: WIDTH, height: HEIGHT }, DURATION, FPS)

/** Writes the error a render throws into the page, so both paths can be compared by it. */
class Caught extends React.Component<{ children: React.ReactNode }, { message: string | null }> {
  override state = { message: null as string | null }

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  override render() {
    return this.state.message === null ? (
      this.props.children
    ) : (
      <p data-error="">{this.state.message}</p>
    )
  }
}

/** The graphic's output under one root, so both paths are read from the same place. */
function Probe({ code, scope }: { code: string; scope: GraphicScope }) {
  const Graphic = React.useMemo(() => buildGraphic(code, scope), [code, scope])
  return (
    <div data-root="">
      <Caught>
        <Graphic {...PROPS} />
      </Caught>
    </div>
  )
}

/** The style a layout depends on, with a full-frame span read the same whichever way it is written. */
function layoutOf(element: HTMLElement) {
  const { style } = element
  const zero = (value: string | undefined) => value === '0' || value === '0px'
  const inset = style.getPropertyValue('inset') || (style as unknown as { inset?: string }).inset
  const fills =
    (zero(style.top) && zero(style.right) && zero(style.bottom) && zero(style.left)) || zero(inset)
  return {
    position: style.position,
    fills,
    width: style.width,
    height: style.height,
    display: style.display,
    flexDirection: style.flexDirection,
    justifyContent: style.justifyContent,
    gap: style.gap,
    opacity: style.opacity,
  }
}

interface Tree {
  tag: string
  text: string
  layout: ReturnType<typeof layoutOf>
  children: Tree[]
}

function treeOf(element: HTMLElement): Tree {
  return {
    tag: element.tagName.toLowerCase(),
    text: [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join(''),
    layout: layoutOf(element),
    children: [...element.children].map((child) => treeOf(child as HTMLElement)),
  }
}

function read(container: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-root]')
  if (!root) throw new Error('the graphic did not render')
  return {
    text: root.textContent ?? '',
    tree: [...root.children].map((child) => treeOf(child as HTMLElement)),
  }
}

/** The frame through Remotion's own components, as the Player and the film draw it. */
function throughRemotion(code: string, frame: number) {
  const Component = () => <Probe code={code} scope={remotionScope()} />
  const { container, unmount } = render(
    <Thumbnail
      component={Component}
      compositionWidth={WIDTH}
      compositionHeight={HEIGHT}
      durationInFrames={DURATION}
      fps={FPS}
      frameToDisplay={frame}
    />,
  )
  const result = read(container)
  unmount()
  return result
}

/** The frame through the shim, as the dry run and the still draw it. */
function throughShim(code: string, frame: number) {
  const { container, unmount } = render(
    <FrameContext.Provider value={frame}>
      <Probe code={code} scope={SHIM} />
    </FrameContext.Provider>,
  )
  const result = read(container)
  unmount()
  return result
}

beforeEach(() => {
  // React reports every error a boundary catches; some cases throw on purpose.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A component that writes its clock and its length, as Remotion reports them where it sits. */
const CLOCK = `const h = React.createElement
const R = Remotion
function Clock(props) {
  const frame = R.useCurrentFrame()
  const video = R.useVideoConfig()
  return h('span', null, props.label + ' ' + frame + '/' + video.durationInFrames)
}
`

/** A graphic whose body is `tree`, an expression over `h`, `R` and `Clock`. */
const graphic = (tree: string) => `${CLOCK}
function Graphic() {
  return ${tree}
}
`

const CASES: { name: string; frames: number[]; source: string }[] = [
  {
    name: 'a window from 30 for 20 frames, with its own clock and length',
    frames: [0, 29, 30, 49, 50, 89],
    source: graphic(
      "h(R.AbsoluteFill, null, h(R.Sequence, { from: 30, durationInFrames: 20 }, h(Clock, { label: 'in' })), h(Clock, { label: 'top' }))",
    ),
  },
  {
    name: 'a fractional window, whose last frame Remotion rounds up',
    frames: [10, 11, 15, 16, 17],
    source: graphic(
      "h(R.AbsoluteFill, null, h(R.Sequence, { from: 10.5, durationInFrames: 5.2 }, h(Clock, { label: 'in' })))",
    ),
  },
  {
    name: "a Sequence's layer: a row, with the Sequence's style on top",
    frames: [0],
    source: graphic(
      "h(R.AbsoluteFill, null, h(R.Sequence, { style: { justifyContent: 'center', gap: 12 } }, h('span', null, 'one'), h('span', null, 'two')))",
    ),
  },
  {
    name: 'layout="none", with no layer of its own',
    frames: [0, 5],
    source: graphic(
      "h(R.AbsoluteFill, { style: { gap: 8 } }, h(R.Sequence, { layout: 'none', from: 5 }, h('span', null, 'bare')))",
    ),
  },
  {
    name: "AbsoluteFill's own from and durationInFrames",
    frames: [19, 20, 29, 30],
    source: graphic(
      "h(R.AbsoluteFill, { from: 20, durationInFrames: 10, style: { justifyContent: 'center', opacity: 0.5 } }, h(Clock, { label: 'fill' }))",
    ),
  },
  {
    name: 'nested windows, the inner one cut by the outer',
    frames: [14, 15, 20, 49, 50],
    source: graphic(
      "h(R.Sequence, { from: 10, durationInFrames: 40 }, h(R.Sequence, { from: 5, durationInFrames: 100 }, h(Clock, { label: 'inner' })))",
    ),
  },
  {
    name: 'a window that runs to the end',
    frames: [60, 89],
    source: graphic("h(R.Sequence, { from: 60 }, h(Clock, { label: 'end' }))"),
  },
  ...(
    [
      ['a durationInFrames of 0', '{ durationInFrames: 0 }'],
      ['a negative durationInFrames', '{ durationInFrames: -3 }'],
      ['a durationInFrames that is not a number', "{ durationInFrames: '30' }"],
      ['a from that is not finite', '{ from: NaN }'],
      ['a from that is not a number', '{ from: null }'],
      ['a style under layout="none"', "{ layout: 'none', style: { opacity: 1 } }"],
      ['a layout Remotion does not know', "{ layout: 'row' }"],
      ['a durationInFrames of NaN, which Remotion lets through', '{ durationInFrames: NaN }'],
    ] as const
  ).map(([name, attributes]) => ({
    name,
    frames: [0, 45],
    source: graphic(
      `h(R.AbsoluteFill, null, h(R.Sequence, ${attributes}, h('span', null, 'inside')))`,
    ),
  })),
  ...(
    [
      ['an AbsoluteFill with a durationInFrames of 0', '{ durationInFrames: 0 }'],
      ['an AbsoluteFill with a from that is not finite', '{ from: Infinity }'],
    ] as const
  ).map(([name, attributes]) => ({
    name,
    frames: [0],
    source: graphic(`h(R.AbsoluteFill, ${attributes}, h('span', null, 'inside'))`),
  })),
]

describe('the one-frame shim against Remotion 4.0.512 (final review I3)', () => {
  it.each(CASES)('$name', ({ source, frames }) => {
    for (const frame of frames) {
      const remotion = throughRemotion(source, frame)
      const shim = throughShim(source, frame)
      expect({ frame, ...shim }).toEqual({ frame, ...remotion })
    }
  })

  it('refuses what Remotion refuses, with its message', () => {
    const source = graphic("h(R.Sequence, { durationInFrames: 0 }, h('span', null, 'x'))")
    expect(throughRemotion(source, 0).text).toBe('durationInFrames must be positive, but got 0')
    expect(throughShim(source, 0).text).toBe('durationInFrames must be positive, but got 0')
  })

  it('lays a Sequence out as a row inside an AbsoluteFill laid out as a column, as Remotion does', () => {
    const source = graphic("h(R.AbsoluteFill, null, h(R.Sequence, null, h('span', null, 'a')))")
    const [fill] = throughRemotion(source, 0).tree
    expect(fill?.layout).toMatchObject({ fills: true, display: 'flex', flexDirection: 'column' })
    expect(fill?.children[0]?.layout).toMatchObject({
      fills: true,
      display: 'flex',
      flexDirection: '',
    })
    expect(throughShim(source, 0).tree).toEqual(throughRemotion(source, 0).tree)
  })
})
