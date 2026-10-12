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
 */
export function makeOneFrame(
  React: typeof ReactModule,
  remotion: { interpolate: typeof interpolate; spring: typeof spring; Easing: typeof Easing },
) {
  /** The frame `useCurrentFrame` reads: the held frame, or a `Sequence`'s, counted from its start. */
  const FrameContext = React.createContext(0)
  /** A frozen copy, as `remotionScope` hands the code, so no graphic can reassign a member. */
  const easing = frozenEasing(remotion.Easing)

  /**
   * A full-frame layer, as Remotion's is, spanned with `inset: 0` rather than
   * four zero offsets: the safe-area check reads offsets, and a full-frame
   * layer is the one element allowed to reach the frame's edges.
   */
  function AbsoluteFill({ style, children }: { style?: CSSProperties; children?: ReactNode }) {
    return React.createElement(
      'div',
      {
        style: {
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          ...style,
        },
      },
      children,
    )
  }

  /** Remotion's `Sequence`: its children only inside its window, on a clock from its start, in a full-frame layer. */
  function Sequence({
    from = 0,
    durationInFrames,
    children,
  }: {
    from?: number
    durationInFrames?: number
    children?: ReactNode
  }) {
    const frame = React.useContext(FrameContext)
    if (frame < from) return null
    if (durationInFrames !== undefined && frame >= from + durationInFrames) return null
    return React.createElement(
      FrameContext.Provider,
      { value: frame - from },
      React.createElement(AbsoluteFill, null, children),
    )
  }

  function Img({ src, style }: { src: string; style?: CSSProperties }) {
    return React.createElement('img', { src, style })
  }

  /**
   * The sandbox's `Remotion` argument for one frame size: the hooks shimmed,
   * the rest Remotion's own. Frozen, as `remotionScope` is, so under the
   * body's strict mode an assignment to a member throws.
   */
  function oneFrameScope(
    size: { width: number; height: number },
    durationInFrames: number,
    fps: number,
  ): GraphicScope {
    const config = { width: size.width, height: size.height, fps, durationInFrames }
    return Object.freeze({
      useCurrentFrame: () => React.useContext(FrameContext),
      useVideoConfig: () => config,
      interpolate: remotion.interpolate,
      spring: remotion.spring,
      Easing: easing,
      Sequence,
      AbsoluteFill,
      Img,
      withAlpha,
    })
  }

  return { FrameContext, AbsoluteFill, Sequence, Img, oneFrameScope }
}
