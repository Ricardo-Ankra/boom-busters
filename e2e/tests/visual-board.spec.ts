import { expect, test, type Page } from '@playwright/test'
import { VISUAL_BOARD_TITLE } from '../global-setup'
import { expectHitTargets, signIn } from './fixtures'

/**
 * The visual board (build spec section 11.3), driven against the seeded
 * project parked at the visuals gate: 4 slots — a stock slot with a chosen
 * candidate, a claim-sourced chart, a map, and one placeholder.
 *
 * Everything here runs without Inngest: candidate selection is a plain
 * server action, and the gate wording is rendered state. Re-fetch and
 * approve hand events to Inngest and are exercised by the unit suites.
 */

async function openBoard(page: Page): Promise<void> {
  await page.goto('/projects')
  // Click-and-verify, retried — the same pattern and the same timeouts as
  // `openProject` in project-lifecycle, for the same dev-server reason.
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: VISUAL_BOARD_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await openBoard(page)
})

test.describe('the visual board', () => {
  test('shows the filmstrip, the chapter, and the covered sentence', async ({ page }) => {
    await expect(page.getByRole('list', { name: 'Filmstrip' })).toBeVisible()
    await expect(page.getByText(/Chapter 1 — The collapse on screen/)).toBeVisible()
    await expect(
      page.getByText(/“The auditors signed the accounts for eighteen straight years.”/),
    ).toBeVisible()
  })

  test('marks the chosen candidate and carries its licence line', async ({ page }) => {
    await expect(page.getByText('Selected')).toBeVisible()
    await expect(page.getByText(/Pexels License · Photo by Somebody/)).toBeVisible()
  })

  test('swapping a candidate is one click and survives a reload', async ({ page }) => {
    const strip = page.getByRole('list', { name: 'Candidates' })
    await strip.getByRole('listitem').nth(1).click()
    await expect(page.getByText('Selected', { exact: true })).toBeVisible()

    // The swap was persisted, not optimistic theatre: the second candidate's
    // licence line is now the audit line. Reload-until, because an immediate
    // reload can race the action's commit on the dev server (the same
    // bargain publish.spec and preview-render.spec already make).
    await expect(async () => {
      await page.reload()
      await expect(page.getByText(/Pixabay Content License/)).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
  })

  test('renders the chart from real data with its source-claim chip', async ({ page }) => {
    await expect(page.getByRole('img', { name: /line chart/ })).toBeVisible()
    await expect(page.getByText('From 104 to 1.28 in nine days.')).toBeVisible()
    await expect(page.getByText('claim 1')).toBeVisible()
  })

  test('renders the map with its locations', async ({ page }) => {
    await expect(page.getByRole('img', { name: /Map: Munich, Manila/ })).toBeVisible()
  })

  test('the placeholder slot demands the explicit approval wording', async ({ page }) => {
    await expect(page.getByText(/Nothing usable was found for this slot/)).toBeVisible()

    // The gate button itself carries the count — there is no plain Approve.
    await expect(page.getByRole('button', { name: 'Approve with 1 placeholder' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  })

  test('offers the repairs as labelled buttons on the card', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Edit brief & re-fetch' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Regenerate/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload own' }).first()).toBeVisible()
  })

  test('the brief editor opens inline with the current direction, and cancels', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Edit brief & re-fetch' }).first().click()
    await expect(page.getByLabel('Search query')).toHaveValue('empty office dusk')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByLabel('Search query')).toHaveCount(0)
  })

  test('Preview enlarges the chosen candidate with its facts, and closes', async ({ page }) => {
    await page.getByRole('button', { name: 'Preview' }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('img')).toBeVisible()
    await expect(dialog.getByText(/candidate 1 of 2/)).toBeVisible()
    // Which candidate is chosen depends on the swap test that ran before
    // this one, so assert the audit line's presence, not its provider.
    await expect(dialog.getByText(/License/)).toBeVisible()
    // The current choice cannot be re-chosen; the whole point of the button
    // is judging it at size.
    await expect(dialog.getByRole('button', { name: 'Selected for this slot' })).toBeDisabled()

    // The lightbox's controls only exist while it is open, so the page-wide
    // sweep below never sees them — sweep here.
    await expectHitTargets(page)

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('every control clears the 40px hit target', async ({ page }) => {
    await expectHitTargets(page)
  })
})
