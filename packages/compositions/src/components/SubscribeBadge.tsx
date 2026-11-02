import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * The badge's box on a 1080 x 1920 frame (scale 1): centred horizontally,
 * bottom edge at y 1300, above the related-arrow label (y 1390 to 1500) and inside the Short safe area (bottom 1540).
 */
export const SUBSCRIBE_BADGE_LAYOUT = {
  width: 720,
  height: 150,
  bottom: 1300,
  frameWidth: 1080,
} as const

/**
 * The bridge's subscribe prompt (playbook Shorts, spec 4.6): channel name
 * over its handle on a brand panel with an accent rule. Slides up and fades
 * in over 200 ms. Only the Short compiler emits the `subscribeBadge` overlay.
 */
export function SubscribeBadge({
  channelName,
  handle,
  brand,
}: {
  channelName: string
  handle: string
  brand: BrandKitTokens
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const { colors, typography } = brand
  const { width: boxWidth, height: boxHeight, bottom } = SUBSCRIBE_BADGE_LAYOUT

  const tMs = (frame / fps) * 1000
  const enter = easeInOut(Math.min(1, tMs / 200))

  return (
    <AbsoluteFill style={{ opacity: enter, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: (width - boxWidth * scale) / 2,
          top: (bottom - boxHeight) * scale,
          width: boxWidth * scale,
          height: boxHeight * scale,
          transform: `translateY(${40 * scale * (1 - enter)}px)`,
          backgroundColor: withAlpha(colors.background, 0.88),
          borderBottom: `${6 * scale}px solid ${colors.accent}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6 * scale,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            ...typeStyle(typography.heading, 52, scale),
            color: colors.textPrimary,
            whiteSpace: 'nowrap',
          }}
        >
          {channelName}
        </div>
        <div
          style={{
            ...typeStyle(typography.captions, 34, scale),
            color: colors.accent,
            whiteSpace: 'nowrap',
          }}
        >
          {handle}
        </div>
      </div>
    </AbsoluteFill>
  )
}
