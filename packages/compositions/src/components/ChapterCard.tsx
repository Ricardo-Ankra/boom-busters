import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * The chapter card (spec section 8.3, decision 454), in the Brand Kit's
 * variant: `full` (a title card over the whole frame), `corner` (a chip that
 * leaves the footage visible) or `minimal` (centred type over a dim wash). The
 * compiler overlays it across inserted silence at each chapter start (decision
 * 215), with slow fades; the fade-out must stay shorter than the compiler's
 * CHAPTER_OVERLAP_MS so the slot swap underneath happens while the card is
 * still opaque.
 *
 * The card draws its title only, never a number. `index` stays in the props
 * because the preview matches a card to its chapter by it.
 *
 * `TitledCard` is the one presentational function both this card and
 * `TitleCard` (the film's title, in `title` chapter marking) render through.
 */
const FADE_MS = 700

export function TitledCard({
  title,
  brand,
  durationInFrames,
}: {
  title: string
  brand: BrandKitTokens
  durationInFrames: number
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const { colors, typography, look } = brand

  const tMs = (frame / fps) * 1000
  const totalMs = (durationInFrames / fps) * 1000
  const enter = easeInOut(Math.min(1, tMs / FADE_MS))
  const exit = easeInOut(Math.min(1, Math.max(0, (totalMs - tMs) / FADE_MS)))
  const opacity = Math.min(enter, exit)

  const titleStyle = { ...typeStyle(typography.heading, 68, scale), color: colors.textPrimary }

  if (look.chapterCardVariant === 'corner') {
    return (
      <div
        style={{
          position: 'absolute',
          left: width * 0.06,
          top: height * 0.08,
          display: 'flex',
          alignItems: 'baseline',
          backgroundColor: withAlpha(colors.primary, 0.88),
          padding: `${14 * scale}px ${24 * scale}px`,
          borderRadius: 8 * scale,
          opacity,
        }}
      >
        <span style={{ ...typeStyle(typography.heading, 34, scale), color: colors.textPrimary }}>
          {title}
        </span>
      </div>
    )
  }

  if (look.chapterCardVariant === 'minimal') {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: withAlpha(colors.background, 0.7),
          alignItems: 'center',
          justifyContent: 'center',
          opacity,
        }}
      >
        <div style={{ ...titleStyle, maxWidth: width * 0.8, textAlign: 'center' }}>{title}</div>
      </AbsoluteFill>
    )
  }

  // The default: `full`.
  const settle = 1 + 0.02 * (1 - enter)
  return (
    <AbsoluteFill
      style={{
        backgroundColor: withAlpha(colors.primary, 0.95),
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
      }}
    >
      <div
        style={{
          transform: `scale(${settle})`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8 * scale,
        }}
      >
        <div
          style={{
            width: 72 * scale,
            height: 4 * scale,
            backgroundColor: colors.accent,
            marginBottom: 12 * scale,
          }}
        />
        <div style={{ ...titleStyle, maxWidth: width * 0.8, textAlign: 'center' }}>{title}</div>
      </div>
    </AbsoluteFill>
  )
}

export function ChapterCard({
  title,
  brand,
  durationInFrames,
}: {
  index: number
  title: string
  brand: BrandKitTokens
  durationInFrames: number
}) {
  return <TitledCard title={title} brand={brand} durationInFrames={durationInFrames} />
}
