import type { CSSProperties } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { fixedTypeStyle, frameScale } from './brand'
import { ChannelLogo } from './EndCard'

/**
 * The closing card (decision 479, trimmed by 481): the channel's mark, its
 * name, and a prompt to YouTube's own Subscribe button below, rather than a
 * drawn button that would do nothing. Opaque and full frame. It is the long
 * form's closing graphic; a Short ends on its end card instead.
 *
 * Sizes are on a 1080 short side; heights are fractions of the frame, so the
 * card holds on a 9:16 Short frame and a 16:9 film frame alike. On 1080 x
 * 1920 every line sits inside the Short safe area.
 */
export const FOLLOW_CARD_LAYOUT = {
  /** The mark and the name, from the stack's top. */
  stack: { top: 0.3 },
  logo: { size: 280, gap: 44 },
  name: { px: 64 },
  /** The prompt to YouTube's Subscribe button, above the frame's foot. */
  prompt: { top: 0.71, px: 36 },
} as const

function rise(tMs: number, at: number, scale: number): CSSProperties {
  const p = easeInOut(Math.min(1, Math.max(0, (tMs - at) / 280)))
  return { opacity: p, transform: `translateY(${28 * scale * (1 - p)}px)` }
}

export function FollowCard({ channelName, brand }: { channelName: string; brand: BrandKitTokens }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const tMs = (frame / fps) * 1000
  const { colors, typography } = brand
  const L = FOLLOW_CARD_LAYOUT
  const ground = easeInOut(Math.min(1, tMs / 200))
  const logoIn = easeInOut(Math.min(1, Math.max(0, (tMs - 60) / 320)))
  const centred: CSSProperties = {
    position: 'absolute',
    left: 0,
    width,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  }

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, opacity: ground }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height: 12 * scale,
          backgroundColor: colors.accent,
        }}
      />

      <div style={{ ...centred, top: L.stack.top * height }}>
        <div
          style={{
            opacity: logoIn,
            transform: `scale(${0.92 + 0.08 * logoIn})`,
            marginBottom: L.logo.gap * scale,
          }}
        >
          <ChannelLogo
            brand={brand}
            name={channelName}
            size={L.logo.size * scale}
            ring={8 * scale}
          />
        </div>

        <div
          style={{
            ...fixedTypeStyle(typography.heading, L.name.px, scale),
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            color: colors.textPrimary,
            whiteSpace: 'nowrap',
            ...rise(tMs, 200, scale),
          }}
        >
          {channelName}
        </div>
      </div>

      <div
        style={{
          ...centred,
          top: L.prompt.top * height,
          gap: 14 * scale,
          ...rise(tMs, 420, scale),
        }}
      >
        <div
          style={{
            ...fixedTypeStyle(typography.heading, L.prompt.px, scale),
            color: colors.textPrimary,
            whiteSpace: 'nowrap',
          }}
        >
          Tap Subscribe below
        </div>
        <svg
          width={56 * scale}
          height={56 * scale}
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.accent}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </AbsoluteFill>
  )
}

/** Studio and snapshot fixture. */
export function FollowCardFixture({ brand }: { brand: BrandKitTokens }) {
  return <FollowCard channelName="Boom & Busters" brand={brand} />
}
