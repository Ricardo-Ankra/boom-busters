import { frozenEasing, withAlpha } from '@boom-busters/compositions/graphic-code-pure'
import type { GraphicScope } from '@boom-busters/compositions/graphic-code-pure'
import type * as ReactModule from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Easing, interpolate, spring } from 'remotion'

/**
 * The one-frame shim of Remotion's side of the sandbox (decision 295), shared
 * by the dry run (`dry-run.ts`) and the board's still (`graphic-code-still.tsx`):
 * both hold a design at a single frame without a Player, so both must give the
 * code the same `Sequence`, `AbsoluteFill`, `Img` and video config, or the
 * still stops being a picture of what the dry run checked. Client-safe: no
 * `vm`, no `react-dom/server`.
 *
 * It is a factory over the React it is given, with nothing React-shaped at
 * module level: the Inngest route is bundled with the `react-server`
 * condition, whose React has no `createContext`, so the dry run hands it the
 * plain Node builds it loads at run time, and the still hands it the browser's.
 * Remotion's own functions come the same way, for the same reason: this file
 * imports `remotion` for its types only.
 *
 * `Sequence` and `AbsoluteFill` copy Remotion 4.0.512's semantics for the
 * props a graphic uses (`Sequence.js`, `AbsoluteFill.js` and
 * `AbsoluteFillElement.js`): the same TypeErrors, the same window, the same
 * clock, the same layer and the same `useVideoConfig().durationInFrames`
 * inside a Sequence. A design whose Sequence Remotion refuses shows only its
 * title in the Player and the film, so the dry run must refuse it too.
 * `one-frame.test.tsx` renders each case through Remotion's own components and
 * through these, so a Remotion upgrade that changes them fails a test.
 */

/** The props a graphic hands `Remotion.Sequence`; Remotion's others (premounting, trims, crops) are not shimmed. */
interface SequenceProps {
  from?: number
  durationInFrames?: number
  layout?: 'absolute-fill' | 'none'
  style?: CSSProperties
  className?: string
  hidden?: boolean
  name?: string
  children?: ReactNode
}

/** `Remotion.AbsoluteFill`'s props: a Sequence's timing, and the rest for its `div`. */
type AbsoluteFillProps = Omit<SequenceProps, 'layout'> & {
  showInTimeline?: boolean
} & Record<string, unknown>

/** The enclosing Sequence: where it starts on the composition's clock, and its length as `useVideoConfig` reports it inside. */
interface SequenceFrame {
  start: number
  durationInFrames: number
}

/** Remotion's checks on a Sequence's props, in its order and with its messages. */
function validateSequence(
  layout: unknown,
  style: unknown,
  durationInFrames: unknown,
  from: unknown,
): void {
  if (layout !== 'absolute-fill' && layout !== 'none') {
    throw new TypeError(
      `The layout prop of <Sequence /> expects either "absolute-fill" or "none", but you passed: ${String(layout)}`,
    )
  }
  if (layout === 'none' && typeof style !== 'undefined') {
    throw new TypeError(
      'If layout="none", you may not pass a style. Passed: ' + JSON.stringify(style),
    )
  }
  if (typeof durationInFrames !== 'number') {
    throw new TypeError(
      `You passed to durationInFrames an argument of type ${typeof durationInFrames}, but it must be a number.`,
    )
  }
  if (durationInFrames <= 0) {
    throw new TypeError(`durationInFrames must be positive, but got ${durationInFrames}`)
  }
  if (typeof from !== 'number') {
    throw new TypeError(
      `You passed to the "from" props of your <Sequence> an argument of type ${typeof from}, but it must be a number.`,
    )
  }
  if (!Number.isFinite(from)) {
    throw new TypeError(`The "from" prop of a sequence must be finite, but got ${from}.`)
  }
}

