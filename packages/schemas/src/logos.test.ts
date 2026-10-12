import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  LOGO_ACCEPT,
  LOGO_MAX_BYTES,
  LogoStoredMimeSchema,
  logoExtension,
  codeLogoLibrary,
  logoForEntity,
  type LogoIndex,
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
  const logos: LogoIndex[] = [
    { id: 'a', title: 'Stability AI', width: 1200, height: 400 },
    { id: 'b', title: 'Wirecard AG', width: null, height: null },
  ]

  it('matches the exact name, whatever the case and spacing', () => {
    expect(logoForEntity('stability  ai', logos)?.id).toBe('a')
  })

  it('matches a name the planner wrote with a role after it', () => {
    expect(logoForEntity('Wirecard AG, the payments processor', logos)?.id).toBe('b')
  })

  it('matches the other direction: a stored title carrying a role or suffix', () => {
    const withSuffix = [
      { id: 'a', title: 'Stability AI', width: null, height: null },
      { id: 'b', title: 'Wirecard AG (Germany)', width: null, height: null },
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
    expect(
      logoForEntity('Stability AI', [
        { id: 'c', title: 'Stability AI Ltd', width: null, height: null },
      ]),
    ).toBeNull()
    expect(
      logoForEntity('AI', [{ id: 'a', title: 'Stability AI', width: null, height: null }]),
    ).toBeNull()
    expect(
      logoForEntity('AI', [{ id: 'c', title: 'Stability AI Ltd', width: null, height: null }]),
    ).toBeNull()
    expect(
      logoForEntity('AI', [{ id: 'b', title: 'Wirecard AG', width: null, height: null }]),
    ).toBeNull()
  })

  it('returns null for an empty library', () => {
    expect(logoForEntity('Stability AI', [])).toBeNull()
  })

  it('hands back the mark whole, its recorded size or null included (ruling 25)', () => {
    expectTypeOf<LogoIndex['width']>().toEqualTypeOf<number | null>()
    expectTypeOf<LogoIndex['height']>().toEqualTypeOf<number | null>()
    expect(logoForEntity('Stability AI', logos)).toEqual({
      id: 'a',
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })
    expect(logoForEntity('Wirecard AG', logos)).toMatchObject({ width: null, height: null })
  })
})

describe('codeLogoLibrary (decision 295)', () => {
  const rows = [
    { id: 'A0', title: 'Initech', width: null, height: 50 },
    { id: 'A1', title: 'Acme', width: 400, height: 200 },
    { id: 'A2', title: null, width: 100, height: 100 },
    { id: 'A3', title: '   ', width: 100, height: 100 },
    { id: 'A4', title: 'Initech', width: 300, height: 100 },
    { id: 'A5', title: 'Acme', width: 800, height: 800 },
    { id: 'A6', title: 'Globex', width: 0, height: 10 },
  ]

  it('keys sized, titled marks by title and leaves the rest out', () => {
    const library = codeLogoLibrary(rows)
    expect([...library.keys()]).toEqual(['Acme', 'Initech'])
    expect(library.get('Acme')).toEqual({ id: 'A1', title: 'Acme', width: 400, height: 200 })
  })

  it('lets a sized mark win over a sizeless one under the same title', () => {
    expect(codeLogoLibrary(rows).get('Initech')?.id).toBe('A4')
  })

  it('keeps the first of duplicate titles', () => {
    expect(codeLogoLibrary(rows).get('Acme')?.id).toBe('A1')
  })

  it('hands back the whole row, so a caller keeps its own fields', () => {
    const library = codeLogoLibrary([{ id: 'x', title: 'Acme', width: 1, height: 2, r2Key: 'k' }])
    expect(library.get('Acme')?.r2Key).toBe('k')
  })
})
