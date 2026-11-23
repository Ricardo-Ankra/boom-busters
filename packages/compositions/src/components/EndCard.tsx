import { useState } from 'react'
import type { CSSProperties } from 'react'
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut, msToFrames } from '../lib/motion'
import { fixedTypeStyle, frameScale, withAlpha } from './brand'
import { RelatedArrow } from './RelatedArrow'

/**
 * A point Short's end card (decision 479): the bridge as a full-frame graphic
 * instead of a box over the picture. The Short shrinks into a 16:9 "full
 * video" frame (the composition moves the slot layer, see
 * `endCardSlotStyle`; this component draws only what sits around and on the
 * frame), under the channel block and its follow ask, the film's title, the
 * chapters the bridge promises, and the call to action with the arrow to the
 * related-video link YouTube draws below.
 *
 * Every box is on a 1080 x 1920 frame (scale 1) inside the Short safe area;
 * the arrow is the related arrow's own, tip and all.
 */
export const END_CARD_LAYOUT = {
  channel: { x: 100, y: 390, logo: 112 },
  kicker: { x: 100, y: 516 },
  frame: { x: 100, y: 560, width: 840, height: 472, radius: 12 },
  title: { x: 100, y: 1062, width: 780 },
  chapters: { x: 100, y: 1212, width: 800 },
  /** The shot's shrink into the frame. */
  shrinkMs: 300,
} as const

/** When each element arrives, from the card's start. */
const ENTER_MS = { channel: 200, kicker: 320, title: 440, chapters: 560, frame: 300, cta: 700 }

function rise(tMs: number, at: number, scale: number): CSSProperties {
  const p = easeInOut(Math.min(1, Math.max(0, (tMs - at) / 260)))
  return { opacity: p, transform: `translateY(${24 * scale * (1 - p)}px)` }
}

const lerp = (from: number, to: number, p: number) => from + (to - from) * p

/**
 * The slot layer's style while an end card is up, `tMs` after it started:
 * the whole picture scales and slides into the frame and is clipped to it,
 * so the shot keeps playing inside the "full video". Pure, for the test.
 */
export function endCardSlotStyle(tMs: number, width: number, height: number): CSSProperties {
  const scale = frameScale(width, height)
  const { frame, shrinkMs } = END_CARD_LAYOUT
  const p = easeInOut(Math.min(1, Math.max(0, tMs / shrinkMs)))

  const target = {
    x: frame.x * scale,
    y: frame.y * scale,
    w: frame.width * scale,
    h: frame.height * scale,
  }
  const s = lerp(1, target.w / width, p)
  const dx = lerp(0, target.x + target.w / 2 - width / 2, p)
  const dy = lerp(0, target.y + target.h / 2 - height / 2, p)
  // The visible rectangle on screen, from the whole frame to the target.
  const left = lerp(0, target.x, p)
  const top = lerp(0, target.y, p)
  const right = lerp(width, target.x + target.w, p)
  const bottom = lerp(height, target.y + target.h, p)
  // The same rectangle in the layer's own coordinates (origin at its centre).
  const local = (screen: number, centre: number, d: number) => centre + (screen - centre - d) / s
  const insetTop = local(top, height / 2, dy)
  const insetLeft = local(left, width / 2, dx)
  const insetRight = width - local(right, width / 2, dx)
  const insetBottom = height - local(bottom, height / 2, dy)
  const radius = (frame.radius * scale * p) / s

  return {
    transform: `translate(${dx}px, ${dy}px) scale(${s})`,
    transformOrigin: 'center center',
    clipPath: `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px round ${radius}px)`,
  }
}

function formatRuntime(ms: number): string {
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

/** "Boom & Busters" reads "B&B": the mark's stand-in when the channel has no logo. */
export function channelInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word === '&' ? '&' : word.charAt(0).toUpperCase()))
    .join('')
    .slice(0, 4)
}

/**
 * The channel's mark in a ringed disc: the logo when the brand kit has one
 * and it loads, the channel's initials otherwise, so the layout never has a
 * hole where the mark should be.
 */
