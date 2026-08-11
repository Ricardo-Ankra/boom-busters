import { expect, test } from '@playwright/test'
import { expectHitTargets, signIn } from './fixtures'

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

    const rail = page.getByRole('list', { name: 'Pipeline stages' }).first()
    await expect(rail.getByText(/^Dossier — awaiting review$/)).toBeAttached()
    await expect(rail.getByText(/^Publish — not started$/)).toBeAttached()
  })

  test('opening a project shows the full rail and the stage it is on', async ({ page }) => {
    await page.goto('/projects')
    await page.getByRole('link', { name: 'Review' }).first().click()

    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/)
    await expect(page.getByRole('list', { name: 'Pipeline stages' })).toBeVisible()
    // The fixture is parked at the dossier gate, so the dossier review screen
    // is what the stage renders (M3). Before M3 this was a placeholder card.
    await expect(page.getByRole('heading', { name: 'Dossier' })).toBeVisible()
  })
})

test.describe('gate action bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/projects')
    await page.getByRole('link', { name: 'Review' }).first().click()
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

    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled()
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
    await page.getByRole('button', { name: 'Keep going' }).click()
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  })

  test('every visible control meets the 40px hit target', async ({ page }) => {
    await expectHitTargets(page)
  })
})

test.describe('costs', () => {
  test('shows a bar per provider against the configured cap', async ({ page }) => {
    await page.goto('/costs')

    await expect(page.getByRole('heading', { name: 'Costs' })).toBeVisible()
    for (const provider of ['anthropic', 'openai', 'google', 'elevenlabs']) {
      await expect(page.getByRole('meter', { name: `${provider} spend` })).toBeVisible()
    }
  })

  test('the kill switch is a two-step that says what it will do', async ({ page }) => {
    await page.goto('/costs')

    await expect(page.getByText('Kill switch is off')).toBeVisible()
    await page.getByRole('button', { name: 'Turn the kill switch on' }).click()
    await expect(page.getByText(/will park on a budget gate until you turn this off/)).toBeVisible()

    await page.getByRole('button', { name: 'Stop all spending' }).click()
    await expect(page.getByText('Kill switch is on')).toBeVisible()

    // Put it back, and prove the off path works too.
    await page.getByRole('button', { name: 'Turn the kill switch off' }).click()
    await expect(page.getByText('Kill switch is off')).toBeVisible()
  })

  test('a budget edit persists across a reload', async ({ page }) => {
    await page.goto('/costs')

    const field = page.getByLabel('pexels monthly budget in US dollars')
    await field.fill('7')
    await page.getByRole('button', { name: 'Save budgets' }).click()
    await expect(page.getByText('Budgets saved').first()).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('pexels monthly budget in US dollars')).toHaveValue('7')

    // Leave the fixture database as we found it.
    await page.getByLabel('pexels monthly budget in US dollars').fill('0')
    await page.getByRole('button', { name: 'Save budgets' }).click()
    await expect(page.getByText('Budgets saved').first()).toBeVisible()
  })

  test('Save is disabled until something actually changes', async ({ page }) => {
    await page.goto('/costs')

    await expect(page.getByRole('button', { name: 'Save budgets' })).toBeDisabled()
    await expect(page.getByText('No changes to save.')).toBeVisible()
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
