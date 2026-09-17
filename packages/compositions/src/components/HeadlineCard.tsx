import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'
import type { BrandKitTokens, HeadlinePayload } from '@boom-busters/schemas'
import { formatPublished, splitHeadline } from '../lib/headline'
import { easeInOut } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * A cited news headline, as a clipping (decision 257).
 *
 * What the card is FOR decides how it looks: it is a quotation with its source
 * attached, so it reads as a cutting rather than as a screenshot of anybody's
 * page. The outlet's name is set in our own serif at our own size; there is no
 * logo, no per-outlet styling and no field for either. That uniformity is the
 * legal argument as much as the brand one, because a card identical whatever
 * ran the story is a citation, while a pixel-accurate copy of one publisher's
 * page is closer to a forgery.
 *
 * Every string here was read from the article itself or typed by the owner.
 * Nothing on this card was written by a model.
 */

/** Warm paper against the dark grade: the strongest contrast the film has. */
const PAPER = '#f4f1ea'
const INK = '#14161a'
const INK_MUTED = '#5f646d'
const RULE = '#c9c3b5'
const DECK_INK = '#3c414a'
const SERIF = '"Source Serif 4", Georgia, serif'

const SETTLE_MS = 420
const MARKER_DELAY_MS = 700
const MARKER_MS = 520
/** A slow lift across the shot, so the card is never a dead still. */
const DRIFT_MS = 8000
const DRIFT = 0.012

function progress(frame: number, fps: number, delayMs: number, ms: number): number {
  const tMs = (frame / fps) * 1000 - delayMs
  return easeInOut(Math.min(1, Math.max(0, tMs / ms)))
}

/** The highlighter: an accent wash under the bottom third of the glyphs. */
function marker(accent: string, sweep: number): CSSProperties {
  return {
    backgroundImage: `linear-gradient(transparent 58%, ${withAlpha(accent, 0.55)} 58%)`,
    backgroundSize: `${sweep * 100}% 100%`,
    backgroundRepeat: 'no-repeat',
    paddingInline: '0.04em',
  }
}

export function HeadlineCard({
  payload,
  brand,
}: {
  payload: HeadlinePayload
  brand: BrandKitTokens
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const portrait = height > width
  const { colors, typography } = brand

  const settle = progress(frame, fps, 0, SETTLE_MS)
  const sweep = progress(frame, fps, MARKER_DELAY_MS, MARKER_MS)
  const drift = 1 + DRIFT * progress(frame, fps, 0, DRIFT_MS)
  const parts = splitHeadline(payload.headline, payload.emphasis)

  const masthead: CSSProperties = {
    fontFamily: SERIF,
    fontWeight: 700,
    fontSize: (portrait ? 24 : 27) * scale,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: INK,
  }

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      {/* A lit surface rather than flat black, so the paper sits on something. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(90% 75% at 50% 44%, ${colors.surface} 0%, ${colors.background} 72%)`,
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          // Clear of the caption band in both orientations.
          paddingBottom: height * (portrait ? 0.16 : 0.08),
        }}
      >
        <div
          style={{
            width: width * (portrait ? 0.86 : 0.62),
            backgroundColor: PAPER,
            padding: `${(portrait ? 44 : 52) * scale}px ${(portrait ? 44 : 60) * scale}px ${(portrait ? 34 : 40) * scale}px`,
            boxShadow: `0 ${34 * scale}px ${72 * scale}px rgba(0,0,0,0.62)`,
            transform: `rotate(-1.1deg) translateY(${(1 - settle) * 26 * scale}px) scale(${drift * (0.985 + 0.015 * settle)})`,
            opacity: settle,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 24 * scale,
            }}
          >
            <span style={masthead}>{payload.outlet}</span>
            <span
              style={{
                fontFamily: SERIF,
                fontWeight: 400,
                fontSize: (portrait ? 20 : 22) * scale,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: INK_MUTED,
                whiteSpace: 'nowrap',
              }}
            >
              {formatPublished(payload.publishedAt)}
            </span>
          </div>

          {/* The double rule under a masthead: a newspaper's own idiom. */}
          <div style={{ height: 3 * scale, backgroundColor: INK, marginTop: 14 * scale }} />
          <div style={{ height: 1 * scale, backgroundColor: INK, marginTop: 3 * scale }} />

          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: (portrait ? 66 : 76) * scale,
              lineHeight: 1.08,
              letterSpacing: '-0.012em',
              color: INK,
              marginTop: 32 * scale,
            }}
          >
            {parts.before}
            {parts.hit === '' ? null : (
              <span style={marker(colors.accent, sweep)}>{parts.hit}</span>
            )}
            {parts.after}
          </div>

          {payload.deck === undefined ? null : (
            <div
              style={{
                fontFamily: SERIF,
                fontWeight: 400,
                fontSize: (portrait ? 29 : 31) * scale,
                lineHeight: 1.38,
                color: DECK_INK,
                marginTop: 24 * scale,
              }}
            >
              {payload.deck}
            </div>
          )}

          <div style={{ height: 1 * scale, backgroundColor: RULE, marginTop: 32 * scale }} />
          <div
            style={{
              display: 'flex',
              flexDirection: portrait ? 'column' : 'row',
              alignItems: portrait ? 'flex-start' : 'baseline',
              justifyContent: 'space-between',
              gap: (portrait ? 8 : 24) * scale,
              marginTop: 18 * scale,
            }}
          >
            {/* A wire story has no byline, and the card does not invent one. */}
            <span
              style={{
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: 25 * scale,
                color: INK_MUTED,
              }}
            >
              {payload.author === undefined ? payload.outlet : `By ${payload.author}`}
            </span>
            {/* Where it can be checked: the acknowledgement quotation asks for. */}
            <span
              style={{
                ...typeStyle(typography.numbers, 20, scale),
                color: INK_MUTED,
                letterSpacing: '0.02em',
              }}
            >
              {payload.sourceLabel}
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
