import { expect, test } from '@playwright/test'
import { channelPath, expectHitTargets, resetResearchModel, signIn } from './fixtures'

/**
 * Model routing on the channel and model prices on the workspace (decision
 * 288, prices moved to the workspace): Refresh fills the dropdowns from
 * fixtures, a family model is labelled estimated, and a model with no family
 * is priced on the workspace Prices tab, then routed on the channel, with
 * both surviving a reload. Puts the route back at the end, so the suite
 * stays order-independent; `resetResearchModel` covers the price override
 * the UI itself cannot clear (see its own comment).
 */

test.describe('Models tab, live lists', () => {
  test.beforeEach(async ({ page }) => {
    await resetResearchModel()
    await signIn(page)
    await page.goto(channelPath('/settings?tab=models'))
  })

  test('refreshes, prices an unpriced model on the workspace and routes to it', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Refresh model lists' }).click()
    await expect(page.getByText(/Anthropic: live list, refreshed/)).toBeVisible()

    const research = page.getByRole('combobox', { name: 'Research (dossiers) model' })
    await expect(
      research.getByRole('option', { name: 'Claude Opus Mock 9 (estimated)' }),
    ).toHaveCount(1)

    // Prices are the workspace's: a model with none cannot be routed to yet.
    await expect(
      research.getByRole('option', { name: 'Claude Mock Unpriced (needs a price)' }),
    ).toBeDisabled()

    await page.goto('/settings?tab=prices')
    await expect(page.getByRole('tab', { name: 'Prices' })).toHaveAttribute('data-state', 'active')
    await page.getByRole('button', { name: 'Set price for Claude Mock Unpriced' }).click()
    // Exact match: the price form also carries "Cached input, $ per million
    // tokens (optional)", whose label contains "input, $ per million tokens"
    // as a case-insensitive substring and would otherwise double-match.
    await page.getByLabel('Input, $ per million tokens', { exact: true }).fill('7')
    await page.getByLabel('Output, $ per million tokens', { exact: true }).fill('30')
    await page.getByRole('button', { name: 'Save price' }).click()
    // Exact: the toast's screen-reader live region reads "Notification Saved",
    // which otherwise double-matches alongside the visible "Saved" text.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await expectHitTargets(page)

    await page.reload()
    await expect(page.getByText(/Your price: \$7 in, \$30 out per million tokens/)).toBeVisible()

    await page.goto(channelPath('/settings?tab=models'))
    await page
      .getByRole('combobox', { name: 'Research (dossiers) model' })
      .selectOption('claude-mock-unpriced')
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

test.describe('workspace settings', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('offers provider keys, prices and the music library, and no YouTube card', async ({
    page,
  }) => {
    await page.goto('/settings')
    for (const name of ['Connections', 'Prices', 'Music library']) {
      await expect(page.getByRole('tab', { name })).toBeVisible()
    }
    await expect(page.getByLabel('anthropic API key')).toBeVisible()
    await expect(page.getByText('Connect YouTube')).toBeHidden()

    await page.getByRole('tab', { name: 'Music library' }).click()
    await expect(page.getByRole('tab', { name: 'Music library' })).toHaveAttribute(
      'data-state',
      'active',
    )
    await expectHitTargets(page)
  })
})
