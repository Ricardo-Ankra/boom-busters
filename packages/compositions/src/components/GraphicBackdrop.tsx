import type { ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import type { BrandKitTokens } from '@boom-busters/schemas'

/**
 * The house frame every drawn graphic sits in: the brand background with a
 * soft radial lift of the surface colour. `GraphicCard` and `GraphicCode`
 * share this one component (decision 295), so a retune lands on both.
 */
export function GraphicBackdrop({
  colors,
  children,
}: {
  colors: BrandKitTokens['colors']
  children?: ReactNode
}) {
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
