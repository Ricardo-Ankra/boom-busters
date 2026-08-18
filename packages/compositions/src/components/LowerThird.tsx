import { useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * The lower third (spec section 8.3), in the Brand Kit's chosen variant:
 * `bar` (accent rule + panel), `stack` (chip per line) or `minimal` (type
 * only). Slides and fades in over 300 ms, fades out over the last 300 ms.
 */
export function LowerThird({
  title,
  subtitle,
  brand,
  durationInFrames,
}: {
  title: string
  subtitle?: string
  brand: BrandKitTokens
  durationInFrames: number
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const { colors, typography, look } = brand

  const tMs = (frame / fps) * 1000
  const totalMs = (durationInFrames / fps) * 1000
  const enter = easeInOut(Math.min(1, tMs / 300))
  const exit = easeInOut(Math.min(1, Math.max(0, (totalMs - tMs) / 300)))
  const opacity = Math.min(enter, exit)
  const slide = (1 - enter) * -24 * scale

  const titleStyle = { ...typeStyle(typography.heading, 38, scale), color: colors.textPrimary }
  const subtitleStyle = {
    ...typeStyle(typography.captions, 22, scale),
    color: colors.textSecondary,
  }

  const container: React.CSSProperties = {
    position: 'absolute',
    left: width * 0.075,
    bottom: height * 0.12,
    maxWidth: width * 0.6,
    opacity,
    transform: `translateX(${slide}px)`,
  }

  if (look.lowerThirdVariant === 'stack') {
    return (
      <div
        style={{
          ...container,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 6 * scale,
        }}
      >
        <div
          style={{
            ...titleStyle,
            color: colors.primary,
            backgroundColor: colors.accent,
            padding: `${8 * scale}px ${18 * scale}px`,
            borderRadius: 4 * scale,
          }}
        >
          {title}
        </div>
        {subtitle !== undefined ? (
          <div
            style={{
              ...subtitleStyle,
              backgroundColor: withAlpha(colors.surface, 0.92),
              padding: `${6 * scale}px ${14 * scale}px`,
              borderRadius: 4 * scale,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    )
  }

  if (look.lowerThirdVariant === 'minimal') {
    return (
      <div style={container}>
        <div style={{ ...titleStyle, textShadow: '0 2px 12px rgba(0,0,0,0.7)' }}>{title}</div>
        {subtitle !== undefined ? (
          <div style={{ ...subtitleStyle, textShadow: '0 2px 10px rgba(0,0,0,0.7)' }}>
            {subtitle}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 8 * scale,
            width: 56 * scale,
            height: 3 * scale,
            backgroundColor: colors.accent,
          }}
        />
      </div>
    )
  }

  // The default: `bar`.
  return (
    <div
      style={{
        ...container,
        display: 'flex',
        alignItems: 'stretch',
        gap: 16 * scale,
        backgroundColor: withAlpha(colors.primary, 0.85),
        padding: `${16 * scale}px ${24 * scale}px`,
        borderRadius: 8 * scale,
      }}
    >
      <div style={{ width: 6 * scale, borderRadius: 3 * scale, backgroundColor: colors.accent }} />
      <div>
        <div style={titleStyle}>{title}</div>
        {subtitle !== undefined ? <div style={subtitleStyle}>{subtitle}</div> : null}
      </div>
    </div>
  )
}
