import type { CSSProperties } from 'react'
import type { BrandKitTokens, SocialPayload, TypeRole } from '@boom-busters/schemas'
import { formatPublished } from '../lib/headline'
import { markerSweep, mediaUrl } from '../lib/motion'
import {
  SOCIAL_LINE_HEIGHT,
  postSegments,
  socialDisplayText,
  socialLayout,
  type SocialProgress,
} from '../lib/social'
import { frameScale, withAlpha } from './brand'

/**
 * A real X post, embedded whole (decision 284, spec 5.2/5.6/6).
 *
 * Pure and computes nothing of its own: every size comes from `socialLayout`,
 * so the board's resting preview and this Remotion-driven render can never
 * disagree about where anything sits. No `remotion` import: `frame` and
 * `progress` are handed in rather than read from Remotion's hooks, so the
 * board can draw the identical component at rest (`RESTING_SOCIAL_PROGRESS`).
 */

const X_MARK_PATH =
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'

/**
 * A type role at a DRAWN size, with no `sizeScale` multiplied on top
 * (decision 283): every px `socialLayout` hands this component is already
 * the size it must draw at, unlike `typeStyle` (`components/brand.ts`),
 * which is built for callers still carrying an unscaled base size.
 */
function typeCss(role: TypeRole, px: number): CSSProperties {
  return {
    fontFamily: `"${role.family}", sans-serif`,
    fontWeight: role.weight,
    fontSize: px,
    letterSpacing: `${role.letterSpacing}em`,
    textTransform: role.transform,
    fontVariantNumeric: 'tabular-nums lining-nums',
  }
}

export function SocialPostCard({
  payload,
  brand,
  frame,
  progress,
  ImageComponent = 'img',
}: {
  payload: SocialPayload
  brand: BrandKitTokens
  frame: { width: number; height: number }
  progress: SocialProgress
  /** Remotion's `<Img>` in the render, so a frame waits for the picture; a plain `<img>` on the board. */
  ImageComponent?: React.ComponentType<React.ImgHTMLAttributes<HTMLImageElement>> | 'img'
}) {
  const { colors, typography } = brand
  const scale = frameScale(frame.width, frame.height)
  const display = socialDisplayText(payload.text, payload.cutBefore, payload.cutAfter)
  const layout = socialLayout({
    text: display,
    hasMedia: payload.media !== undefined,
    frame,
    brand,
  })
  const segments = postSegments(display, payload.emphasis)
  const Image = ImageComponent

  return (
    <div
      style={{
        position: 'relative',
        width: frame.width,
        height: frame.height,
        backgroundColor: colors.background,
        overflow: 'hidden',
      }}
    >
      {/* The house ground: a lit surface rather than flat black, same as HeadlineCard and GraphicCard. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(90% 75% at 50% 44%, ${colors.surface} 0%, ${colors.background} 72%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: layout.band.top,
          width: frame.width,
          height: layout.band.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: layout.card.width,
            backgroundColor: colors.surface,
            borderRadius: 20 * scale,
            padding: layout.card.padding,
            transform: `translateY(${(1 - progress.settle) * 26 * scale}px) scale(${progress.drift * (0.985 + 0.015 * progress.settle)})`,
            opacity: progress.settle,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: layout.headerGapPx }}>
            <div
              style={{
                width: layout.avatarPx,
                height: layout.avatarPx,
                flexShrink: 0,
                borderRadius: '50%',
                overflow: 'hidden',
                // Spec 8.4: accent letters on an accent-tinted disc.
                backgroundColor: withAlpha(colors.accent, 0.18),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {payload.avatar ? (
                <Image
                  src={mediaUrl(payload.avatar)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span
                  style={{
                    ...typeCss(typography.heading, layout.avatarPx * 0.36),
                    color: colors.accent,
                  }}
                >
                  {payload.initials}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <span
                style={{ ...typeCss(typography.heading, layout.namePx), color: colors.textPrimary }}
              >
                {payload.authorName}
              </span>
              <span
                style={{ ...typeCss(typography.body, layout.metaPx), color: colors.textSecondary }}
              >
                {`@${payload.handle} · ${formatPublished(payload.postedAt)}`}
              </span>
            </div>

            <svg
              width={layout.namePx}
              height={layout.namePx}
              viewBox="0 0 24 24"
              style={{ flexShrink: 0 }}
            >
              <path d={X_MARK_PATH} fill={colors.textSecondary} />
            </svg>
          </div>

          <div
            dir="auto"
            style={{
              ...typeCss(typography.body, layout.textPx),
              color: colors.textPrimary,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              lineHeight: SOCIAL_LINE_HEIGHT,
              marginTop: layout.headerGapPx,
            }}
          >
            {segments.map((segment, index) => (
              <span
                key={index}
                style={{
                  color: segment.entity ? colors.accent : undefined,
                  ...(segment.emphasised ? markerSweep(colors.accent, progress.sweep) : {}),
                }}
              >
                {segment.text}
              </span>
            ))}
          </div>

          {payload.media ? (
            <Image
              src={mediaUrl(payload.media)}
              style={{
                display: 'block',
                width: '100%',
                maxHeight: layout.mediaMaxPx,
                objectFit: 'cover',
                borderRadius: 12 * scale,
                marginTop: layout.mediaGapPx,
              }}
            />
          ) : null}

          <span
            style={{
              ...typeCss(typography.captions, layout.sourcePx),
              color: colors.textSecondary,
              display: 'block',
              marginTop: layout.sourceGapPx,
            }}
          >
            {payload.sourceLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
