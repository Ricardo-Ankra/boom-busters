import { expect, test, type Page } from '@playwright/test'
import { DENSE_WARNINGS_TITLE } from '../global-setup'
import { expectHitTargets, openFixtureProject, signIn } from './fixtures'

/**
 * Spec section 11.4: all review screens are responsive to 390px, and
 * approving from a phone is a first-class flow. The shell passes below are
 * M1's; the dossier and Script Studio passes are the §13 requirement,
 * closed out in M8.6 — asserting the approval CONTROLS, not pressing them,
 * because the desktop suite owns the flows and this file must not mutate
 * the fixtures it shares.
 */

async function expectNoSidewaysScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `${label} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1)
}
test.describe('390px', () => {
  test('signing in works on a phone', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
  })

  test('the page never scrolls sideways', async ({ page }) => {
    await signIn(page)

    for (const path of ['/', '/settings', '/projects']) {
      await page.goto(path)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1)
    }
  })

  test('controls stay tappable at 390px', async ({ page }) => {
    await signIn(page)
    await page.goto('/settings')
    await expectHitTargets(page)
  })

  test('the settings tabs are reachable without a wide viewport', async ({ page }) => {
    await signIn(page)
    await page.goto('/settings')

    await page.getByRole('tab', { name: 'Connections' }).click()
    await expect(page.getByRole('tab', { name: 'Connections' })).toHaveAttribute(
      'data-state',
      'active',
    )
  })

  test('the dossier review is approvable from a phone', async ({ page }) => {
    await signIn(page)
    await openFixtureProject(page)

    // The two-pane screen stacks: document and claims both reachable.
    await expect(page.getByRole('heading', { name: /Claims/ })).toBeVisible()
    await expect(page.getByText(/unverified/).first()).toBeVisible()
    // The gate's own controls are on screen and tappable — approving from
    // here is the flow; pressing it belongs to the desktop suite.
    await expect(page.getByRole('button', { name: /Approve/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request changes' })).toBeVisible()

    await expectNoSidewaysScroll(page, 'dossier review')
    await expectHitTargets(page)
  })

  test('the Script Studio reads single-column from a phone', async ({ page }) => {
    await signIn(page)
    await page.goto('/projects')
    await expect(async () => {
      await page
        .getByRole('listitem')
        .filter({ hasText: DENSE_WARNINGS_TITLE })
        .getByRole('link')
        .first()
        .click()
      await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
    }).toPass({ timeout: 30_000 })

    // The three-column studio stacks to one: outline, editor text and the
    // warnings panel all reachable. No gate assertions here — the desktop
    // suite runs first and may have approved this fixture already; the
    // phone-approvability of a LIVE gate is the dossier test's job.
    await expect(page.getByRole('heading', { name: 'Outline' })).toBeVisible()
    await expect(page.getByText(/Sentence 1 of the chapter/).first()).toBeVisible()
    await expect(page.getByText(/warnings/i).first()).toBeVisible()

    await expectNoSidewaysScroll(page, 'script studio')
  })
})
