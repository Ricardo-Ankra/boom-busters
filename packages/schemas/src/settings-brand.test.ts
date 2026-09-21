import { describe, expect, it } from 'vitest'
import {
  BrandKitStoredSchema,
  BrandKitTokensSchema,
  DEFAULT_SETTINGS,
  resolveBrandKit,
} from './settings'

describe('the brand snapshot and the channel mark (decision 268)', () => {
  it('carries a materialised logo URL in the resolved form only', () => {
    const resolved = resolveBrandKit(DEFAULT_SETTINGS)
    const withUrl = BrandKitTokensSchema.parse({
      ...resolved,
      look: {
        ...resolved.look,
        logoR2Key: 'boom-busters/logos/abc.png',
        logoUrl: 'https://r2/abc',
      },
    })
    expect(withUrl.look.logoUrl).toBe('https://r2/abc')

    // The stored settings row never holds a URL: presigned URLs expire.
    const stored = BrandKitStoredSchema.parse({
      ...DEFAULT_SETTINGS.brandKit,
      look: { ...DEFAULT_SETTINGS.brandKit.look, logoUrl: 'https://r2/abc' },
    })
    expect('logoUrl' in stored.look).toBe(false)
  })
})
