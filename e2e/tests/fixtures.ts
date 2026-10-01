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
 *
 * The sweep works over a snapshot of element handles, not `nth(index)`
 * re-queries. A screen can re-render mid-sweep — a project page live-refreshes
 * while anything is moving — and re-resolving index `i` against a list that
 * just shrank leaves `boundingBox()` waiting the whole test timeout for an
 * element that no longer exists. That was CI's one red test, deterministic on
 * a slow runner and a near-miss everywhere else. A handle whose element
 * detached answers `null` (or throws) and is skipped: the control it replaced
 * is measured by the next sweep of the same screen.
 */
export async function expectHitTargets(page: Page): Promise<void> {
  const controls = page.locator('button:visible, a[href]:visible, select:visible')
  const handles = await controls.elementHandles()
  expect(handles.length).toBeGreaterThan(0)

  for (const handle of handles) {
    try {
      // The Remotion Player's internal transport (play, fullscreen) is
      // third-party UI scaled to the video surface, not one of the app's
      // own controls; the section 11.1 rule is asserted on ours. The shell
      // marker is on OUR wrapper because the player renders its control bar
      // as a sibling of its `.__remotion-player` container.
      const insidePlayer = await handle.evaluate(
        (element) => (element as Element).closest('[data-player-shell]') !== null,
      )
      if (insidePlayer) continue
      const box = await handle.boundingBox()
      if (!box) continue
      const name = (await handle.textContent())?.trim() || (await handle.getAttribute('aria-label'))
      expect(box.height, `"${name}" is ${box.height}px tall`).toBeGreaterThanOrEqual(40)
    } catch (error) {
      // Only a vanished element is forgiven; a failed assertion is not.
      if (error instanceof Error && /not attached|detached/i.test(error.message)) continue
      throw error
    }
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
  // Click-and-verify, retried: a click that lands before hydration on a
  // mid-compile dev server vanishes without navigating. The inner wait must
  // be LONGER than a slow-but-real navigation (a cold compile takes ~2-3s) —
  // a short inner timeout re-clicks mid-navigation and restarts the very
  // thing it is waiting for, which turned one flaky spec into twenty.
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: FIXTURE_PROJECT_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

/**
 * Puts the Research route and the price catalogue back the way a fresh seed
 * leaves them, before the Models tab live-lists spec runs.
 *
 * Global setup resets `modelRouting.stills` on every run, but never touches
 * `research` or `modelPrices.llm`: nothing else needed it to. The Models tab
 * spec routes Research at `claude-mock-unpriced` and gives it a price so it
 * can assert the "needs a price" flow, then restores the route through the
 * UI at the end. The price override cannot be cleared the same way: that
 * model has no family to fall back to, so the UI refuses to clear a price
 * any route still needs, and clearing it is only ever offered for the model
 * currently selected in a route, which means using it. A run interrupted
 * before its own restore step, or a worktree sharing this database, leaves
 * the override behind, and the next run of this spec finds the model already
 * priced, so the "needs a price" message it asserts on never appears. Reset
 * here rather than relying on the previous run's own cleanup.
 */
export async function resetResearchModel(): Promise<void> {
  const { createDb, getSettings, updateSettings } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')

  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    const settings = await getSettings(connection.db)
    const { 'anthropic:claude-mock-unpriced': _unused, ...llm } = settings.modelPrices.llm
    await updateSettings(connection.db, {
      modelRouting: {
        ...settings.modelRouting,
        research: { provider: 'anthropic', model: 'claude-opus-5' },
      },
      modelPrices: { ...settings.modelPrices, llm },
    })
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
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
