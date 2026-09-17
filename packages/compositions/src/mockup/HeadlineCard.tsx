import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties, ReactNode } from 'react'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from '../components/brand'

/**
 * THROWAWAY MOCK-UP — not wired into anything, not committed.
 *
 * Treatments of a "headline" shot, for approval before any schema, planner or
 * compiler work happens. Each takes the same facts, which is the point: one
 * house format, whatever outlet ran the story.
 */

export interface HeadlineFacts {
  /** The masthead NAME, always set in our type. Never their logo. */
  outlet: string
  /** Verbatim, as published. */
  headline: string
  /** The words the narration is leaning on, highlighted. Must appear in `headline`. */
  emphasis?: string
  /** Standfirst / deck: one line at most. Dropped on portrait. */
  deck?: string
  author: string
  /** Display form of the PUBLICATION date. */
  publishedAt: string
  /** Where it can be checked. Rendered small, and it is what the brief cites. */
  sourceDomain: string
}

const PAPER = '#f4f1ea'
const INK = '#14161a'
const INK_MUTED = '#5f646d'
const RULE = '#c9c3b5'
const SERIF = '"Source Serif 4", Georgia, serif'

/** 0 → 1 over `ms`, starting at `delayMs`. */
function progress(frame: number, fps: number, delayMs: number, ms: number): number {
  const tMs = (frame / fps) * 1000 - delayMs
  return easeInOut(Math.min(1, Math.max(0, tMs / ms)))
}

/** The headline split around the emphasised phrase, so it can be marked. */
function splitEmphasis(headline: string, emphasis: string | undefined) {
  if (emphasis === undefined) return { before: headline, hit: '', after: '' }
  const at = headline.indexOf(emphasis)
  if (at === -1) return { before: headline, hit: '', after: '' }
  return {
    before: headline.slice(0, at),
    hit: emphasis,
    after: headline.slice(at + emphasis.length),
  }
}

/** On paper: a highlighter sweep under the bottom third of the glyphs. */
function marker(accent: string, sweep: number): CSSProperties {
  return {
    backgroundImage: `linear-gradient(transparent 58%, ${withAlpha(accent, 0.55)} 58%)`,
    backgroundSize: `${sweep * 100}% 100%`,
    backgroundRepeat: 'no-repeat',
    paddingInline: '0.04em',
  }
}

/**
 * On dark: the accent as the TEXT colour with a rule under it. A wash behind
 * white type just turns brown and costs legibility.
 */
function markerOnDark(accent: string, sweep: number): CSSProperties {
  return {
    color: accent,
    backgroundImage: `linear-gradient(${accent}, ${accent})`,
    backgroundSize: `${sweep * 100}% 0.07em`,
    backgroundPosition: '0 88%',
    backgroundRepeat: 'no-repeat',
  }
}

