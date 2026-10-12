import { Component, type ReactNode } from 'react'
import { AbsoluteFill, useVideoConfig } from 'remotion'
import { GRAPHIC_CODE_VERSION } from '@boom-busters/schemas'
import type { BrandKitTokens, GraphicCodePayload } from '@boom-busters/schemas'
import { loadBrandFonts } from '../fonts/load'
import { safeArea } from '../lib/graphic'
import {
  buildGraphic,
  graphicPropsFor,
  remotionScope,
  type GraphicProps,
} from '../lib/graphic-code'
import { frameScale, typeStyle } from './brand'
import { GraphicBackdrop } from './GraphicBackdrop'

/**
 * The designer's graphic (decision 295): the component the designer wrote,
 * built once from `payload.compiled` and played inside the house frame, the
 * background and radial lift `GraphicCard` draws, in the brand's loaded faces.
 *
 * The code was checked before it was stored (a scan, a compile, a dry run in
 * both frames, the facts), but a render must not depend on the checks having caught
 * everything: an error boundary turns a throw into the slot's title on the
 * brand background, so one graphic can never fail a master render. A payload
 * whose sandbox version this renderer does not know gets the same card, and
 * its code is never run.
 */
export function GraphicCode({
  payload,
  brand,
}: {
  payload: GraphicCodePayload
  brand: BrandKitTokens
  /**
   * The slot's own length, which the master hands every card. Not read: the
   * code reads its frame count from `useVideoConfig`, and `props.durationMs`
   * is always `payload.durationMs`, the length the dry run checked (ruling
   * 7), so a slot the compiler stretched holds the code's ending.
   */
  durationInFrames?: number
}) {
  const { width, height } = useVideoConfig()
  // Idempotent; @remotion/google-fonts handles delayRender internally.
  loadBrandFonts(brand.typography)
  const { colors } = brand
  const titleCard = <GraphicTitleCard title={payload.title} brand={brand} />

  let content: ReactNode = titleCard
  if (payload.version !== GRAPHIC_CODE_VERSION) {
    reportUnknownVersion(payload.version, payload.title)
  } else {
    const props: GraphicProps = graphicPropsFor(payload, brand, { width, height })
    // Keyed on the code, so a redesign gets a boundary that has not failed.
    content = (
      <GraphicBoundary key={payload.compiled} title={payload.title} fallback={titleCard}>
        <SandboxedGraphic compiled={payload.compiled} props={props} />
      </GraphicBoundary>
    )
  }

  return (
    <GraphicBackdrop colors={colors}>
      <AbsoluteFill>{content}</AbsoluteFill>
    </GraphicBackdrop>
  )
}

/**
 * Builds inside the boundary, so code that does not even parse is caught like
 * code that throws. `buildGraphic` memoises on the code, so this is one build
 * per graphic, not one per frame.
 */
function SandboxedGraphic({ compiled, props }: { compiled: string; props: GraphicProps }) {
  const Graphic = buildGraphic(compiled, remotionScope())
  return <Graphic {...props} />
}

/**
 * Catches a throw anywhere in the designer's component and shows the title
 * card instead. It reports once: the boundary keeps its failed state across
 * frames, so a render logs the failure at the frame it happened and draws the
 * card from then on.
 */
class GraphicBoundary extends Component<
  { title: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    console.error(
      `graphic-code: "${this.props.title}" threw while rendering, so it shows its title card`,
      error,
    )
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Versions already reported, so a render logs an unknown one once, not every frame. */
const reportedVersions = new Set<number>()

function reportUnknownVersion(version: number, title: string): void {
  if (reportedVersions.has(version)) return
  reportedVersions.add(version)
  console.error(
    `graphic-code: "${title}" was written for sandbox version ${version}, and this renderer knows version ${GRAPHIC_CODE_VERSION}, so it shows its title card`,
  )
}

/** The slot's title in the heading type, centred in the safe area, on the frame's background. */
function GraphicTitleCard({ title, brand }: { title: string; brand: BrandKitTokens }) {
  const { width, height } = useVideoConfig()
  const area = safeArea({ width, height })
  return (
    <div
      style={{
        position: 'absolute',
        left: area.x,
        top: area.y,
        width: area.w,
        height: area.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          ...typeStyle(brand.typography.heading, 72, frameScale(width, height)),
          color: brand.colors.textPrimary,
          textAlign: 'center',
        }}
      >
        {title}
      </div>
    </div>
  )
}
