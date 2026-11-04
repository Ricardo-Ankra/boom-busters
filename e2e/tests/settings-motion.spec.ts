import { expect, test } from '@playwright/test'
import { channelPath, signIn } from './fixtures'

/**
 * The Motion tab (spec 2026-11-04, plan 1): the channel's motion identity is
 * saved through the settings patch and read back on the next load. The field
 * is put back to the house value at the end, so the run leaves the first
 * channel as it found it.
 */
const FIRST_SLUG = 'boom-busters'

test.describe('Motion tab', () => {
  test('a saved overshoot holds across a reload, and goes back', async ({ page }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    const overshoot = page.locator('#motion-overshoot')
    await expect(overshoot).toHaveValue('hair')

    await overshoot.selectOption('none')
    await expect(page.getByText('Saved').first()).toBeVisible()
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await expect(page.locator('#motion-overshoot')).toHaveValue('none')
    // The two last resorts cannot be unticked.
    await expect(page.locator('#motion-technique-kinetic-word-stack')).toBeDisabled()
    await expect(page.locator('#motion-technique-kinetic-word-stack')).toBeChecked()

    await page.locator('#motion-overshoot').selectOption('hair')
    await expect(page.getByText('Saved').first()).toBeVisible()
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await expect(page.locator('#motion-overshoot')).toHaveValue('hair')
  })
})
