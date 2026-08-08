import { expect, test } from '@playwright/test'
import { signIn } from './fixtures'

test.describe('authentication', () => {
  test('an unauthenticated visitor is redirected to sign in', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/signin/)
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  })

  test('every console route is protected, not just the dashboard', async ({ page }) => {
    for (const path of ['/projects', '/cases', '/calendar', '/costs', '/settings']) {
      await page.goto(path)
      await expect(page, `${path} should be protected`).toHaveURL(/\/signin/)
    }
  })

  test('the intended destination survives the sign-in round trip', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/callbackUrl=%2Fsettings/)

    await page.getByRole('button', { name: 'Sign in as owner (mock mode)' }).click()
    await expect(page).toHaveURL(/\/settings/)
  })

  test('signing in reaches the console, and signing out returns to sign in', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/signin/)

    // The session is really gone, not just the page.
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/signin/)
  })

  test('a signed-in visitor is bounced off the sign-in page', async ({ page }) => {
    await signIn(page)
    await page.goto('/signin')
    await expect(page).toHaveURL(/^[^?]*\/$/)
  })
})
