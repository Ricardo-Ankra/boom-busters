'use client'

import * as React from 'react'
import { loadBrandFonts } from '@boom-busters/compositions'
import { RESTING_SOCIAL_PROGRESS } from '@boom-busters/compositions/social'
import { SocialPostCard } from '@boom-busters/compositions/social-card'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitStored, SocialPayload } from '@boom-busters/schemas'

/**
 * The board's post card (decision 284, spec section 6): the render's own
 * `SocialPostCard`, drawn at its resting values, so what the owner approves
 * is the markup the render settles into rather than a lookalike.
 *
 * The card is laid out at the frame's full pixel size and scaled down to the
 * slot's width with a CSS transform, which keeps every size the layout
 * module chose in step with the render. A plain `img` stands in for
 * Remotion's `<Img>`: the board has no frames to hold for a picture.
 */

const MASTER_FRAME = { width: 1920, height: 1080 }
/** Until the box is measured (and in jsdom, which never measures): a board card's typical width. */
const FALLBACK_WIDTH_PX = 480

export function SocialPreview({
  payload,
  brand,
  frame = MASTER_FRAME,
}: {
  payload: SocialPayload
  brand: BrandKitStored
  frame?: { width: number; height: number }
}) {
  const tokens = React.useMemo(
    () => resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand }),
    [brand],
  )
  const boxRef = React.useRef<HTMLDivElement | null>(null)
  const [widthPx, setWidthPx] = React.useState(FALLBACK_WIDTH_PX)

  React.useEffect(() => {
    // Idempotent, and the same call the Brand Kit specimen makes: without the
    // brand's faces the card would wrap in a fallback font and could show
    // lines the render will not.
    // A family the catalog does not bundle throws synchronously; the card
    // still draws, in the fallback face, rather than taking the board down.
    try {
      void loadBrandFonts(brand.typography).catch(() => undefined)
    } catch {
      // Nothing to add: the Brand Kit screen is where a bad family is fixed.
    }
  }, [brand.typography])

  React.useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      if (box.clientWidth > 0) setWidthPx(box.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label="Post card preview"
      className="relative w-full overflow-hidden rounded-[8px] border border-[var(--color-border)]"
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: frame.width,
          height: frame.height,
          transform: `scale(${widthPx / frame.width})`,
          transformOrigin: 'top left',
        }}
      >
        <SocialPostCard
          payload={payload}
          brand={tokens}
          frame={frame}
          progress={RESTING_SOCIAL_PROGRESS}
          ImageComponent="img"
        />
      </div>
    </div>
  )
}
