import type { BrandKitTokens, GraphicCodePayload } from '@boom-busters/schemas'
import type { ComponentType, CSSProperties, ReactElement, ReactNode } from 'react'
import type { Easing, interpolate, spring } from 'remotion'
import { withAlpha } from '../components/brand'
import { safeArea } from './graphic'

/**
 * The Remotion-free half of the sandbox contract (decision 295): the props and
 * scope types, the function body, the safe-area insets and the brand mapping.
 * Nothing here evaluates `remotion` or `react` (type imports only), so the web
 * server's Inngest route, bundled with the `react-server` condition, can
 * import it. `graphic-code.ts` re-exports all of it.
 */
export { withAlpha }

/** Everything the code is handed. Colours are hex strings; fonts are loaded family names. */
export interface GraphicProps {
  brand: {
    colors: BrandKitTokens['colors']
    fonts: { heading: string; title: string; body: string; numbers: string; captions: string }
  }
  words: readonly { text: string; atMs: number }[]
  durationMs: number
  safeArea: { top: number; right: number; bottom: number; left: number }
  logos: Readonly<Record<string, { src: string; width: number; height: number }>>
  data?: GraphicCodePayload['data']
}

/** The `Remotion` argument: these nine names and nothing else. `withAlpha` is ours. */
export interface GraphicScope {
  useCurrentFrame: () => number
  useVideoConfig: () => { width: number; height: number; fps: number; durationInFrames: number }
  interpolate: typeof interpolate
  spring: typeof spring
  Easing: typeof Easing
  Sequence: ComponentType<{ from?: number; durationInFrames?: number; children?: ReactNode }>
  AbsoluteFill: ComponentType<{ style?: CSSProperties; children?: ReactNode }>
  Img: ComponentType<{ src: string; style?: CSSProperties }>
  withAlpha: (hex: string, alpha: number) => string
}

export type GraphicComponent = (props: GraphicProps) => ReactElement | null

/** `${compiled}\nreturn Graphic` */
export function graphicFunctionBody(compiled: string): string {
  return `${compiled}\nreturn Graphic`
}

/**
 * The graphic card's safe area (`safeArea`) as `props.safeArea` carries it:
 * rounded insets from each edge of the frame (the margin, and the caption
 * band at the bottom). One helper for `GraphicCode`, the web server's dry run
 * and the board's still, so all three hand the code the same numbers.
 */
export function safeInsets(frame: { width: number; height: number }): GraphicProps['safeArea'] {
  const box = safeArea(frame)
  return {
    top: Math.round(box.y),
    right: Math.round(frame.width - box.x - box.w),
    bottom: Math.round(frame.height - box.y - box.h),
    left: Math.round(box.x),
  }
}

/**
 * A Brand Kit as `props.brand`: its colours, and each type role's family (the
 * faces `loadBrandFonts` loaded). One helper for `graphicPropsFor` and the web
 * server's dry run (ruling 26), so the code is handed the same names in both.
 */
export function graphicBrand(brand: BrandKitTokens): GraphicProps['brand'] {
  const { heading, title, body, numbers, captions } = brand.typography
  return {
    colors: brand.colors,
    fonts: {
      heading: heading.family,
      title: title.family,
      body: body.family,
      numbers: numbers.family,
      captions: captions.family,
    },
  }
}
