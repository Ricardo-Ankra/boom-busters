import { expect, test, type Page } from '@playwright/test'
import { VISUAL_PLAN_TITLE } from '../global-setup'
import { signIn } from './fixtures'

/**
 * The PLAN checkpoint (staged-visuals design, closed out in M8.7): the
 * seeded project has its shot list written and nothing fetched. What e2e can
 * honestly prove without live Inngest: the plan bar with its priced button,
 * plan-phase wording (save-only edits, `planned` chips, no generic
 * Approve), and a mechanical re-type landing on the click that asked —
 * that write happens in the server action since the M8 picker fix.
 */

async function openPlan(page: Page): Promise<void> {
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
  await openPlan(page)
})

test.describe('the shot plan checkpoint', () => {
  test('one priced Fetch button, planned chips, and no generic Approve', async ({ page }) => {
    // The still is the only paid slot. The exact price depends on which
    // image key the environment seeded (fal $0.06, Gemini $0.08) — the
    // contract is that the button carries A price, not which generator won.
    await expect(
      page.getByRole('button', { name: /Fetch visuals · 2 slots · est\. \$0\.0[68]/ }),
    ).toBeVisible()
    await expect(page.getByText('planned').first()).toBeVisible()
    // The plan bar owns approval; the generic gate bar would speak an event
    // the parked runner is not listening for.
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(page.getByText(/Nothing has been fetched or generated yet/)).toBeVisible()
  })

  test('plan-phase edits say Save, never re-fetch', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit brief', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Save & re-fetch/ })).toHaveCount(0)

    const description = page.getByLabel('Visual description').first()
    await description.fill('A boardroom nobody sits in any more, dust on the table.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Brief saved', { exact: true })).toBeVisible()
  })

  test('re-typing still → stock lands on the click that asked', async ({ page }) => {
    const card = page.locator('[id^="slot-"]').filter({ hasText: 'boardroom' })
    const picker = card.getByRole('group', { name: 'Slot format' })
    // The current type's button is pressed and disabled — that is the badge
    // the accessibility tree can actually read (the visual badge uppercases
    // via CSS, which selectors must not depend on).
    await expect(picker.getByRole('button', { name: 'still' })).toBeDisabled()

    await picker.getByRole('button', { name: 'stock' }).click()

    // Synchronous since the M8 picker fix: the type changes on the button's
    // own refresh. Retried, because the dev server can race the commit.
    await expect(async () => {
      await expect(picker.getByRole('button', { name: 'stock' })).toBeDisabled({ timeout: 5_000 })
    }).toPass({ timeout: 20_000 })
    await expect(picker.getByRole('button', { name: 'still' })).toBeEnabled()

    // Put it back, so a re-run of this file starts from the seeded state.
    await picker.getByRole('button', { name: 'still' }).click()
    await expect(async () => {
      await expect(picker.getByRole('button', { name: 'still' })).toBeDisabled({ timeout: 5_000 })
    }).toPass({ timeout: 20_000 })
  })
})
