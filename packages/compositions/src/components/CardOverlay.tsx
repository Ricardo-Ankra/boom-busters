import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens, CardCode } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { FADE_MS, TitledCard } from './ChapterCard'
import { GraphicCode } from './GraphicCode'

/**
 * A chapter or title card overlay. Without `code` it is today's `TitledCard`.
 * With `code` it plays the exemplar the designer wrote for the card, through
 * the same sandbox as a graphic slot, and falls back to `TitledCard` (not the
 * graphic's plain title) if that code throws or its version is unknown.
 *
 * There is no entrance fade, since the exemplar has its own. The exit is the
 * card's usual `FADE_MS` curve, which must stay shorter than the compiler's
 * chapter overlap so the slot swap underneath happens while the card is opaque.
 */
export function CardOverlay({
  title,
  code,
  brand,
  durationInFrames,
}: {
  title: string
  code?: CardCode
  brand: BrandKitTokens
  durationInFrames: number
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const titled = <TitledCard title={title} brand={brand} durationInFrames={durationInFrames} />
  if (code === undefined) return titled

  const tMs = (frame / fps) * 1000
  const totalMs = (durationInFrames / fps) * 1000
  const opacity = easeInOut(Math.min(1, Math.max(0, (totalMs - tMs) / FADE_MS)))

  return (
    <AbsoluteFill style={{ opacity }}>
      <GraphicCode
        payload={{ kind: 'graphic-code', ...code, logos: {}, claimIds: [] }}
        brand={brand}
        durationInFrames={durationInFrames}
        fallback={titled}
      />
    </AbsoluteFill>
  )
}
