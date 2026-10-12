'use client'

import {
  buildGraphic,
  graphicPropsFor,
  loadBrandFonts,
  msToFrames,
  withAlpha,
  type GraphicProps,
  type GraphicScope,
} from '@boom-busters/compositions'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitStored, GraphicCode, GraphicCodePayload } from '@boom-busters/schemas'
import { MASTER_FPS } from '@boom-busters/timeline'
import * as React from 'react'
import { Easing, interpolate, spring } from 'remotion'
import { codePayloadFor, type CodeLogos } from './graphic-playback'

/**
 * The board's still of a graphic or chart the designer wrote as code
 * (decision 295), in place of the SVG preview a scene gets: the designer's own
 * component, built by the sandbox the render uses (`buildGraphic`), drawn at
 * one moment, 60% of the way through, where the build is usually done and the
 * ending not yet begun.
 *
 * There is no Player here, so the Remotion half of the sandbox is a scope of
 * our own that holds that one frame: `useCurrentFrame` reads it, a `Sequence`
 * shows its children only inside its window and counts their frames from its
 * start, as Remotion's does, and `interpolate`, `spring` and `Easing` are
 * Remotion's own pure functions. The frame is laid out at its full 1920 by
 * 1080 (or 1080 by 1920) and scaled to a quarter, so every size the code chose
 * is the size the render draws at.
 *
 * Code that throws, or does not build, shows the title on the brand's
 * background, as the composition's own boundary does, so one bad design never
 * takes the board down. The board loads this module in the browser only
 * (`GraphicCodePreview` in `slot-previews.tsx`).
 */

const LANDSCAPE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }
/** A quarter of the frame: 480 by 270 on the card. */
const STILL_SCALE = 0.25
/** How far through the graphic the still is taken. */
export const STILL_AT = 0.6

/** The frame the code sees, shifted inside a Sequence as Remotion shifts it. */
const StillFrame = React.createContext(0)

function useStillFrame(): number {
  return React.useContext(StillFrame)
}

/** Remotion's AbsoluteFill: the whole frame, its children in a flex column. */
function StillFill({
  style,
  children,
}: {
  style?: React.CSSProperties
  children?: React.ReactNode
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Remotion's Sequence at one frame: nothing outside its window, and inside it
 * the children count from its start, laid out in a fill of their own.
 */
function StillSequence({
  from = 0,
  durationInFrames = Infinity,
  children,
}: {
  from?: number
  durationInFrames?: number
  children?: React.ReactNode
}) {
  const frame = useStillFrame()
  if (frame < from || frame >= from + durationInFrames) return null
  return (
    <StillFrame.Provider value={frame - from}>
      <StillFill>{children}</StillFill>
    </StillFrame.Provider>
  )
}

/** A plain `img`: the board has no frames to hold for a picture. */
function StillImg({ src, style }: { src: string; style?: React.CSSProperties }) {
  return <img src={src} alt="" style={style} />
}

/** The sandbox's Remotion argument for a still of one frame size. */
export function stillScope(
  size: { width: number; height: number },
  durationInFrames: number,
): GraphicScope {
  return {
    useCurrentFrame: useStillFrame,
    useVideoConfig: () => ({
      width: size.width,
      height: size.height,
      fps: MASTER_FPS,
      durationInFrames,
    }),
    interpolate,
    spring,
    Easing,
    Sequence: StillSequence,
    AbsoluteFill: StillFill,
    Img: StillImg,
    withAlpha,
  }
}

/** Code that throws, or does not build, shows the fallback instead. */
class StillBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** The designer's component, built once per compiled source and scope. */
function StillGraphic({
  compiled,
  scope,
  props,
}: {
  compiled: string
  scope: GraphicScope
  props: GraphicProps
}) {
  const Graphic = React.useMemo(() => buildGraphic(compiled, scope), [compiled, scope])
  return <Graphic {...props} />
}

export function GraphicCodeStill({
  code,
  brand,
  logos,
  data,
  portrait = false,
}: {
  code: GraphicCode
  brand: BrandKitStored
  /** The library's marks, by title (`codeLogosFor`). */
  logos: CodeLogos
  /** A chart's series, handed to its code as `props.data`. */
  data?: GraphicCodePayload['data']
  portrait?: boolean
}) {
  const tokens = React.useMemo(
    () => resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand }),
    [brand],
  )
  React.useEffect(() => {
    // The same guarded call the post card makes: a family the catalogue does
    // not bundle throws, and the still draws in the fallback face.
    try {
      void loadBrandFonts(tokens.typography).catch(() => undefined)
    } catch {
      // The Brand Kit screen is where a bad family is fixed.
    }
  }, [tokens])

  const size = portrait ? PORTRAIT : LANDSCAPE
  const durationInFrames = Math.max(1, msToFrames(code.durationMs, MASTER_FPS))
  const frame = Math.min(durationInFrames - 1, msToFrames(code.durationMs * STILL_AT, MASTER_FPS))
  const scope = React.useMemo(() => stillScope(size, durationInFrames), [size, durationInFrames])
  const props = graphicPropsFor(codePayloadFor(code, logos, data), tokens, size)
  const fallback = (
    <div
      className="flex h-full w-full items-center justify-center p-4 text-center text-[15px]"
      style={{ background: tokens.colors.background, color: tokens.colors.textPrimary }}
    >
      {code.title}
    </div>
  )

  return (
    <div
      role="img"
      aria-label={`Graphic still: ${code.title}`}
      className="relative max-w-full overflow-hidden rounded-[8px] border border-[var(--color-border)]"
      style={{ width: size.width * STILL_SCALE, height: size.height * STILL_SCALE }}
    >
      {/* Keyed on the code, so a redesign that lands gets a fresh boundary. */}
      <StillBoundary key={code.compiled} fallback={fallback}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size.width,
            height: size.height,
            transform: `scale(${STILL_SCALE})`,
            transformOrigin: '0 0',
            overflow: 'hidden',
            background: tokens.colors.background,
            color: tokens.colors.textPrimary,
            fontFamily: `"${tokens.typography.body.family}", sans-serif`,
          }}
        >
          <StillFrame.Provider value={frame}>
            <StillGraphic compiled={code.compiled} scope={scope} props={props} />
          </StillFrame.Provider>
        </div>
      </StillBoundary>
    </div>
  )
}
