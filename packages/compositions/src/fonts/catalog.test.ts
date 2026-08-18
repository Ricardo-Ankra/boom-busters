import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { AVAILABLE_FONTS, assertBundledFamily, availableFont } from './catalog'

describe('AVAILABLE_FONTS', () => {
  it('covers every typography role, so the Brand Kit UI always has an option', () => {
    for (const role of ['heading', 'title', 'body', 'numbers', 'captions'] as const) {
      expect(AVAILABLE_FONTS.some((font) => font.roles.includes(role))).toBe(true)
    }
  })

  it('is SIL OFL throughout — safe for commercial video', () => {
    for (const font of AVAILABLE_FONTS) {
      expect(font.licence).toBe('SIL OFL 1.1')
    }
  })

  it("bundles the default brand's families and weights", () => {
    const typography = DEFAULT_SETTINGS.brandKit.typography
    for (const role of Object.values(typography)) {
      const font = availableFont(role.family)
      expect(font, `family ${role.family}`).toBeDefined()
      expect(font!.weights, `${role.family} ${role.weight}`).toContain(role.weight)
    }
  })
})

describe('assertBundledFamily', () => {
  it('returns the catalog entry for a bundled family', () => {
    expect(assertBundledFamily('Inter').family).toBe('Inter')
  })

  it('fails loudly for anything unbundled', () => {
    expect(() => assertBundledFamily('Comic Sans MS')).toThrow(/not bundled/)
  })
})
