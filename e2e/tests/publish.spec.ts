import { expect, test, type Page } from '@playwright/test'
import { PUBLISH_PROJECT_TITLE } from '../global-setup'
import { expectHitTargets, signIn } from './fixtures'

/**
 * The publish flow — the fifth gate (build spec sections 11.3 and 13),
 * driven from the Shorts screen's handover through metadata, the composed
 * description, the thumbnail precondition and a Short's schedule click, all
 * through visible labelled buttons. YouTube is never contacted: the schedule
 * action writes the record FIRST and only then asks the orchestrator, so
 * what this suite asserts after the click is the row's truth on reload.
 *
 * Runs in order within this file (workers: 1): the first test moves the
 * seeded project from `shorts` to `publish`, exactly as a human would.
 */

async function openProject(page: Page): Promise<void> {
  await page.goto('/projects')
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: PUBLISH_PROJECT_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

// Dev-server reloads run 6-9 s each and several tests here reload inside a
// toPass loop; the default 30 s per-test budget is not enough headroom.
test.setTimeout(120_000)

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await openProject(page)
})

test.describe('the publish flow', () => {
  test('the Shorts screen curates, then hands over with its own button', async ({ page }) => {
    // The cards, with the seeded curation on show.
    await expect(page.getByText('The auditors said yes for eighteen years (E2E)')).toBeVisible()
    await expect(page.getByText('Where the cash never was (E2E)')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Related video link set in Studio' }),
    ).toBeVisible()

    // The handover — a button, not a gate. Wait for the action's own toast
    // before reloading: a reload mid-POST would abort the stage change.
    await page.getByRole('button', { name: 'Continue to Publish' }).click()
    await expect(page.getByText(/on to the publish screen/i).first()).toBeVisible()

    // The action's router.refresh can lose a race with the dev server's
    // recompile of the publish screen (same trap as the preview spec).
    await expect(async () => {
      await page.reload()
      await expect(page.getByText(/going public is a manual step/i)).toBeVisible({
        timeout: 5_000,
      })
    }).toPass({ timeout: 30_000 })
  })

  test('the Publish screen: checklist, budget, one item per publishable thing', async ({
    page,
  }) => {
    // The private-until-audit checklist, ending in the Studio step.
    await expect(page.getByText(/going public is a manual step/i)).toBeVisible()
    await expect(page.getByText(/flip it to public in YouTube Studio/i)).toBeVisible()

    // The budget line.
    await expect(page.getByText(/of 4 upload starts used/i)).toBeVisible()

    // The items: the master, the schedulable Short, and the one that is not.
    await expect(page.getByText('Full video', { exact: true })).toBeVisible()
    await expect(page.getByText('This Short has no finished render yet.')).toBeVisible()

    await expectHitTargets(page)
  })

  test('generated titles arrive as radios; picking one is saved explicitly', async ({ page }) => {
    // Mock mode: one click, no confirm, no spend. The toast says the action
    // finished; the radios then arrive with the refresh (or our reload).
    await page.getByRole('button', { name: /generate 8 title options \(mock\)/i }).click()
    await expect(page.getByText(/titles generated/i).first()).toBeVisible()

    const option = page.getByRole('radio', { name: /\[mock\].*the whole story/i })
    await expect(async () => {
      await page.reload()
      await expect(option).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })

    await option.check()
    await page.getByRole('button', { name: /save draft/i }).click()
    await expect(page.getByText(/draft saved/i).first()).toBeVisible()

    // Persisted, not optimistic theatre.
    await expect(async () => {
      await page.reload()
      await expect(page.getByText(/\[mock\].*the whole story/).first()).toBeVisible({
        timeout: 5_000,
      })
    }).toPass({ timeout: 30_000 })
  })

  test('the description preview composes hook, chapters, sources and disclaimer', async ({
    page,
  }) => {
    await expect(page.getByText(/description preview/i)).toBeVisible()
    const preview = page.locator('pre')
    await expect(preview).toContainText('Chapters:')
    await expect(preview).toContainText('0:00 The rise')
    await expect(preview).toContainText('Sources:')
    await expect(preview).toContainText('https://example.com/e2e-ft-report')
    await expect(preview).toContainText('not financial advice')
  })

  test('a master without a thumbnail is refused at the slot, in words', async ({ page }) => {
    // The master is the default selection; every offered slot is long-form.
    await page.getByRole('button', { name: 'Schedule here' }).first().click()
    await expect(page.getByText(/drop a thumbnail png first/i).first()).toBeVisible()
  })

  test('scheduling a Short writes the record first — the slot survives reload', async ({
    page,
  }) => {
    // Select the schedulable Short: the master is the default selection, so
    // the first "Edit metadata" button belongs to the first Short card.
    await page.getByRole('button', { name: 'Edit metadata' }).first().click()
    await expect(
      page.getByText('Short: The auditors said yes for eighteen years (E2E)'),
    ).toBeVisible()

    // Its slots are the Short ones; the long-form cells say why they refuse.
    await expect(page.getByText('Wrong format for this slot').first()).toBeVisible()
    await page.getByRole('button', { name: 'Schedule here' }).first().click()

    // Wait for the action to answer — a reload mid-POST aborts it. Either
    // toast is fine: the row is written BEFORE the orchestrator is asked,
    // so "could not reach Inngest" still means the slot was saved.
    await expect(page.getByText(/the upload starts now|that did not work/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // The record-first proof: after a reload the card carries its moment.
    await expect(async () => {
      await page.reload()
      await expect(page.getByText(/goes public/i).first()).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
  })
})
