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
  /**
   * The accent as FOREGROUND text on the surfaces (links, "Today", the running
   * segment's label). Indigo-600 is a fill colour: white on it clears AA, but
   * it on the dark surfaces is 2.8:1 at the 11 to 13px it was being used at
   * (decision 246). Light keeps indigo-600, which is 7:1 on white.
   */
  accentText: string
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
  // zinc-600, not zinc-700: this border is what makes an outline button or an
  // input read as a control, and zinc-700 on the card surface was 1.7:1
  // against the 3:1 WCAG asks of a non-text boundary (decision 246).
  borderStrong: '#71717a', // zinc-500
  textPrimary: '#fafafa', // zinc-50
  textSecondary: '#a1a1aa', // zinc-400
  // Between zinc-500 and zinc-400: zinc-500 was 3.66:1 on the card surface,
  // under AA's 4.5 for the 12px labels this token actually decorates
  // (Lighthouse, M8.6). Light keeps zinc-500, which clears AA on white.
  // Raised again for decision 246: 4.0:1 on surface-raised, where hover
  // rows and chips put it. Now clears 4.5 on all three surfaces.
  textMuted: '#909099',
  accent: '#4f46e5', // indigo-600
  accentHover: '#4338ca', // indigo-700
  accentForeground: '#ffffff',
  accentText: '#818cf8', // indigo-400
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
  // zinc-500: zinc-400 on zinc-50 was 2.5:1, under the 3:1 a control
  // boundary needs (decision 246).
  borderStrong: '#71717a',
  textPrimary: '#18181b', // zinc-900
  textSecondary: '#52525b', // zinc-600
  // zinc-500 was 4.4:1 on the raised surface (decision 246).
  textMuted: '#6b6b74',
  accent: '#4f46e5',
  accentHover: '#4338ca',
  accentForeground: '#ffffff',
  accentText: '#4f46e5',
  success: '#15803d', // green-700 — AA on white
  warning: '#b45309', // amber-700
  danger: '#b91c1c', // red-700
}

/**
 * The spacing unit Tailwind multiplies every numeric utility by. 4px, the
 * framework default, so that `h-10` really is the 40px hit target the
 * components say it is and `p-4` really is 16px.
 *
 * It was 8px from M1 until decision 242 (2026-09-10): the "8px grid" of spec
 * section 11.1 had been encoded as the unit, which doubled every control, gap
 * and icon in the console (80px buttons, a 448px rail, 32px icons beside 13px
 * labels). The grid is a discipline about which steps to use, not a unit.
 */
export const SPACING_UNIT_PX = 4

/** The 8px grid (section 11.1): the steps layouts should reach for. */
export const spacing = {
  2: '8px',
  4: '16px',
  6: '24px',
  8: '32px',
  12: '48px',
  16: '64px',
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
