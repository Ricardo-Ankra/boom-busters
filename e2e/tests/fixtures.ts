import { expect, type Page } from '@playwright/test'
import { QUEUED_PROJECT_TITLE as QUEUED_PROJECT_TITLE_FOR_TOUCH } from '../global-setup'

/** The seeded fixture project's title, from `packages/db/src/fixtures.ts`. */
export const FIXTURE_PROJECT_TITLE = 'Wirecard: The €1.9 Billion That Never Existed'

/**
 * Signs in through the visible mock button rather than by forging a cookie.
 * Spec section 13 requires E2E flows to be driven through visible buttons
 * only, and going through the real form also exercises the CSRF round trip.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/signin')
  await page.getByRole('button', { name: 'Sign in as owner (mock mode)' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'))
}

/**
 * Asserts that every interactive control on screen clears the 40px minimum
 * hit target from spec section 11.1.
 */
export async function expectHitTargets(page: Page): Promise<void> {
  const controls = page.locator('button:visible, a[href]:visible, select:visible')
  const count = await controls.count()
  expect(count).toBeGreaterThan(0)

  for (let index = 0; index < count; index++) {
    const control = controls.nth(index)
    const box = await control.boundingBox()
    if (!box) continue
    const name = (await control.textContent())?.trim() || (await control.getAttribute('aria-label'))
    expect(box.height, `"${name}" is ${box.height}px tall`).toBeGreaterThanOrEqual(40)
  }
}

/**
 * The seeded fixture project, opened by name.
 *
 * Never `getByRole('link', {name: 'Review'}).first()`. That worked while the
 * fixture was the only project parked at a gate, and broke the moment the suite
 * gained others — twice now, at M3.4 and again at M4. The list is ordered by
 * recency, so "first" means "whichever project was seeded last", which is a
 * property of the seed order rather than of the thing under test.
 */
export async function openFixtureProject(page: Page): Promise<void> {
  await page.goto('/projects')
  await page
    .getByRole('listitem')
    .filter({ hasText: FIXTURE_PROJECT_TITLE })
    .getByRole('link')
    .first()
    .click()
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/)
}

/**
 * Make the seeded queued project queued *now*.
 *
 * `projectControl` treats a project queued for more than three minutes as one
 * whose event never arrived, and offers the button that re-sends it — which is
 * right, and which makes "queued and young" a state with a shelf life shorter
 * than the suite takes to run. Global setup seeds it once; by the time this
 * test opens it, it is legitimately old.
 *
 * Re-stamping `updatedAt` is the only way to assert on a time-bounded state
 * without either waiting it out or making the window configurable from
 * outside, and the second would mean production code shaped by a test.
 */
export async function touchQueuedProject(): Promise<void> {
  const { createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')

  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    await connection.sql`
      update projects set updated_at = now()
      where title = ${QUEUED_PROJECT_TITLE_FOR_TOUCH}`
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}
