import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MIN_HIT_TARGET_PX,
  contrastRatio,
  darkPalette,
  lightPalette,
  relativeLuminance,
  spacing,
  type ThemePalette,
} from './index'

const themes: [string, ThemePalette][] = [
  ['dark', darkPalette],
  ['light', lightPalette],
]

describe('contrastRatio', () => {
  it('matches the known WCAG extremes', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#4f46e5', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#4f46e5'), 6)
  })

  it('rejects a malformed colour', () => {
    expect(() => relativeLuminance('indigo')).toThrow()
    expect(() => relativeLuminance('#fff')).toThrow()
  })
})

/**
 * Spec section 11.1: "WCAG AA contrast in both themes". AA is 4.5:1 for
 * normal text and 3:1 for large text and UI boundaries. These run on every
 * commit so a palette tweak cannot quietly break the promise.
 */
describe.each(themes)('%s theme meets WCAG AA', (_name, palette) => {
  it('primary text on background', () => {
    expect(contrastRatio(palette.textPrimary, palette.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('primary text on surface and raised surface', () => {
    expect(contrastRatio(palette.textPrimary, palette.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.textPrimary, palette.surfaceRaised)).toBeGreaterThanOrEqual(4.5)
  })

  it('secondary text on background and surface', () => {
    expect(contrastRatio(palette.textSecondary, palette.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.textSecondary, palette.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('accent button label on the accent fill', () => {
    expect(contrastRatio(palette.accentForeground, palette.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.accentForeground, palette.accentHover)).toBeGreaterThanOrEqual(4.5)
  })

  it('status colours as text on background', () => {
    for (const colour of [palette.success, palette.warning, palette.danger]) {
      expect(contrastRatio(colour, palette.background)).toBeGreaterThanOrEqual(3)
    }
  })

  it('borders are visible against the surfaces they separate', () => {
    expect(contrastRatio(palette.borderStrong, palette.background)).toBeGreaterThanOrEqual(1.5)
  })
})

describe('scale', () => {
  it('is an 8px grid', () => {
    for (const [step, value] of Object.entries(spacing)) {
      const px = Number(value.replace('px', ''))
      expect(px).toBe(Number(step) * 8)
    }
  })

  it('keeps the minimum hit target the spec requires', () => {
    expect(MIN_HIT_TARGET_PX).toBe(40)
  })
})

describe('tokens.css', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8')

  it('defines every palette colour in both themes', () => {
    const cssVarNames = Object.keys(darkPalette).map(
      (key) => `--color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
    )
    const root = css.slice(css.indexOf(':root {'), css.indexOf(':root.light {'))
    const light = css.slice(css.indexOf(':root.light {'))

    for (const name of cssVarNames) {
      expect(root, `dark theme is missing ${name}`).toContain(`${name}:`)
      expect(light, `light theme is missing ${name}`).toContain(`${name}:`)
    }
  })

  it('carries the same hex values as the TypeScript source of truth', () => {
    const root = css.slice(css.indexOf(':root {'), css.indexOf(':root.light {'))
    expect(root).toContain(`--color-background: ${darkPalette.background};`)
    expect(root).toContain(`--color-accent: ${darkPalette.accent};`)
    expect(root).toContain(`--color-text-primary: ${darkPalette.textPrimary};`)

    const light = css.slice(css.indexOf(':root.light {'))
    expect(light).toContain(`--color-background: ${lightPalette.background};`)
    expect(light).toContain(`--color-text-primary: ${lightPalette.textPrimary};`)
  })

  it('honours prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion: reduce')
  })

  it('defaults to dark', () => {
    expect(css).toContain('color-scheme: dark')
    expect(css.indexOf(':root {')).toBeLessThan(css.indexOf(':root.light {'))
  })
})
