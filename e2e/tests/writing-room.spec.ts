import { expect, test } from '@playwright/test'
import { channelPath, expectHitTargets, signIn, openFixtureProject } from './fixtures'

/**
 * The M3 writing room, driven the way a human drives it (build spec section
 * 13: "All flows driven through visible buttons only").
 *
 * Everything here runs in mock-provider mode, so every
 * model call returns deterministic placeholder text and costs nothing.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test.describe('Case Library', () => {
  test('a case can be added by hand and lands shortlisted', async ({ page }) => {
    await page.goto(channelPath('/cases'))

    await page.getByRole('button', { name: 'Add case' }).click()
    await page.getByLabel('Subject').fill('A case I decided on myself')
    await page.getByLabel('Title').fill('A case I decided on myself')
    await page.getByLabel('Angle').fill('The angle nobody else took.')
    await page.getByRole('button', { name: 'Save case' }).click()

    await expect(page.getByText('Case added to your backlog').first()).toBeVisible()
    // The new case is in the list; the panel beside it may open on it too.
    await expect(
      page.getByRole('link', { name: /A case I decided on myself/ }).first(),
    ).toBeVisible()
    await expect(page.getByText(/Shortlisted/).first()).toBeVisible()
  })

  test('the library sorts by every column offered', async ({ page }) => {
    await page.goto(channelPath('/cases'))

    for (const sort of ['Category', 'Status', 'Newest']) {
      await page.getByRole('button', { name: sort, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`sort=${sort.toLowerCase()}`))
    }
  })

  test('every control is reachable and large enough to hit', async ({ page }) => {
    await page.goto(channelPath('/cases'))
    await expectHitTargets(page)
  })
})

test.describe('the dossier gate', () => {
  test('the fixture project is parked at its gate with the action bar offered', async ({
    page,
  }) => {
    await openFixtureProject(page)

    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request changes' })).toBeVisible()
  })

  test('fixture claim 1 shows its quote found in the gathered document', async ({ page }) => {
    await openFixtureProject(page)

    await page
      .getByRole('button', { name: /Review claim: Feb 2019 . BaFin bans short selling/ })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Claim' })
    await expect(dialog.getByText('Found in the document')).toBeVisible()
  })

  test('requesting changes needs a note, and says so', async ({ page }) => {
    await openFixtureProject(page)

    await page.getByRole('button', { name: 'Request changes' }).click()
    await page.getByRole('button', { name: 'Send change request' }).click()

    await expect(page.getByText('Say what needs to change.').first()).toBeVisible()
  })
})
