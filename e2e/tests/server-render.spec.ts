import { expect, test } from '@playwright/test'
import { FRESH_PREVIEW_TITLE } from '../global-setup'
import { signIn } from './fixtures'

/**
 * Two guards on how the server bundles things (decision 295). The e2e server
 * is the dev server, so it bundles the Inngest route with the `react-server`
 * condition exactly as a deploy does.
 */

test.describe('server bundling (decision 295)', () => {
  test('the Inngest route loads, with the graphic dry run behind it', async ({ request }) => {
    // The dry run loads React, react-dom/server and Remotion at run time. A
    // static import of any of them throws when the route is first evaluated,
    // and this GET is where that shows.
    const response = await request.get('/api/inngest')
    expect(response.status()).toBe(200)
  })

  test('a fresh load of a film with no draft and no master renders its preview on the server', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/projects')
    await page
      .getByRole('listitem')
      .filter({ hasText: FRESH_PREVIEW_TITLE })
      .getByRole('link')
      .first()
      .click()
    // The first visit compiles the project page on the dev server.
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 60_000 })
    // With no cut rendered the stage defaults to the live preview, so the
    // Player is part of the server render of this load, not a tab pressed
    // after it.
    const response = await page.reload()
    expect(response?.status()).toBe(200)
    await expect(page.locator('.__remotion-player')).toBeVisible()
  })
})
