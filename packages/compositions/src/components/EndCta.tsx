import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * A Short's CTA ending card (spec section 5: `ending: cta`): rises over the
 * final moments and points the viewer at the full video. It enters like the
 * chapter card but never exits — the Short ends underneath it, which is the
 * whole idea. Only the Short compiler emits the `endCta` overlay that mounts
 * this; masters never carry it.
 */
export function EndCta({ text, brand }: { text: string; brand: BrandKitTokens }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const { colors, typography } = brand

  const tMs = (frame / fps) * 1000
  const enter = easeInOut(Math.min(1, tMs / 400))
  const settle = 1 + 0.02 * (1 - enter)

  return (
    <AbsoluteFill
      style={{
        backgroundColor: withAlpha(colors.background, 0.82),
        alignItems: 'center',
        justifyContent: 'center',
        opacity: enter,
      }}
    >
      <div
        style={{
          transform: `scale(${settle})`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14 * scale,
          maxWidth: width * 0.82,
        }}
      >
        <div style={{ width: 72 * scale, height: 4 * scale, backgroundColor: colors.accent }} />
        <div
          style={{
            ...typeStyle(typography.heading, 58, scale),
            color: colors.textPrimary,
            textAlign: 'center',
          }}
        >
          {text}
        </div>
        <div
          style={{
            ...typeStyle(typography.captions, 26, scale),
            color: withAlpha(colors.textPrimary, 0.6),
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginTop: 8 * scale,
          }}
        >
          Boom &amp; Busters
        </div>
      </div>
    </AbsoluteFill>
  )
}
