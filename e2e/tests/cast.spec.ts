import { expect, test, type Page } from '@playwright/test'
import { VISUAL_PLAN_TITLE } from '../global-setup'
import { signIn } from './fixtures'

/**
 * The Cast card (decision 253) on a project past the dossier: a person is
 * added, their identity string edited and saved, and the card survives a
 * reload. Both photo routes need R2, which mock storage does not have, so
 * uploading and fetching by address are covered by the action and component
 * suites; here their controls are present and the guidance is on screen.
 */

const NAME = `Emad Mostaque ${Date.now()}`

async function openProject(page: Page): Promise<void> {
  await page.goto('/projects')
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: VISUAL_PLAN_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await openProject(page)
})

test.describe('the cast', () => {
  test('adds a person, saves an identity string by hand, and keeps it across a reload', async ({
    page,
  }) => {
    const card = page.getByLabel('Cast', { exact: true })
    await expect(card.getByText(/The real people this film shows\./)).toBeVisible()

    // An empty cast, or one with someone still unphotographed, opens straight
    // onto the rows and the add form; a fully photographed one needs Edit cast.
    const edit = card.getByRole('button', { name: 'Edit cast' })
    if (await edit.isVisible().catch(() => false)) await edit.click()

    await card.getByLabel('Full name').fill(NAME)
    await card.getByLabel('Role').fill('Founder and former CEO, Stability AI')
    await card.getByRole('button', { name: 'Add person' }).click()

    const row = card.getByRole('region', { name: NAME })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByRole('button', { name: 'Add photo' })).toBeVisible()
    await expect(row.getByLabel('Or paste an image address')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Add from address' })).toBeVisible()
    await expect(row.getByText(/One clear front view is enough/)).toBeVisible()

    await row.getByLabel('Identity string').fill('oval face, short dark hair, close-cropped beard')
    await row.getByRole('button', { name: 'Save' }).click()
    // `.first()`: the toast body and its aria-live announcer both say it, and
    // under a full-suite load the assertion lands while both are mounted.
    await expect(page.getByText(`${NAME} saved`).first()).toBeVisible({ timeout: 15_000 })

    await page.reload()
    const again = page.getByLabel('Cast', { exact: true })
    const reopen = again.getByRole('button', { name: 'Edit cast' })
    if (await reopen.isVisible().catch(() => false)) await reopen.click()
    await expect(
      again.getByRole('region', { name: NAME }).getByLabel('Identity string'),
    ).toHaveValue('oval face, short dark hair, close-cropped beard')

    // Leave the seeded project as it was found.
    const remove = again.getByRole('region', { name: NAME })
    await remove.getByRole('button', { name: 'Remove person' }).click()
    await remove.getByRole('button', { name: `Remove ${NAME}` }).click()
    await expect(again.getByRole('region', { name: NAME })).toHaveCount(0, { timeout: 15_000 })
  })
})
