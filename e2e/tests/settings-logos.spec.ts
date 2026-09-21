import { expect, test } from '@playwright/test'
import { expectHitTargets, signIn } from './fixtures'

/**
 * The Logos tab (decision 268) in mock storage: the seeded marks list, the
 * channel mark can be chosen and cleared, a rename survives a reload. Upload
 * and fetch-by-address need R2, which mock storage does not have, so they are
 * covered by the action and component tests; here the buttons exist and the
 * refusal is in words.
 */

test.describe('Logos tab', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/settings?tab=logos')
  })

  test('lists the seeded marks and lets the owner choose the channel mark', async ({ page }) => {
    const library = page.getByRole('list', { name: 'Logo library' })
    await expect(library.getByRole('listitem')).toHaveCount(2)
    await expect(library.getByText('No preview in mock storage').first()).toBeVisible()

    await page.getByRole('button', { name: 'Use Stability AI (E2E) as channel mark' }).click()
    await expect(page.getByText('Channel mark', { exact: true })).toBeVisible()
    await page.reload()
    await expect(
      page
        .getByRole('listitem', { name: 'Stability AI (E2E)' })
        .getByText('Channel mark', { exact: true }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Use no mark' }).click()
    await expect(page.getByText('Channel mark', { exact: true })).toHaveCount(0)
    await expectHitTargets(page)
  })

  test('renames a mark and keeps the name across a reload', async ({ page }) => {
    const row = page.getByRole('listitem', { name: 'Wirecard AG (E2E)' })
    const name = row.getByLabel('Rename Wirecard AG (E2E)')
    await name.fill('Wirecard (E2E)')
    await row.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('listitem', { name: 'Wirecard (E2E)' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('listitem', { name: 'Wirecard (E2E)' })).toBeVisible()
    // Put it back so the suite is order-independent.
    const renamed = page.getByRole('listitem', { name: 'Wirecard (E2E)' })
    await renamed.getByLabel('Rename Wirecard (E2E)').fill('Wirecard AG (E2E)')
    await renamed.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('listitem', { name: 'Wirecard AG (E2E)' })).toBeVisible()
  })

  test('offers upload and address, and says why they need storage', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Choose logo file' })).toBeVisible()
    await page.getByLabel('Name', { exact: true }).fill('Nobody Inc')
    await page.getByLabel('Or paste an image address').fill('https://example.com/mark.png')
    await page.getByRole('button', { name: 'Add from address' }).click()
    await expect(page.getByText(/R2 configured/).first()).toBeVisible()
  })
})