export function makeOneFrame(
  React: typeof ReactModule,
  remotion: { interpolate: typeof interpolate; spring: typeof spring; Easing: typeof Easing },
) {
  /** The frame the still or the dry run holds, on the composition's clock from 0. */
  const FrameContext = React.createContext(0)
  /** The Sequence a component sits in; none at the top level. */
  const SequenceContext = React.createContext<SequenceFrame | null>(null)
  /** A frozen copy, as `remotionScope` hands the code, so no graphic can reassign a member. */
  const easing = frozenEasing(remotion.Easing)

  /**
   * Remotion's full-frame layer (`AbsoluteFillElement`), spanned with
   * `inset: 0` rather than four zero offsets: the safe-area check reads
   * offsets, and a full-frame layer is the one element allowed to reach the
   * frame's edges.
   */
  function Layer({
    style,
    children,
    ...rest
  }: {
    style?: CSSProperties
    children?: ReactNode
  } & Record<string, unknown>) {
    return React.createElement(
      'div',
      {
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          ...style,
        },
        ...rest,
      },
      children,
    )
  }

  /** The sandbox's `Remotion` argument for one frame size: the hooks shimmed, the rest Remotion's own. */
  function oneFrameScope(
    size: { width: number; height: number },
    durationInFrames: number,
    fps: number,
  ): GraphicScope {
    const config = { width: size.width, height: size.height, fps, durationInFrames }

    /** The held frame, counted from the start of the Sequence the caller sits in. */
    function useCurrentFrame(): number {
      const frame = React.useContext(FrameContext)
      const sequence = React.useContext(SequenceContext)
      return frame - (sequence?.start ?? 0)
    }

    /** The frame size and rate; inside a Sequence, its length is what is left of that Sequence. */
    function useVideoConfig(): typeof config {
      const sequence = React.useContext(SequenceContext)
      return sequence === null ? config : { ...config, durationInFrames: sequence.durationInFrames }
    }

    /**
     * Remotion's `Sequence`: its children only from `from` to its last frame,
     * on a clock from its start, in a full-frame layer whose flex direction is
     * unset (so a row) with the Sequence's `style` on top, or bare under
     * `layout="none"`.
     */
    function Sequence({
      from = 0,
      durationInFrames = Infinity,
      layout = 'absolute-fill',
      style,
      className,
      hidden = false,
      children,
    }: SequenceProps) {
      validateSequence(layout, style, durationInFrames, from)
      const frame = React.useContext(FrameContext)
      const parent = React.useContext(SequenceContext)
      const cumulatedFrom = parent?.start ?? 0
      const enclosing = parent?.durationInFrames ?? config.durationInFrames
      const inside: SequenceFrame = {
        start: cumulatedFrom + from,
        durationInFrames: Math.max(0, Math.min(enclosing - from, durationInFrames)),
      }
      // Remotion rounds the last frame up, so a fractional length still shows.
      const lastFrame = Math.ceil(cumulatedFrom + from + durationInFrames - 1)
      const content = frame < cumulatedFrom + from || frame > lastFrame ? null : children
      if (hidden) return null
      return React.createElement(
        SequenceContext.Provider,
        { value: inside },
        content === null
          ? null
          : layout === 'none'
            ? content
            : React.createElement(
                Layer,
                { style: { flexDirection: undefined, ...style }, className },
                content,
              ),
      )
    }

    /** Remotion's `AbsoluteFill`: a full-frame layer that is also a Sequence (`layout="none"`). */
    function AbsoluteFill({
      from,
      durationInFrames,
      hidden,
      name: _name,
      showInTimeline: _showInTimeline,
      children,
      ...layerProps
    }: AbsoluteFillProps) {
      return React.createElement(
        Sequence,
        {
          layout: 'none',
          from: from ?? 0,
          durationInFrames: durationInFrames ?? Infinity,
          ...(hidden !== undefined ? { hidden } : {}),
        },
        React.createElement(Layer, layerProps, children),
      )
    }

    // Frozen, as `remotionScope` is, so under the body's strict mode an
    // assignment to a member throws.
    return Object.freeze({
      useCurrentFrame,
      useVideoConfig,
      interpolate: remotion.interpolate,
      spring: remotion.spring,
      Easing: easing,
      Sequence,
      AbsoluteFill,
      Img,
      withAlpha,
    })
  }

  function Img({ src, style }: { src: string; style?: CSSProperties }) {
    return React.createElement('img', { src, style })
  }

  return { FrameContext, oneFrameScope }
}