export function ChannelLogo({
  brand,
  name,
  size,
  ring,
}: {
  brand: BrandKitTokens
  name: string
  size: number
  ring: number
}) {
  const [broken, setBroken] = useState(false)
  const logo = brand.look.logoUrl && !broken ? brand.look.logoUrl : null
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        overflow: 'hidden',
        backgroundColor: brand.colors.surface,
        boxShadow: `0 0 0 ${ring}px ${brand.colors.accent}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {logo ? (
        <Img
          src={logo}
          onError={() => setBroken(true)}
          style={{ width: '72%', height: '72%', objectFit: 'contain' }}
        />
      ) : (
        <div
          style={{
            ...fixedTypeStyle(brand.typography.heading, 1, size / 3),
            color: brand.colors.textPrimary,
            letterSpacing: '-0.02em',
          }}
        >
          {channelInitials(name)}
        </div>
      )}
    </div>
  )
}

export function EndCard({
  channelName,
  title,
  chapters,
  runtimeMs,
  label,
  brand,
}: {
  channelName: string
  title: string
  chapters: readonly { number: number; title: string }[]
  runtimeMs: number | null
  label: string
  brand: BrandKitTokens
}) {
  const frameNo = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const tMs = (frameNo / fps) * 1000
  const { colors, typography } = brand
  const L = END_CARD_LAYOUT
  const framed = easeInOut(Math.min(1, Math.max(0, (tMs - ENTER_MS.frame) / 200)))

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* The channel block: the follow ask, first thing read. */}
      <div
        style={{
          position: 'absolute',
          left: L.channel.x * scale,
          top: L.channel.y * scale,
          display: 'flex',
          alignItems: 'center',
          gap: 26 * scale,
          ...rise(tMs, ENTER_MS.channel, scale),
        }}
      >
        <ChannelLogo
          brand={brand}
          name={channelName}
          size={L.channel.logo * scale}
          ring={4 * scale}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 * scale }}>
          <div
            style={{
              ...fixedTypeStyle(typography.heading, 44, scale),
              color: colors.textPrimary,
              whiteSpace: 'nowrap',
            }}
          >
            {channelName}
          </div>
          <div
            style={{
              ...fixedTypeStyle(typography.body, 30, scale),
              fontWeight: 600,
              color: withAlpha(colors.textPrimary, 0.82),
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: colors.accent }}>Follow</span> for the next case
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: L.kicker.x * scale,
          top: L.kicker.y * scale,
          ...fixedTypeStyle(typography.captions, 30, scale),
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: colors.accent,
          ...rise(tMs, ENTER_MS.kicker, scale),
        }}
      >
        The full story
      </div>

      {/* The frame's furniture over the shrunken shot: a hairline, the play
          button and the long form's runtime. */}
      <div
        style={{
          position: 'absolute',
          left: L.frame.x * scale,
          top: L.frame.y * scale,
          width: L.frame.width * scale,
          height: L.frame.height * scale,
          borderRadius: L.frame.radius * scale,
          boxShadow: `0 0 0 ${2 * scale}px ${withAlpha(colors.textPrimary, 0.1)}`,
          opacity: framed,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: (L.frame.width / 2 - 64) * scale,
            top: (L.frame.height / 2 - 64) * scale,
            width: 128 * scale,
            height: 128 * scale,
            borderRadius: '50%',
            backgroundColor: colors.accent,
            boxShadow: `0 ${10 * scale}px ${40 * scale}px ${withAlpha('#000000', 0.45)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${0.85 + 0.15 * framed})`,
          }}
        >
          <svg width={52 * scale} height={52 * scale} viewBox="0 0 24 24" aria-hidden>
            <path d="M7 4.5v15l12.5-7.5z" fill={colors.background} />
          </svg>
        </div>
        {runtimeMs !== null ? (
          <div
            style={{
              position: 'absolute',
              right: 20 * scale,
              bottom: 24 * scale,
              padding: `${6 * scale}px ${14 * scale}px`,
              borderRadius: 6 * scale,
              backgroundColor: withAlpha('#000000', 0.78),
              ...fixedTypeStyle(typography.numbers, 26, scale),
              color: colors.textPrimary,
            }}
          >
            {formatRuntime(runtimeMs)}
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: 'absolute',
          left: L.title.x * scale,
          top: L.title.y * scale,
          width: L.title.width * scale,
          ...fixedTypeStyle(typography.heading, 60, scale),
          lineHeight: 1.1,
          color: colors.textPrimary,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          ...rise(tMs, ENTER_MS.title, scale),
        }}
      >
        {title}
      </div>

      {chapters.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: L.chapters.x * scale,
            top: L.chapters.y * scale,
            width: L.chapters.width * scale,
            display: 'flex',
            flexDirection: 'column',
            gap: 8 * scale,
            ...rise(tMs, ENTER_MS.chapters, scale),
          }}
        >
          <div
            style={{
              ...fixedTypeStyle(typography.captions, 22, scale),
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: colors.textSecondary,
            }}
          >
            Only in the full video
          </div>
          {chapters.map((chapter) => (
            <div
              key={chapter.number}
              style={{ display: 'flex', alignItems: 'baseline', gap: 22 * scale }}
            >
              <div
                style={{
                  ...fixedTypeStyle(typography.numbers, 26, scale),
                  color: colors.accent,
                  flexShrink: 0,
                }}
              >
                CH {String(chapter.number).padStart(2, '0')}
              </div>
              <div
                style={{
                  ...fixedTypeStyle(typography.title, 32, scale),
                  color: colors.textPrimary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {chapter.title}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* The call to action lands last, with the related arrow's own pulse. */}
      <Sequence from={msToFrames(ENTER_MS.cta, fps)} layout="none" name="end card call to action">
        <RelatedArrow label={label} brand={brand} />
      </Sequence>
    </AbsoluteFill>
  )
}

/** Studio and snapshot fixture: the card over the brand ground, the frame left empty. */
export function EndCardFixture({ brand }: { brand: BrandKitTokens }) {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <EndCard
        channelName="Boom & Busters"
        title="How Wirecard fell: the audit that found nothing"
        chapters={[
          { number: 4, title: 'The audit' },
          { number: 6, title: 'The trial' },
        ]}
        runtimeMs={1_122_000}
        label="Watch the full video"
        brand={brand}
      />
    </AbsoluteFill>
  )
}
