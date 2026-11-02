import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { easeInOut } from '../lib/motion'
import { frameScale, typeStyle } from './brand'

/**
 * Where the arrow sits on a 1080 x 1920 frame (scale 1). The label lives
 * inside the Short safe area; only the tip leaves it, because the related-video
 * card YouTube draws sits in the bottom-left, below the safe area.
 */
export const RELATED_ARROW_LAYOUT = {
  label: { x: 140, y: 1390, width: 800, height: 110 },
  tip: { x: 120, y: 1700 },
  /** Where the shaft leaves the label's bottom edge. */
  tail: { x: 300, y: 1510 },
} as const

/**
 * The bridge's "watch the full video" pointer (playbook Shorts, spec 4.6): a
 * labelled arrow in the accent colour whose tip points down-left at the
 * related-video card. Slides in over 200 ms, then pulses about its tip so the
 * tip never drifts. Only the Short compiler emits the `relatedArrow` overlay.
 */
export function RelatedArrow({ label, brand }: { label: string; brand: BrandKitTokens }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const { colors, typography } = brand
  const { label: box, tip, tail } = RELATED_ARROW_LAYOUT

  const tMs = (frame / fps) * 1000
  const enter = easeInOut(Math.min(1, tMs / 200))
  const pulse = 1 + 0.06 * Math.sin((tMs / 1000) * Math.PI * 2 * 1.5)

  // Arrowhead: two barbs swept back from the tip along the shaft.
  const dx = tail.x - tip.x
  const dy = tail.y - tip.y
  const length = Math.hypot(dx, dy)
  const ux = dx / length
  const uy = dy / length
  const barb = 56
  const spread = 0.5
  const barbPoint = (sign: number) => {
    const cos = Math.cos(spread * sign)
    const sin = Math.sin(spread * sign)
    return {
      x: tip.x + barb * (ux * cos - uy * sin),
      y: tip.y + barb * (ux * sin + uy * cos),
    }
  }
  const left = barbPoint(1)
  const right = barbPoint(-1)

  return (
    <AbsoluteFill style={{ opacity: enter, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${-40 * scale * (1 - enter)}px, ${30 * scale * (1 - enter)}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: box.x * scale,
            top: box.y * scale,
            width: box.width * scale,
            height: box.height * scale,
            display: 'flex',
            alignItems: 'center',
            transform: `scale(${pulse})`,
            transformOrigin: `${(tip.x - box.x) * scale}px ${(tip.y - box.y) * scale}px`,
          }}
        >
          <div
            style={{
              ...typeStyle(typography.captions, 54, scale),
              color: colors.textPrimary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              textShadow: `0 ${2 * scale}px ${12 * scale}px ${colors.background}`,
            }}
          >
            {label}
          </div>
        </div>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width / scale} ${height / scale}`}
          style={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${pulse})`,
            transformOrigin: `${tip.x * scale}px ${tip.y * scale}px`,
          }}
        >
          <g
            stroke={colors.accent}
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <line x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} />
            <polyline points={`${left.x},${left.y} ${tip.x},${tip.y} ${right.x},${right.y}`} />
          </g>
        </svg>
      </div>
    </AbsoluteFill>
  )
}
