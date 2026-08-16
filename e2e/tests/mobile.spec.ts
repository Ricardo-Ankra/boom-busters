import { expect, test } from '@playwright/test'
import { expectHitTargets, signIn } from './fixtures'

/**
 * Spec section 11.4: all review screens are responsive to 390px, and
 * approving from a phone is a first-class flow. M1 has no review screens yet,
 * so this covers the shell those screens will sit in.
 */
test.describe('390px', () => {
  test('signing in works on a phone', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
  })

  test('the page never scrolls sideways', async ({ page }) => {
    await signIn(page)

    for (const path of ['/', '/settings', '/projects']) {
      await page.goto(path)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1)
    }
  })

  test('controls stay tappable at 390px', async ({ page }) => {
    await signIn(page)
    await page.goto('/settings')
    await expectHitTargets(page)
  })

  test('the settings tabs are reachable without a wide viewport', async ({ page }) => {
    await signIn(page)
    await page.goto('/settings')

    await page.getByRole('tab', { name: 'Connections' }).click()
    await expect(page.getByRole('tab', { name: 'Connections' })).toHaveAttribute(
      'data-state',
      'active',
    )
  })
})