/** The stage the paper sits on: a pool of light, not flat black. */
function Stage({ colors, children }: { colors: BrandKitTokens['colors']; children: ReactNode }) {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(90% 75% at 50% 44%, ${colors.surface} 0%, ${colors.background} 72%)`,
        }}
      />
      {children}
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------
// A — The clipping
// ---------------------------------------------------------------------------

export function HeadlineClipping({
  facts,
  brand,
  backdrop,
}: {
  facts: HeadlineFacts
  brand: BrandKitTokens
  /** Optional: the shot underneath, so the card need not cut to black. */
  backdrop?: string
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const portrait = height > width
  const { colors } = brand

  const settle = progress(frame, fps, 0, 420)
  const sweep = progress(frame, fps, 700, 520)
  const drift = 1 + 0.012 * progress(frame, fps, 0, 8000)
  const parts = splitEmphasis(facts.headline, facts.emphasis)

  const card = (
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
        <span
          style={{
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: (portrait ? 24 : 27) * scale,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: INK,
          }}
        >
          {facts.outlet}
        </span>
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
          {facts.publishedAt}
        </span>
      </div>

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
        {parts.hit ? <span style={marker(colors.accent, sweep)}>{parts.hit}</span> : null}
        {parts.after}
      </div>

      {facts.deck !== undefined ? (
        <div
          style={{
            fontFamily: SERIF,
            fontWeight: 400,
            fontSize: (portrait ? 29 : 31) * scale,
            lineHeight: 1.38,
            color: '#3c414a',
            marginTop: 24 * scale,
          }}
        >
          {facts.deck}
        </div>
      ) : null}

      <div style={{ height: 1 * scale, backgroundColor: RULE, marginTop: 32 * scale }} />
      <div
        style={{
          display: 'flex',
          flexDirection: portrait ? 'column' : 'row',
          alignItems: portrait ? 'flex-start' : 'baseline',
          justifyContent: 'space-between',
          gap: portrait ? 8 * scale : 24 * scale,
          marginTop: 18 * scale,
        }}
      >
        <span
          style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 25 * scale, color: INK_MUTED }}
        >
          By {facts.author}
        </span>
        <span
          style={{
            ...typeStyle(brand.typography.numbers, 20, scale),
            color: INK_MUTED,
            letterSpacing: '0.02em',
          }}
        >
          {facts.sourceDomain}
        </span>
      </div>
    </div>
  )

  const body = (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: height * (portrait ? 0.16 : 0.08),
      }}
    >
      {card}
    </AbsoluteFill>
  )

  if (backdrop !== undefined) {
    return (
      <AbsoluteFill style={{ backgroundColor: colors.background }}>
        <Img
          src={backdrop}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: `blur(${6 * scale}px) saturate(0.8)`,
            transform: 'scale(1.06)',
          }}
        />
        <AbsoluteFill
          style={{ backgroundColor: withAlpha(colors.background, 0.45 + 0.2 * settle) }}
        />
        {body}
      </AbsoluteFill>
    )
  }

  return <Stage colors={colors}>{body}</Stage>
}

// ---------------------------------------------------------------------------
// B — Full frame
// ---------------------------------------------------------------------------

export function HeadlineFullFrame({
  facts,
  brand,
}: {
  facts: HeadlineFacts
  brand: BrandKitTokens
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const portrait = height > width
  const { colors, typography } = brand

  const settle = progress(frame, fps, 0, 420)
  const sweep = progress(frame, fps, 800, 520)
  const rule = progress(frame, fps, 180, 500)
  const parts = splitEmphasis(facts.headline, facts.emphasis)

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(140deg, ${withAlpha(colors.surface, 0.95)} 0%, ${colors.background} 58%)`,
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          paddingLeft: width * 0.1,
          paddingRight: width * 0.12,
          paddingBottom: height * (portrait ? 0.2 : 0.1),
        }}
      >
        <div style={{ opacity: settle, transform: `translateY(${(1 - settle) * 18 * scale}px)` }}>
          <div
            style={{
              ...typeStyle(typography.heading, 27, scale),
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
              color: colors.accent,
            }}
          >
            {facts.outlet}
          </div>
          <div
            style={{
              width: 110 * scale * rule,
              height: 4 * scale,
              backgroundColor: colors.accent,
              marginTop: 20 * scale,
              marginBottom: 34 * scale,
            }}
          />
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: (portrait ? 74 : 92) * scale,
              lineHeight: 1.07,
              letterSpacing: '-0.015em',
              color: colors.textPrimary,
            }}
          >
            {parts.before}
            {parts.hit ? (
              <span style={markerOnDark(colors.accent, sweep)}>{parts.hit}</span>
            ) : null}
            {parts.after}
          </div>
          <div
            style={{
              ...typeStyle(typography.body, 26, scale),
              color: colors.textSecondary,
              marginTop: 38 * scale,
            }}
          >
            {facts.author} &nbsp;·&nbsp; {facts.publishedAt} &nbsp;·&nbsp; {facts.sourceDomain}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------
// C — The stack: several outlets, one story
// ---------------------------------------------------------------------------

