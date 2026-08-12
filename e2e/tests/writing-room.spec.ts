import { expect, test } from '@playwright/test'
import { expectHitTargets, signIn, openFixtureProject } from './fixtures'

/**
 * The M3 writing room, driven the way a human drives it (build spec section
 * 13: "All flows driven through visible buttons only").
 *
 * Everything here runs in mock-provider mode, so `Suggest cases` and every
 * other model call returns deterministic placeholder text and costs nothing.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test.describe('Case Library', () => {
  test('suggests cases into a triage list, and accepting moves one to the backlog', async ({
    page,
  }) => {
    await page.goto('/cases')

    await page.getByRole('button', { name: 'Suggest cases' }).click()
    await page.getByLabel('How many').fill('3')
    await page.getByRole('button', { name: 'Get suggestions' }).click()

    // Mock mode says so on the toast, so a demo is never mistaken for research.
    await expect(page.getByText(/mock mode researched nothing/i).first()).toBeVisible()

    const suggested = page.getByRole('heading', { name: /Suggested — \d+ waiting on you/ })
    await expect(suggested).toBeVisible()

    // Every mock row says in its own title that it is not a real case.
    await expect(page.getByText(/not a real case/).first()).toBeVisible()

    await page.getByRole('button', { name: 'Accept' }).first().click()
    await expect(page.getByText('Accepted — it is in your backlog').first()).toBeVisible()
  })

  test('dismissing a suggestion removes that row', async ({ page }) => {
    await page.goto('/cases')
    await page.getByRole('button', { name: 'Suggest cases' }).click()
    await page.getByRole('button', { name: 'Get suggestions' }).click()

    // Asserted on the row itself rather than on a count. Suggestions are
    // deduplicated against the whole library, so how many are on screen
    // depends on what earlier tests left behind — the row disappearing is the
    // behaviour, the total is not.
    const row = page
      .getByRole('listitem')
      .filter({ hasText: /not a real case/ })
      .first()
    const title = (await row.locator('p').first().innerText()).trim()

    await row.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText('Dismissed').first()).toBeVisible()

    await expect(page.getByText(title, { exact: true })).toHaveCount(0)
  })

  test('a case can be added by hand and lands shortlisted', async ({ page }) => {
    await page.goto('/cases')

    await page.getByRole('button', { name: 'Add case' }).click()
    await page.getByLabel('Title').fill('A case I decided on myself')
    await page.getByLabel('Angle').fill('The angle nobody else took.')
    await page.getByRole('button', { name: 'Save case' }).click()

    await expect(page.getByText('Case added to your backlog').first()).toBeVisible()
    await expect(page.getByText('A case I decided on myself')).toBeVisible()
    await expect(page.getByText(/Shortlisted/).first()).toBeVisible()
  })

  test('the library sorts by every column offered', async ({ page }) => {
    await page.goto('/cases')

    for (const sort of ['Category', 'Status', 'Newest', 'Priority']) {
      await page.getByRole('button', { name: sort, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`sort=${sort.toLowerCase()}`))
    }
  })

  test('every control is reachable and large enough to hit', async ({ page }) => {
    await page.goto('/cases')
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

  test('requesting changes needs a note, and says so', async ({ page }) => {
    await openFixtureProject(page)

    await page.getByRole('button', { name: 'Request changes' }).click()
    await page.getByRole('button', { name: 'Send change request' }).click()

    await expect(page.getByText('Say what needs to change.').first()).toBeVisible()
  })
})
