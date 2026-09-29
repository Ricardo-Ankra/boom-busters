import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion'
import type { ComponentType, ImgHTMLAttributes } from 'react'
import type { BrandKitTokens, SocialPayload } from '@boom-busters/schemas'
import { socialProgress } from '../lib/social'
import { SocialPostCard } from './SocialPostCard'

/**
 * `Img`'s own props are a stricter, Remotion-specific superset of
 * `ImgHTMLAttributes` (a required `src`, premount and retry props), so it is
 * not structurally a `ComponentType<ImgHTMLAttributes<...>>` by TypeScript's
 * rules even though every prop `SocialPostCard` actually passes it (`src`,
 * `style`) is one `Img` accepts. The cast is the render opting into the
 * waits-for-the-picture behaviour `Img` gives; the board keeps the plain,
 * unrelated `'img'` default.
 */
const RemotionImg = Img as unknown as ComponentType<ImgHTMLAttributes<HTMLImageElement>>

/**
 * The Remotion wrapper around `SocialPostCard` (decision 284): reads the
 * frame and drives `socialProgress`, then hands the pure card exactly the
 * same props the board's resting preview computes for itself.
 */
export function SocialPost({
  payload,
  brand,
  durationInFrames,
}: {
  payload: SocialPayload
  brand: BrandKitTokens
  /**
   * The slot's own length, so the drift can span it: the same optional
   * convention `GraphicCard` uses; a caller with no slot around it still
   * renders, just without a drift.
   */
  durationInFrames?: number
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const progress = socialProgress(frame, fps, durationInFrames ?? 1)

  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <SocialPostCard
        payload={payload}
        brand={brand}
        frame={{ width, height }}
        progress={progress}
        ImageComponent={RemotionImg}
      />
    </AbsoluteFill>
  )
}
