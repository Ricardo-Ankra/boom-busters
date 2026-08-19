/**
 * The curated font list (build spec sections 8.2 and 10.1). Compositions
 * cannot load arbitrary fonts at render time, so the Brand Kit's typography
 * choices are limited to exactly this set, bundled via @remotion/google-fonts.
 * The Settings UI reads this export — it can never offer an unbundled font —
 * and adding a font is a change to this file plus a redeploy of the Remotion
 * site, not a settings change.
 *
 * This module is pure data with no React or Remotion imports: the web app
 * imports it through `@boom-busters/compositions/fonts` without dragging any
 * video machinery into its bundle. All families are SIL OFL 1.1 — safe for
 * commercial video.
 */

export type FontRole = 'heading' | 'title' | 'body' | 'numbers' | 'captions'

export interface AvailableFont {
  family: string
  /** The weights bundled — a Brand Kit weight is snapped to the nearest. */
  weights: readonly number[]
  /** Which typography roles the family suits; the UI groups by this. */
  roles: readonly FontRole[]
  licence: 'SIL OFL 1.1'
}

export const AVAILABLE_FONTS: readonly AvailableFont[] = [
  {
    family: 'Inter',
    weights: [400, 500, 600, 700, 800],
    roles: ['heading', 'title', 'body', 'captions'],
    licence: 'SIL OFL 1.1',
  },
  {
    family: 'Archivo',
    weights: [500, 600, 700, 800],
    roles: ['heading', 'title', 'captions'],
    licence: 'SIL OFL 1.1',
  },
  {
    family: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    roles: ['numbers'],
    licence: 'SIL OFL 1.1',
  },
] as const

/** The catalog entry for a family, or undefined if it is not bundled. */
export function availableFont(family: string): AvailableFont | undefined {
  return AVAILABLE_FONTS.find((font) => font.family === family)
}

/**
 * Loud failure for unbundled families: a timeline naming a font this package
 * does not ship must fail before a frame renders, not fall back silently to
 * whatever the OS has.
 */
export function assertBundledFamily(family: string): AvailableFont {
  const font = availableFont(family)
  if (!font) {
    const known = AVAILABLE_FONTS.map((candidate) => candidate.family).join(', ')
    throw new Error(`font "${family}" is not bundled in the compositions package (have: ${known})`)
  }
  return font
}
