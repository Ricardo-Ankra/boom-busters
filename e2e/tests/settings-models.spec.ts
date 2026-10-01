import { expect, test } from '@playwright/test'
import { expectHitTargets, resetResearchModel, signIn } from './fixtures'

/**
 * Settings → Models with live lists (decision 287), in mock-provider mode:
 * Refresh fills the dropdowns from fixtures, a family model is labelled
 * estimated, and a model with no family is priced and routed in one save
 * that survives a reload. Puts the route back at the end, so the suite
 * stays order-independent; `resetResearchModel` covers the price override
 * the UI itself cannot clear (see its own comment).
 */

test.describe('Models tab, live lists', () => {
  test.beforeEach(async ({ page }) => {
    await resetResearchModel()
    await signIn(page)
    await page.goto('/settings?tab=models')
  })

  test('refreshes, prices an unpriced model and routes to it', async ({ page }) => {
    await page.getByRole('button', { name: 'Refresh model lists' }).click()
    await expect(page.getByText(/Anthropic: live list, refreshed/)).toBeVisible()

    const research = page.getByRole('combobox', { name: 'Research (dossiers) model' })
    await expect(
      research.getByRole('option', { name: 'Claude Opus Mock 9 (estimated)' }),
    ).toHaveCount(1)

    await research.selectOption('claude-mock-unpriced')
    await expect(
      page.getByText('Claude Mock Unpriced needs a price before it can run.'),
    ).toBeVisible()
    // Exact match: the price form also carries "Cached input, $ per million
    // tokens (optional)", whose label contains "input, $ per million tokens"
    // as a case-insensitive substring and would otherwise double-match.
    await page.getByLabel('Input, $ per million tokens', { exact: true }).fill('7')
    await page.getByLabel('Output, $ per million tokens', { exact: true }).fill('30')
    await page.getByRole('button', { name: 'Save price and use' }).click()
    // Exact: the toast's screen-reader live region reads "Notification Saved",
    // which otherwise double-matches alongside the visible "Saved" text.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Research (dossiers) model' })).toHaveValue(
      'claude-mock-unpriced',
    )
    await expect(page.getByText(/Your price: \$7 in, \$30 out per million tokens\./)).toBeVisible()
    await expectHitTargets(page)

    // Put the route back; resetResearchModel clears the price override on
    // the next run, which the UI itself cannot do once a route needs it.
    await page
      .getByRole('combobox', { name: 'Research (dossiers) model' })
      .selectOption('claude-opus-5')
    await expect(page.getByText('Saved').first()).toBeVisible()
  })
})
