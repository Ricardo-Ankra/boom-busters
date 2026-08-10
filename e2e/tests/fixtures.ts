import { expect, type Page } from '@playwright/test'

/**
 * Signs in through the visible mock button rather than by forging a cookie.
 * Spec section 13 requires E2E flows to be driven through visible buttons
 * only, and going through the real form also exercises the CSRF round trip.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/signin')
  await page.getByRole('button', { name: 'Sign in as owner (mock mode)' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'))
}

/**
 * Asserts that every interactive control on screen clears the 40px minimum
 * hit target from spec section 11.1.
 */
export async function expectHitTargets(page: Page): Promise<void> {
  const controls = page.locator('button:visible, a[href]:visible, select:visible')
  const count = await controls.count()
  expect(count).toBeGreaterThan(0)

  for (let index = 0; index < count; index++) {
    const control = controls.nth(index)
    const box = await control.boundingBox()
    if (!box) continue
    const name = (await control.textContent())?.trim() || (await control.getAttribute('aria-label'))
    expect(box.height, `"${name}" is ${box.height}px tall`).toBeGreaterThanOrEqual(40)
  }
}