export function HeadlineStack({
  facts,
  behind,
  brand,
}: {
  facts: HeadlineFacts
  behind: readonly { outlet: string; headline: string }[]
  brand: BrandKitTokens
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const portrait = height > width
  const { colors } = brand

  const settle = progress(frame, fps, 240, 420)
  const sweep = progress(frame, fps, 1100, 520)
  const parts = splitEmphasis(facts.headline, facts.emphasis)

  const back = [
    { rotate: -7, x: -0.085, y: -0.075, size: 0.88, delay: 0 },
    { rotate: 5.4, x: 0.075, y: -0.045, size: 0.92, delay: 130 },
  ]

  return (
    <Stage colors={colors}>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: height * (portrait ? 0.16 : 0.08),
        }}
      >
        <div style={{ position: 'relative', width: width * (portrait ? 0.84 : 0.58) }}>
          {behind.map((card, index) => {
            const at = back[index] ?? back[0]!
            const enter = progress(frame, fps, at.delay, 420)
            return (
              <div
                key={card.outlet}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: '22%',
                  backgroundColor: PAPER,
                  padding: `${40 * scale}px ${48 * scale}px`,
                  boxShadow: `0 ${26 * scale}px ${56 * scale}px rgba(0,0,0,0.55)`,
                  transform: `rotate(${at.rotate}deg) translate(${width * at.x}px, ${height * at.y}px) scale(${at.size * (0.97 + 0.03 * enter)})`,
                  opacity: enter,
                  overflow: 'hidden',
                  filter: `blur(${1.6 * scale}px)`,
                }}
              >
                <div
                  style={{
                    fontFamily: SERIF,
                    fontWeight: 700,
                    fontSize: 24 * scale,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: INK,
                  }}
                >
                  {card.outlet}
                </div>
                <div style={{ height: 2 * scale, backgroundColor: INK, marginTop: 12 * scale }} />
                <div
                  style={{
                    fontFamily: SERIF,
                    fontWeight: 700,
                    fontSize: 54 * scale,
                    lineHeight: 1.1,
                    color: INK,
                    marginTop: 24 * scale,
                  }}
                >
                  {card.headline}
                </div>
                {/* Paper in shadow, not grey paper: a wash, never desaturation. */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: withAlpha(colors.background, 0.62),
                  }}
                />
              </div>
            )
          })}

          <div
            style={{
              position: 'relative',
              backgroundColor: PAPER,
              padding: `${44 * scale}px ${52 * scale}px ${34 * scale}px`,
              boxShadow: `0 ${36 * scale}px ${74 * scale}px rgba(0,0,0,0.7)`,
              transform: `rotate(-0.8deg) translateY(${(1 - settle) * 22 * scale}px) scale(${0.97 + 0.03 * settle})`,
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
              <span
                style={{
                  fontFamily: SERIF,
                  fontWeight: 700,
                  fontSize: 25 * scale,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: INK,
                }}
              >
                {facts.outlet}
              </span>
              <span
                style={{
                  fontFamily: SERIF,
                  fontSize: 21 * scale,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: INK_MUTED,
                  whiteSpace: 'nowrap',
                }}
              >
                {facts.publishedAt}
              </span>
            </div>
            <div style={{ height: 3 * scale, backgroundColor: INK, marginTop: 13 * scale }} />
            <div
              style={{
                fontFamily: SERIF,
                fontWeight: 700,
                fontSize: (portrait ? 56 : 64) * scale,
                lineHeight: 1.09,
                letterSpacing: '-0.012em',
                color: INK,
                marginTop: 28 * scale,
              }}
            >
              {parts.before}
              {parts.hit ? <span style={marker(colors.accent, sweep)}>{parts.hit}</span> : null}
              {parts.after}
            </div>
            <div style={{ height: 1 * scale, backgroundColor: RULE, marginTop: 30 * scale }} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 24 * scale,
                marginTop: 16 * scale,
              }}
            >
              <span
                style={{
                  fontFamily: SERIF,
                  fontWeight: 600,
                  fontSize: 23 * scale,
                  color: INK_MUTED,
                }}
              >
                By {facts.author}
              </span>
              <span style={{ ...typeStyle(brand.typography.numbers, 19, scale), color: INK_MUTED }}>
                {facts.sourceDomain}
              </span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Stage>
  )
}
