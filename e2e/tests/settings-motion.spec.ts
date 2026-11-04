import { expect, test } from '@playwright/test'
import { channelPath, signIn } from './fixtures'

/**
 * The Motion tab (spec 2026-11-04, plans 1 and 2): the channel's motion
 * identity is saved through the settings patch and read back on the next
 * load; the references section explains what storage it needs and shows the
 * guideline; "Draft motion identity" runs on the mock draft and applies as
 * one patch. Every field is put back to the house value at the end, so the
 * run leaves the first channel as it found it.
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

  test('the references section explains storage and opens the full guideline', async ({ page }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await expect(page.getByText(/^Four to eight references/).first()).toBeVisible()
    // The e2e run has no R2, so uploads say why.
    await expect(page.getByRole('button', { name: 'Add reference' })).toBeDisabled()
    await expect(page.getByText(/R2 configured/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Read the full guideline' }).click()
    const dialog = page.getByRole('dialog', { name: 'The reference guideline' })
    await expect(dialog.getByText('What makes a good reference')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
  })

  test('drafts the identity from the brief alone, applies it, and puts it back', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await page.locator('#motion-brief').fill('slow and dark, one change every six seconds')
    await page.getByRole('button', { name: 'Draft motion identity' }).click()
    // The mock draft folds the brief into the style guide; the diff shows that row.
    await expect(page.getByRole('row', { name: /Style guide/ })).toBeVisible()
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText('Saved').first()).toBeVisible()
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await expect(page.locator('#motion-guide')).toHaveValue(/^\[mock\] slow and dark/)

    // Cleared by keyboard: a fill('') on the controlled textarea left one character behind.
    const guide = page.locator('#motion-guide')
    await guide.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await expect(guide).toHaveValue('')
    await guide.blur()
    await expect(page.getByText('Saved').first()).toBeVisible()
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await expect(page.locator('#motion-guide')).toHaveValue('')
  })
})
