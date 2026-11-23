import type { CSSProperties } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { fixedTypeStyle, frameScale, withAlpha } from './brand'
import { ChannelLogo } from './EndCard'

/**
 * A point Short's closing card (decision 479): after the narration, on the
 * bed alone, the channel asks for the follow for its long-form videos. It
 * points at YouTube's own Subscribe button below rather than drawing one: a
 * drawn button that does nothing would mislead. Opaque and full frame; every
 * line sits inside the Short safe area on a 1080 x 1920 frame.
 */
export const FOLLOW_CARD_LAYOUT = {
  /** The stack of mark, name, headline and line, from its top, one gap apart. */
  stack: { y: 500, width: 880 },
  logo: { size: 280 },
  /** The prompt to YouTube's Subscribe button, fixed above the safe area's foot. */
  prompt: { y: 1370 },
} as const

function rise(tMs: number, at: number, scale: number): CSSProperties {
  const p = easeInOut(Math.min(1, Math.max(0, (tMs - at) / 280)))
  return { opacity: p, transform: `translateY(${28 * scale * (1 - p)}px)` }
}

export function FollowCard({
  channelName,
  headline,
  line,
  brand,
}: {
  channelName: string
  headline: string
  line: string
  brand: BrandKitTokens
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const tMs = (frame / fps) * 1000
  const { colors, typography } = brand
  const L = FOLLOW_CARD_LAYOUT
  const ground = easeInOut(Math.min(1, tMs / 200))
  const logoIn = easeInOut(Math.min(1, Math.max(0, (tMs - 60) / 320)))
  // "Follow" leads the line in the accent, as on the end card.
  const [lead, ...rest] = line.split(' ')
  const centred: CSSProperties = {
    position: 'absolute',
    left: 0,
    width,
    display: 'flex',
    justifyContent: 'center',
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

      <div
        style={{
          ...centred,
          top: L.stack.y * scale,
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            opacity: logoIn,
            transform: `scale(${0.92 + 0.08 * logoIn})`,
            marginBottom: 44 * scale,
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
            ...fixedTypeStyle(typography.captions, 30, scale),
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: withAlpha(colors.textPrimary, 0.82),
            whiteSpace: 'nowrap',
            marginBottom: 18 * scale,
            ...rise(tMs, 160, scale),
          }}
        >
          {channelName}
        </div>

        <div
          style={{
            width: L.stack.width * scale,
            ...fixedTypeStyle(typography.heading, 96, scale),
            lineHeight: 1.04,
            letterSpacing: '-0.015em',
            textAlign: 'center',
            textWrap: 'balance',
            color: colors.textPrimary,
            marginBottom: 30 * scale,
            ...rise(tMs, 260, scale),
          }}
        >
          {headline}
        </div>

        <div
          style={{
            width: (L.stack.width - 60) * scale,
            ...fixedTypeStyle(typography.body, 40, scale),
            fontWeight: 600,
            lineHeight: 1.3,
            textAlign: 'center',
            textWrap: 'balance',
            color: withAlpha(colors.textPrimary, 0.85),
            ...rise(tMs, 380, scale),
          }}
        >
          <span style={{ color: colors.accent }}>{lead}</span>
          {rest.length > 0 ? ` ${rest.join(' ')}` : ''}
        </div>
      </div>

      <div
        style={{
          ...centred,
          top: L.prompt.y * scale,
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14 * scale,
          ...rise(tMs, 520, scale),
        }}
      >
        <div
          style={{
            ...fixedTypeStyle(typography.heading, 36, scale),
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
  return (
    <FollowCard
      channelName="Boom & Busters"
      headline="Every case, in full."
      line="Follow for the long-form investigations"
      brand={brand}
    />
  )
}
