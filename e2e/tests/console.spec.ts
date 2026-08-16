import { expect, test } from '@playwright/test'
import { expectHitTargets, signIn } from './fixtures'

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test.describe('dashboard', () => {
  /**
   * The dashboard is the Needs-you queue, always. It used to be replaced by
   * the setup checklist until every item was done — and two items belong to
   * milestones that have not shipped, so the queue was unreachable in the
   * running product.
   */
  test('shows the Needs-you queue, never the old full-page checklist', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Set up Boom-Busters' })).toBeHidden()
    // Fixture projects parked at gates surface as cards with a Review button.
    await expect(page.getByRole('link', { name: 'Review' }).first()).toBeVisible()
  })

  test('names setup that belongs to later milestones without blocking anything', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByText(/Coming with later milestones/)).toBeVisible()
  })

  test('a settings deep link lands on the tab it names', async ({ page }) => {
    // Every checklist button and cross-link addresses a tab as `?tab=`; until
    // this was honoured, all of them landed on Models.
    await page.goto('/settings?tab=connections')
    await expect(page.getByRole('tab', { name: 'Connections' })).toHaveAttribute(
      'data-state',
      'active',
    )
  })
})

test.describe('app shell', () => {
  test('the rail reaches every screen in the information architecture', async ({ page }) => {
    await page.goto('/')
    const rail = page.getByRole('navigation', { name: 'Primary' })

    for (const [label, expected] of [
      ['Projects', /\/projects/],
      ['Case Library', /\/cases/],
      ['Calendar', /\/calendar/],
      ['Costs', /\/costs/],
      ['Settings', /\/settings/],
    ] as const) {
      await rail.getByRole('link', { name: label }).click()
      await expect(page, label).toHaveURL(expected)
    }
  })

  test('the activity drawer opens and closes from visible buttons', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Activity' }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    // Global setup parks mirrored runs at the dossier AND visuals gates, so
    // the feed has entries in it — plural since M5, hence `.first()`: the
    // drawer reads `run_events`, never Inngest's API.
    await expect(drawer.getByText('Gate opened').first()).toBeVisible()

    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('dark is the default theme and the toggle persists across a reload', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).not.toHaveClass(/light/)

    await page.getByRole('button', { name: /Switch to light theme/ }).click()
    await expect(page.locator('html')).toHaveClass(/light/)

    await page.reload()
    await expect(page.locator('html')).toHaveClass(/light/)

    await page.getByRole('button', { name: /Switch to dark theme/ }).click()
    await expect(page.locator('html')).not.toHaveClass(/light/)
  })

  test('every visible control meets the 40px hit target', async ({ page }) => {
    await page.goto('/')
    await expectHitTargets(page)
  })
})

test.describe('settings', () => {
  test('a change persists across a reload', async ({ page }) => {
    // The Budgets tab this test used to flip a switch on is gone — budgets are
    // one ceiling on the Costs screen now. The Publishing audit toggle is the
    // same shape of control through the same save path.
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Publishing' }).click()

    const audit = page.getByRole('switch', { name: /Audit passed|Audit not passed yet/ })
    const wasOn = (await audit.getAttribute('data-state')) === 'checked'

    await audit.click()
    // Radix renders the toast plus an aria-live announcement copy.
    await expect(page.getByText('Saved').first()).toBeVisible()

    await page.reload()
    await page.getByRole('tab', { name: 'Publishing' }).click()
    await expect(page.getByRole('switch').first()).toHaveAttribute(
      'data-state',
      wasOn ? 'unchecked' : 'checked',
    )

    // Leave the fixture database as we found it.
    await page.getByRole('switch').first().click()
    // Radix renders the toast plus an aria-live announcement copy.
    await expect(page.getByText('Saved').first()).toBeVisible()
  })

  test('model routing offers every task the spec names', async ({ page }) => {
    await page.goto('/settings')

    for (const label of [
      'Research (dossiers)',
      'Script drafting',
      'Editing and self-checks',
      'Shot lists',
      'Titles and descriptions',
      'Weekly digest',
    ]) {
      await expect(page.getByText(label)).toBeVisible()
    }
  })

  test('one card per provider, with the key input masked', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Connections' }).click()

    const panel = page.getByRole('tabpanel', { name: 'Connections' })
    // The boundary after the name is a space (the status label follows)
    // rather than `\b` — a word boundary once let "google" also match a
    // sibling card whose name it prefixed.
    for (const provider of ['anthropic', 'openai', 'google', 'elevenlabs', 'pexels', 'pixabay']) {
      await expect(
        panel.getByRole('heading', { name: new RegExp(`^${provider}(\\s|$)`) }),
      ).toBeVisible()
      await expect(panel.getByLabel(`${provider} API key`)).toHaveAttribute('type', 'password')
    }
  })

  test('a stored provider key is never rendered, only its last four characters', async ({
    page,
  }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Connections' }).click()

    const panel = page.getByRole('tabpanel', { name: 'Connections' })
    // Either a mask or an explicit "no key" — never key material.
    await expect(panel.getByText(/^(••••.{1,4}|No key stored)$/).first()).toBeVisible()

    // Nothing anywhere on the page may look like a real API key.
    await expect(page.locator('body')).not.toContainText(/sk-[a-zA-Z0-9-]{8,}/)
    await expect(page.locator('body')).not.toContainText(/\bv1\.[A-Za-z0-9_-]{10,}/)
  })
})
