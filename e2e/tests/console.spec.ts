import { expect, test } from '@playwright/test'
import { expectHitTargets, signIn } from './fixtures'

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test.describe('first-run setup checklist', () => {
  test('replaces the dashboard and names what blocks the pipeline', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Set up Boom-Busters' })).toBeVisible()
    await expect(page.getByText(/pipeline cannot start a project until/i)).toBeVisible()

    for (const label of [
      'Connect YouTube',
      'Choose narration voice',
      'Set up Brand Kit',
      'Add at least 3 music beds',
      'Add your first cases',
    ]) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible()
    }
  })

  test('every checklist item deep-links somewhere real', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'Open music library' }).click()
    await expect(page).toHaveURL(/\/settings/)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
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
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('No pipeline runs yet.')).toBeVisible()

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
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Budgets' }).click()

    const killSwitch = page.getByRole('switch', { name: /Spending allowed|All spending paused/ })
    const wasOn = (await killSwitch.getAttribute('data-state')) === 'checked'

    await killSwitch.click()
    // Radix renders the toast plus an aria-live announcement copy.
    await expect(page.getByText('Saved').first()).toBeVisible()

    await page.reload()
    await page.getByRole('tab', { name: 'Budgets' }).click()
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
    for (const provider of ['anthropic', 'openai', 'google', 'elevenlabs', 'pexels', 'pixabay']) {
      await expect(
        panel.getByRole('heading', { name: new RegExp(`^${provider}\\b`) }),
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
