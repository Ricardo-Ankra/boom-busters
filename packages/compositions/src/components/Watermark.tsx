import { AbsoluteFill, Img, useVideoConfig } from 'remotion'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { frameScale, typeStyle, withAlpha } from './brand'

/** The corner watermark: the channel mark, or the typographic wordmark. */

const WORDMARK_PX = 24
/** The mark sits at 1.6 times the caption size: legible, never a title. */
const MARK_HEIGHT_PX = Math.round(WORDMARK_PX * 1.6)
const MARK_ALPHA = 0.6

function cornerStyle(
  placement: BrandKitTokens['look']['watermarkPlacement'],
  inset: number,
): CSSProperties {
  return {
    position: 'absolute',
    ...(placement === 'tl' || placement === 'tr' ? { top: inset } : { bottom: inset }),
    ...(placement === 'tl' || placement === 'bl' ? { left: inset } : { right: inset }),
  }
}

/**
 * The channel mark when the brand kit names one and the materialiser
 * resolved it (decision 268); otherwise the typographic "Boom & Busters"
 * wordmark, which is what every film carried before there was a logo
 * library. The fallback is deliberate: a broken image in every frame would
 * be worse than clean type.
 */
export function Watermark({ brand }: { brand: BrandKitTokens }) {
  const { width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const placement = brand.look.watermarkPlacement
  const [broken, setBroken] = useState(false)
  if (placement === 'none') return null
  const position = cornerStyle(placement, Math.round(36 * scale))

  if (brand.look.logoUrl && !broken) {
    return (
      <Img
        src={brand.look.logoUrl}
        onError={() => setBroken(true)}
        style={{
          ...position,
          height: Math.round(MARK_HEIGHT_PX * scale),
          // Width follows the mark's own shape; a wide lockup stays wide.
          maxWidth: Math.round(width * 0.22),
          objectFit: 'contain',
          opacity: MARK_ALPHA,
        }}
      />
    )
  }

  return (
    <div
      style={{
        ...position,
        ...typeStyle(brand.typography.captions, WORDMARK_PX, scale),
        color: withAlpha(brand.colors.textPrimary, 0.45),
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      Boom &amp; Busters
    </div>
  )
}

/** Studio and snapshot fixture: the mark over the brand ground, nothing else. */
export function WatermarkFixture({ brand }: { brand: BrandKitTokens }) {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <Watermark brand={brand} />
    </AbsoluteFill>
  )
}
