/**
 * The app's own design system (build spec section 11.1) — deliberately
 * distinct from the channel Brand Kit, which styles the video, not the
 * console.
 *
 * Calm production console: near-monochrome zinc, exactly one accent
 * (indigo), semantic green/amber/red reserved for status. Borders over
 * shadows. Dark is the default because video review happens on dark.
 *
 * These constants are the source of truth; `tokens.css` mirrors them as CSS
 * custom properties. The contrast test in this package asserts both themes
 * clear WCAG AA.
 */

export interface ThemePalette {
  background: string
  surface: string
  surfaceRaised: string
  border: string
  borderStrong: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  accentHover: string
  accentForeground: string
  success: string
  warning: string
  danger: string
}

/** Default theme. */
export const darkPalette: ThemePalette = {
  background: '#09090b', // zinc-950
  surface: '#18181b', // zinc-900
  surfaceRaised: '#27272a', // zinc-800
  border: '#27272a',
  borderStrong: '#3f3f46', // zinc-700
  textPrimary: '#fafafa', // zinc-50
  textSecondary: '#a1a1aa', // zinc-400
  // Between zinc-500 and zinc-400: zinc-500 was 3.66:1 on the card surface,
  // under AA's 4.5 for the 12px labels this token actually decorates
  // (Lighthouse, M8.6). Light keeps zinc-500, which clears AA on white.
  textMuted: '#84848e',
  accent: '#4f46e5', // indigo-600
  accentHover: '#4338ca', // indigo-700
  accentForeground: '#ffffff',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
}

export const lightPalette: ThemePalette = {
  background: '#ffffff',
  surface: '#fafafa', // zinc-50
  surfaceRaised: '#f4f4f5', // zinc-100
  border: '#e4e4e7', // zinc-200 — the subtle 1px divider
  // zinc-400, not zinc-300: the "strong" border marks inputs and focusable
  // boundaries, and zinc-300 on white is 1.48:1, which reads as no border.
  borderStrong: '#a1a1aa',
  textPrimary: '#18181b', // zinc-900
  textSecondary: '#52525b', // zinc-600
  textMuted: '#71717a', // zinc-500
  accent: '#4f46e5',
  accentHover: '#4338ca',
  accentForeground: '#ffffff',
  success: '#15803d', // green-700 — AA on white
  warning: '#b45309', // amber-700
  danger: '#b91c1c', // red-700
}

/** 8px grid (section 11.1). */
export const spacing = {
  0.5: '4px',
  1: '8px',
  1.5: '12px',
  2: '16px',
  3: '24px',
  4: '32px',
  6: '48px',
  8: '64px',
} as const

export const radius = {
  sm: '4px',
  DEFAULT: '8px',
  lg: '12px',
  full: '9999px',
} as const

export const typography = {
  /** Geist or Inter for UI. */
  sans: 'var(--font-sans)',
  /** JetBrains Mono for numbers, costs, timecodes, ids and logs. */
  mono: 'var(--font-mono)',
  /** 13-14px base in dense tables, 15-16px in editors. */
  sizeDense: '13px',
  sizeBase: '14px',
  sizeEditor: '15px',
} as const

/** 150-200ms ease-out, on state changes only. */
export const motion = {
  fast: '150ms',
  base: '200ms',
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const

/** Minimum hit target for every button (section 11.1). */
export const MIN_HIT_TARGET_PX = 40

// ---------------------------------------------------------------------------
// Contrast maths — used by the tests that guard the accessibility promise
// ---------------------------------------------------------------------------

function channelLuminance(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) throw new Error(`Expected a #rrggbb colour, got "${hex}"`)
  const int = parseInt(match[1] as string, 16)
  const r = channelLuminance((int >> 16) & 0xff)
  const g = channelLuminance((int >> 8) & 0xff)
  const b = channelLuminance(int & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}
