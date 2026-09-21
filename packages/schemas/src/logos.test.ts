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

  it('refuses a name merely contained in a longer title', () => {
    expect(logoForEntity('AI', logos)).toBeNull()
    expect(logoForEntity('Wirecard', logos)).toBeNull()
  })

  it('returns null for an empty library', () => {
    expect(logoForEntity('Stability AI', [])).toBeNull()
  })
})
