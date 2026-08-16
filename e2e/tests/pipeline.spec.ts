import { expect, test } from '@playwright/test'
import { expectHitTargets, FIXTURE_PROJECT_TITLE, openFixtureProject, signIn } from './fixtures'

/**
 * The M2 screens (build spec section 14.2): the projects list, the project
 * view with its rail and gate action bar, and the Costs screen.
 *
 * These drive the UI and the database. The Inngest behaviours themselves —
 * park, resume, cancel, budget gate — are covered by the `@inngest/test`
 * harness in `apps/web/inngest`, which can drive a durable function directly.
 * Reproducing that here would mean running the Inngest Dev Server inside CI to
 * assert things a unit-level harness already asserts deterministically.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test.describe('projects', () => {
  test('lists the fixture project with its stage and a contextual button', async ({ page }) => {
    await page.goto('/projects')

    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    // Global setup parks the fixture project at the dossier gate.
    await expect(page.getByText(/awaiting review/i).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Review' }).first()).toBeVisible()
  })

  test('the mini rail names each stage and its state for a screen reader', async ({ page }) => {
    await page.goto('/projects')

    /**
     * Scoped by title, not by position and not by "has a Review link".
     *
     * `.first()` broke at M3.4 when the suite gained projects in other states;
     * "the row with a Review link" broke again at M4 when it gained two more
     * projects parked at the voice gate. The fixture is identified by what it
     * is, which is the only property that does not move when a milestone adds
     * a state.
     */
    const row = page.getByRole('listitem').filter({ hasText: FIXTURE_PROJECT_TITLE })
    const rail = row.getByRole('list', { name: 'Pipeline stages' })

    await expect(rail.getByText(/^Dossier — awaiting review$/)).toBeAttached()
    await expect(rail.getByText(/^Publish — not started$/)).toBeAttached()
  })

  test('opening a project shows the full rail and the stage it is on', async ({ page }) => {
    await openFixtureProject(page)

    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/)
    await expect(page.getByRole('list', { name: 'Pipeline stages' })).toBeVisible()
    // The fixture is parked at the dossier gate, so the dossier review screen
    // is what the stage renders (M3). Before M3 this was a placeholder card.
    await expect(page.getByRole('heading', { name: 'Dossier' })).toBeVisible()
  })
})

test.describe('gate action bar', () => {
  test.beforeEach(async ({ page }) => {
    await openFixtureProject(page)
  })

  test('offers both gate actions as visible labelled buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request changes' })).toBeVisible()
  })

  test('Approve is blocked while a claim is unsourced, and says why', async ({ page }) => {
    // The fixture carries one unverified claim precisely so this path is
    // exercised: an unsourced assertion must not reach a script.
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled()
    await expect(
      page.getByText(/unsourced claim\(s\) — verify or quarantine each one/),
    ).toBeVisible()
  })

  test('quarantining the unsourced claim unblocks Approve', async ({ page }) => {
    await page.getByRole('button', { name: 'Quarantine' }).first().click()
    await expect(page.getByText('Quarantined — excluded from scripting').first()).toBeVisible()

    // The text above is the action's toast; Approve only enables once the
    // server re-render lands, which on a cold dev-server compile can take
    // longer than the default expect timeout.
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled({ timeout: 15_000 })
  })

  test('a change request asks what to change before it can be sent', async ({ page }) => {
    await page.getByRole('button', { name: 'Request changes' }).click()

    await expect(page.getByLabel('What needs to change?')).toBeVisible()
    await page.getByRole('button', { name: 'Send change request' }).click()

    // Empty note is refused by the action, not silently accepted.
    await expect(page.getByText('Say what needs to change.').first()).toBeVisible()
  })

  test('Stop states its consequence before it will act', async ({ page }) => {
    await page.getByRole('button', { name: 'Stop' }).click()

    await expect(
      page.getByText(/The run stops where it is\. Work already done is kept/),
    ).toBeVisible()
    // And it can be backed out of without doing anything.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  })

  test('every visible control meets the 40px hit target', async ({ page }) => {
    await expectHitTargets(page)
  })
})

/**
 * The Costs screen after the 2026-08-13 audit: accurate tracking plus one
 * monthly ceiling. The per-provider budget matrix and the kill switch these
 * tests used to drive were removed by decision — zero on the ceiling is the
 * kill switch now — and the specs describing them outlived the screen.
 */
test.describe('costs', () => {
  test('shows the month total against the one ceiling', async ({ page }) => {
    await page.goto('/costs')

    await expect(page.getByRole('heading', { name: 'Costs' })).toBeVisible()
    await expect(page.getByRole('meter', { name: 'Month spend against the ceiling' })).toBeVisible()
    // One number for everything, and zero is the kill switch — said in place.
    await expect(page.getByText(/zero parks every run/)).toBeVisible()
  })

  test('a ceiling edit persists across a reload', async ({ page }) => {
    await page.goto('/costs')

    const field = page.getByLabel('Monthly ceiling, US dollars')
    await field.fill('120')
    await page.getByRole('button', { name: 'Save' }).click()
    // `.first()`: the toast renders its text twice — once visibly, once in the
    // screen-reader live region.
    await expect(page.getByText('Ceiling set to $120.00/month').first()).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Monthly ceiling, US dollars')).toHaveValue('120')

    // Leave the fixture database as we found it.
    await page.getByLabel('Monthly ceiling, US dollars').fill('100')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Ceiling set to $100.00/month').first()).toBeVisible()
  })

  test('Save is disabled until the number actually changes', async ({ page }) => {
    await page.goto('/costs')

    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  })

  test('the ledger filters by provider through visible buttons', async ({ page }) => {
    await page.goto('/costs')

    await page.getByRole('link', { name: 'elevenlabs', exact: true }).click()
    await expect(page).toHaveURL(/provider=elevenlabs/)
    await expect(page.getByText('No ledger entries for elevenlabs yet.')).toBeVisible()

    await page.getByRole('link', { name: 'All providers' }).click()
    await expect(page).toHaveURL(/\/costs$/)
  })

  test('every visible control meets the 40px hit target', async ({ page }) => {
    await page.goto('/costs')
    await expectHitTargets(page)
  })
})

test.describe('activity drawer', () => {
  test('opens from the top bar and can be refreshed and closed', async ({ page }) => {
    await page.goto('/projects')

    await page.getByRole('button', { name: 'Activity' }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer.getByRole('heading', { name: 'Activity' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Refresh' })).toBeVisible()

    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  })
})
