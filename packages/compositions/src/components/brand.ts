import type { CSSProperties } from 'react'
import type { TypeRole } from '@boom-busters/schemas'

/**
 * A typography role as CSS. `basePx` is the role's size at 1080p BEFORE the
 * role's own sizeScale; callers multiply by the frame scale so the same
 * tokens hold on a 9:16 short. Numbers are always tabular lining — money
 * amounts must line up (spec section 10).
 */
export function typeStyle(role: TypeRole, basePx: number, frameScale = 1): CSSProperties {
  return {
    fontFamily: `"${role.family}", sans-serif`,
    fontWeight: role.weight,
    fontSize: Math.round(basePx * role.sizeScale * frameScale),
    letterSpacing: `${role.letterSpacing}em`,
    textTransform: role.transform,
    fontVariantNumeric: 'tabular-nums lining-nums',
  }
}

/** #rrggbb + alpha in [0,1] → #rrggbbaa. Brand colours are always 6-digit hex. */
export function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  return `${hex}${channel.toString(16).padStart(2, '0')}`
}

/** The frame scale: 1 at 1080p in either orientation. */
export function frameScale(width: number, height: number): number {
  return Math.min(width, height) / 1080
}
