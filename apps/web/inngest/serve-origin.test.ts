import { describe, expect, it } from 'vitest'
import { resolveServeOrigin } from './serve-origin'

describe('resolveServeOrigin', () => {
  it('uses the explicit override above everything else', () => {
    expect(
      resolveServeOrigin({
        INNGEST_SERVE_ORIGIN: 'https://console.example.com',
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'ignored.vercel.app',
      }),
    ).toBe('https://console.example.com')
  })

  it("derives the production alias from Vercel's own variable", () => {
    expect(
      resolveServeOrigin({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'boom-busters-web-rho.vercel.app',
      }),
    ).toBe('https://boom-busters-web-rho.vercel.app')
  })

  it('does not double the scheme if Vercel ever includes one', () => {
    expect(
      resolveServeOrigin({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'https://boom-busters-web-rho.vercel.app',
      }),
    ).toBe('https://boom-busters-web-rho.vercel.app')
  })

  it('never claims the production domain from a preview deployment', () => {
    // A preview advertising the production URL would register its branch's
    // functions against production — worse than an unreachable preview.
    expect(
      resolveServeOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_PROJECT_PRODUCTION_URL: 'boom-busters-web-rho.vercel.app',
      }),
    ).toBeUndefined()
  })

  it('falls back to the SDK inferring its own URL off Vercel', () => {
    expect(resolveServeOrigin({})).toBeUndefined()
    expect(resolveServeOrigin({ INNGEST_SERVE_ORIGIN: '   ' })).toBeUndefined()
  })
})
