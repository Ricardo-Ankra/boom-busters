import { describe, expect, it } from 'vitest'
import {
  LOGO_ACCEPT,
  LOGO_MAX_BYTES,
  LogoStoredMimeSchema,
  logoExtension,
  logoForEntity,
} from './logos'

describe('logo formats', () => {
  it('stores only raster formats every renderer draws', () => {
    for (const mime of ['image/png', 'image/webp', 'image/jpeg']) {
      expect(LogoStoredMimeSchema.safeParse(mime).success).toBe(true)
    }
    // Accepted at the door, never stored: both are converted to PNG first.
    expect(LogoStoredMimeSchema.safeParse('image/svg+xml').success).toBe(false)
    expect(LogoStoredMimeSchema.safeParse('image/avif').success).toBe(false)
  })

  it('names the extension a stored mark takes', () => {
    expect(logoExtension('image/png')).toBe('png')
    expect(logoExtension('image/webp')).toBe('webp')
    expect(logoExtension('image/jpeg')).toBe('jpg')
  })

  it('offers the picker every format the door converts, by type and by extension', () => {
    for (const token of [
      'image/png',
      'image/svg+xml',
      'image/webp',
      'image/avif',
      '.avif',
      '.svg',
    ]) {
      expect(LOGO_ACCEPT.split(',')).toContain(token)
    }
    expect(LOGO_MAX_BYTES).toBe(4 * 1024 * 1024)
  })
})

describe('logoForEntity', () => {
  const logos = [
    { id: 'a', title: 'Stability AI' },
    { id: 'b', title: 'Wirecard AG' },
  ]

  it('matches the exact name, whatever the case and spacing', () => {
    expect(logoForEntity('stability  ai', logos)?.id).toBe('a')
  })

  it('matches a name the planner wrote with a role after it', () => {
    expect(logoForEntity('Wirecard AG, the payments processor', logos)?.id).toBe('b')
  })

  it('matches the other direction: a stored title carrying a role or suffix', () => {
    const withSuffix = [
      { id: 'a', title: 'Stability AI' },
      { id: 'b', title: 'Wirecard AG (Germany)' },
    ]
    expect(logoForEntity('Wirecard AG', withSuffix)?.id).toBe('b')
  })

  it('refuses a name merely contained in a longer title, in either direction', () => {
    expect(logoForEntity('AI', logos)).toBeNull()
    expect(logoForEntity('Wirecard', logos)).toBeNull()
    // "Stability AI Ltd" carries no separator after "Stability AI" (no comma,
    // bracket or dash, just a space before the suffix word), so it stays a
    // stranger, the same as "Emad Mostaque Junior" against "Emad Mostaque"
    // in the cast's own matcher tests: a bare space is never a boundary.
    expect(logoForEntity('Stability AI', [{ id: 'c', title: 'Stability AI Ltd' }])).toBeNull()
    expect(logoForEntity('AI', [{ id: 'a', title: 'Stability AI' }])).toBeNull()
    expect(logoForEntity('AI', [{ id: 'c', title: 'Stability AI Ltd' }])).toBeNull()
    expect(logoForEntity('AI', [{ id: 'b', title: 'Wirecard AG' }])).toBeNull()
  })

  it('returns null for an empty library', () => {
    expect(logoForEntity('Stability AI', [])).toBeNull()
  })
})
