import type { GraphicProps } from '@boom-busters/compositions/graphic-code-pure'
import { AVAILABLE_FONTS } from '@boom-busters/compositions/fonts'

/**
 * The pure parts of the frames' pages: colour maths and the brand's font
 * stylesheet. Kept apart from `frames.ts` (which reaches the sandbox and the
 * browser) so a client component or a test can import them without either.
 * `frames.ts` re-exports them.
 */

/** A CSS colour as the page reports it (`rgb()`, `rgba()`) or as the brand holds it (`#rgb`, `#rrggbb`); null otherwise. */
function cssColour(value: string): { r: number; g: number; b: number; a: number } | null {
  const text = value.trim()
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    text,
  )
  if (fn) {
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a: fn[4] === undefined ? 1 : Number(fn[4]),
    }
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const digits = hex[1]!
    const wide = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits
    return {
      r: parseInt(wide.slice(0, 2), 16),
      g: parseInt(wide.slice(2, 4), 16),
      b: parseInt(wide.slice(4, 6), 16),
      a: 1,
    }
  }
  return null
}

function luminance(c: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/**
 * The WCAG contrast ratio of type over its ground. A translucent foreground
 * is blended over the ground first; a ground that is itself translucent
 * cannot be judged (what shows through is unknown), so null, as is a colour
 * the page did not resolve to numbers.
 */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = cssColour(foreground)
  const bg = cssColour(background)
  if (!fg || !bg || bg.a < 1) return null
  const blended = {
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
  }
  const l1 = luminance(blended)
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** The Google Fonts stylesheet for the brand's faces, at the weights the catalogue bundles. */
export function fontsHref(fonts: GraphicProps['brand']['fonts']): string | null {
  const families = [...new Set(Object.values(fonts))]
  const params = families.flatMap((family) => {
    const known = AVAILABLE_FONTS.find((font) => font.family === family)
    if (!known) return []
    return [
      `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${known.weights.join(';')}`,
    ]
  })
  return params.length > 0
    ? `https://fonts.googleapis.com/css2?${params.join('&')}&display=block`
    : null
}

/** A colour as `#rrggbb` channels, for laying a scrim over white and black; null when unreadable. */
export function rgbOf(value: string): { r: number; g: number; b: number } | null {
  const c = cssColour(value)
  return c ? { r: c.r, g: c.g, b: c.b } : null
}
