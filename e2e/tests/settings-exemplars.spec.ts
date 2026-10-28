import { expect, test } from '@playwright/test'
import { channelPath, expectHitTargets, signIn } from './fixtures'

/**
 * The Exemplars tab (decision 305): every technique the designer is shown an
 * example of, each written example played in the board's own player with
 * the owner's Brand Kit. Read-only, so nothing here changes state.
 */

test.describe('Exemplars tab', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=exemplars'))
  })

  test('lists the eighteen written examples and plays one in portrait', async ({ page }) => {
    await expect(page.getByText('18 of 18 examples written')).toBeVisible()
    const stat = page.getByRole('region', { name: 'Stat counter' })
    await expect(stat.getByRole('link', { name: 'stat-counter' })).toHaveAttribute(
      'href',
      /github\.com\/reactvideoeditor\/remotion-templates\/blob\/6209b72/,
    )
    await stat.getByRole('button', { name: 'Play example' }).click()
    await expect(stat.locator('.__remotion-player').filter({ visible: true }).first()).toBeVisible()
    await stat.getByRole('button', { name: 'Portrait' }).click()
    await expect(stat.locator('.__remotion-player').filter({ visible: true }).first()).toBeVisible()
    await expectHitTargets(page)
  })
})
