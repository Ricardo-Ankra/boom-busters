import { brokerSignature, BROKER_SIGNATURE_HEADER } from '@boom-busters/schemas'
import { expect, test } from '@playwright/test'

/**
 * The broker callback route must be reachable WITHOUT a browser session:
 * its callers are Lambdas, and the HMAC over the raw body is the
 * authentication. These requests deliberately go through the real proxy —
 * the route's unit tests call the handler directly, which is exactly how
 * "the proxy redirects every callback to /signin" shipped invisible
 * (found 2026-08-19: media-utils' completion POSTs followed the redirect,
 * got the sign-in page with a 200, and every transcribe wait timed out).
 */

// Matches playwright.config.ts's webServer env.
const E2E_BROKER_TOKEN = 'e2e-dummy-token'

test.describe('the broker callback route through the proxy', () => {
  test('an unsigned POST is refused by the route, not bounced to sign-in', async ({ request }) => {
    const response = await request.post('/api/hooks/broker', {
      data: '{}',
      headers: { 'content-type': 'application/json' },
      maxRedirects: 0,
    })
    // 401 is the route's own "bad signature". A 3xx here means the auth
    // proxy intercepted the callback and no Lambda can ever complete a job.
    expect(response.status()).toBe(401)
  })

  test('a signed POST reaches the route and is answered ok', async ({ request }) => {
    const body = '{}'
    const response = await request.post('/api/hooks/broker', {
      data: body,
      headers: {
        'content-type': 'application/json',
        [BROKER_SIGNATURE_HEADER]: brokerSignature(body, E2E_BROKER_TOKEN),
      },
      maxRedirects: 0,
    })
    // Signed-but-unreadable is deliberately a quiet 200 (version-skew rule);
    // what matters here is that the signature verified against the same
    // token the web server holds, proving the route saw the raw body.
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  })
})
