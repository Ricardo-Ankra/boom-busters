import { expect, test, type Page } from '@playwright/test'
import { QUEUED_PROJECT_TITLE, STALE_PROJECT_TITLE, STOPPED_PROJECT_TITLE } from '../global-setup'
import { expectHitTargets, signIn } from './fixtures'

/**
 * What a project screen offers, in the states a real project actually passes
 * through — as opposed to the one state the rest of the suite drove.
 *
 * Every other project test opens the seeded fixture, which global setup parks
 * at the dossier gate with a live run behind it. That is the *middle* of a
 * project's life. Nothing covered the beginning, and the beginning is where the
 * bugs were:
 *
 * - a freshly created project offered "Start demo pipeline" as its only button,
 *   so the obvious thing to press started the M2 no-op run *alongside* the real
 *   dossier research; the demo then opened and closed genuine review gates on a
 *   genuine project, and approving one of its fake gates sent the script runner
 *   after a dossier that had never been written;
 * - a stopped or failed project offered the same button, so there was no way
 *   back at all;
 * - and because a stale demo run held the project at `awaiting_review`
 *   continuously, the gate bar never unmounted between the dossier and script
 *   gates, so its "handed to the pipeline" note survived into the script gate
 *   and stood where Approve should have been.
 *
 * The rule these tests hold the console to: **it never offers to start work
 * that starts itself**, and it always offers a way out of a stage that stopped.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

async function openProject(page: Page, title: string): Promise<void> {
  await page.goto('/projects')
  await page.getByRole('listitem').filter({ hasText: title }).getByRole('link').first().click()
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/)
}

test.describe('a project that was just created', () => {
  test('says its research is on the way and offers nothing to press', async ({ page }) => {
    await openProject(page, QUEUED_PROJECT_TITLE)

    // The question a human asked out loud: does the dossier start on its own,
    // or do I press something? The screen has to answer it.
    await expect(page.getByRole('status')).toContainText(/nothing to press/i)
    await expect(page.getByText(/picks this up within a few seconds/i)).toBeVisible()
  })

  test('offers no start-shaped button whatsoever', async ({ page }) => {
    await openProject(page, QUEUED_PROJECT_TITLE)

    // Named explicitly: this is the button that shipped, and its return would
    // be the regression. The generic assertion below is the real guard.
    await expect(page.getByRole('button', { name: /demo pipeline/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /forced budget gate/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^start/i })).toHaveCount(0)
  })

  test('shows the rail at dossier, and no gate bar, because nothing is waiting', async ({
    page,
  }) => {
    await openProject(page, QUEUED_PROJECT_TITLE)

    await expect(page.getByRole('list', { name: 'Pipeline stages' })).toBeVisible()
    // No run is parked on this project, so an approval would reach nothing.
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Request changes' })).toHaveCount(0)
  })

  test('every control still clears the 40px hit target', async ({ page }) => {
    await openProject(page, QUEUED_PROJECT_TITLE)
    await expectHitTargets(page)
  })
})

test.describe('making a project from a case', () => {
  const CASE_TITLE = 'A case that becomes a project (E2E)'

  test('creates it, and says plainly when the pipeline could not be reached', async ({ page }) => {
    await page.goto('/cases')
    await page.getByRole('button', { name: 'Add case' }).click()
    await page.getByLabel('Title').fill(CASE_TITLE)
    await page.getByLabel('Angle').fill('An angle, so the form is valid.')
    await page.getByRole('button', { name: 'Save case' }).click()
    await expect(page.getByText('Case added to your backlog').first()).toBeVisible()

    await page
      .getByRole('listitem')
      .filter({ hasText: CASE_TITLE })
      .getByRole('button', { name: 'New project' })
      .click()

    /**
     * No Inngest Dev Server runs in this suite, so `project/created` cannot be
     * delivered and the send fails — which is precisely the case worth
     * asserting. The project must not sit at `queued` pretending to be on its
     * way, and the message must not tell the human to "start the run", because
     * there is no such button and there should not be one.
     */
    await expect(page.getByText(/nothing is researching it/i).first()).toBeVisible()

    await openProject(page, CASE_TITLE)
    await expect(page.getByRole('button', { name: /Run the dossier stage again/i })).toBeVisible()
  })

  test('the restart says what it will cost before it does anything', async ({ page }) => {
    await openProject(page, CASE_TITLE)

    await page.getByRole('button', { name: /Run the dossier stage again/i }).click()
    await expect(page.getByText(/It costs what it cost the first time/i)).toBeVisible()

    // And it can be backed out of, like every other consequential control.
    await page.getByRole('button', { name: 'Keep going' }).click()
    await expect(page.getByRole('button', { name: /Run the dossier stage again/i })).toBeVisible()
  })
})

test.describe('a project that was stopped', () => {
  // The exact place a human lands after being told "press Stop on that
  // project", which used to be a dead end whose only button started a no-op
  // run alongside whatever was left of the real one.
  test('is left with a way back, not with a demo pipeline', async ({ page }) => {
    await openProject(page, STOPPED_PROJECT_TITLE)

    await expect(page.getByRole('button', { name: /Run the dossier stage again/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /demo pipeline/i })).toHaveCount(0)
    await expect(page.getByText(/Work already done is kept/i)).toBeVisible()

    // No run is behind it, so an approval would reach nothing and is not
    // offered — the restart is the only way on.
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  })

  test('the projects list agrees with the project screen', async ({ page }) => {
    await page.goto('/projects')

    // "Resume" on the list has to lead somewhere that can actually resume.
    const row = page.getByRole('listitem').filter({ hasText: STOPPED_PROJECT_TITLE })
    await expect(row.getByRole('link', { name: 'Resume' })).toBeVisible()
  })
})

/**
 * Spec §11.3 says each rail segment "is clickable". It shipped as eight
 * `<div>`s, so a project on the script stage had no way back to the dossier its
 * narration was written from — the research, and the sources any later dispute
 * turns on, were unreachable from the screen that needed them most.
 */
test.describe('moving between stages', () => {
  test('the dossier is reachable from the script stage', async ({ page }) => {
    await openProject(page, STALE_PROJECT_TITLE)

    await page.getByRole('link', { name: /Dossier/ }).click()

    await expect(page).toHaveURL(/\?stage=dossier/)
    await expect(page.getByText(/The research was re-run/)).toBeVisible()
  })

  test('says which stage you are reading and which the project is on', async ({ page }) => {
    await openProject(page, STALE_PROJECT_TITLE)
    await page.getByRole('link', { name: /Dossier/ }).click()

    await expect(page.getByText(/You are reading the/)).toContainText(/dossier/)
    await expect(page.getByText(/This project is on/)).toContainText(/script/)
  })

  test('refuses to offer an approval from a stage you have navigated away to', async ({ page }) => {
    // Approving from an off-stage screen would approve the gate the project is
    // actually parked at — a different stage entirely.
    await openProject(page, STALE_PROJECT_TITLE)
    await page.getByRole('link', { name: /Dossier/ }).click()

    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Request changes' })).toHaveCount(0)
  })

  test('comes back to where the project actually is', async ({ page }) => {
    await openProject(page, STALE_PROJECT_TITLE)
    await page.getByRole('link', { name: /Dossier/ }).click()

    await page.getByRole('link', { name: /Back to script/i }).click()
    await expect(page).toHaveURL(/\?stage=script/)
  })

  test('every control on an off-stage screen still meets the 40px hit target', async ({ page }) => {
    await openProject(page, STALE_PROJECT_TITLE)
    await page.getByRole('link', { name: /Dossier/ }).click()
    await expectHitTargets(page)
  })
})

test.describe('work built from research that has since been replaced', () => {
  test('says so, rather than presenting the old script as current', async ({ page }) => {
    await openProject(page, STALE_PROJECT_TITLE)

    await expect(page.getByText(/Written from an older dossier/)).toBeVisible()
    // Kept, not deleted — the decision this milestone turns on.
    await expect(
      page.getByText('Narration produced before the research was replaced.'),
    ).toBeVisible()
  })

  test('offers a re-run from the stage that is stale, naming its cost', async ({ page }) => {
    await openProject(page, STALE_PROJECT_TITLE)
    await page.getByRole('link', { name: /Dossier/ }).click()

    await page.getByRole('button', { name: /Run the dossier stage again/i }).click()

    // The consequence names the downstream stage rather than saying
    // "downstream work will be invalidated", which nobody can act on.
    await expect(
      page.getByText(/script stage will be marked as built from older work/i),
    ).toBeVisible()
    await expect(page.getByText(/kept and still readable/i)).toBeVisible()

    await page.getByRole('button', { name: 'Keep going' }).click()
  })

  test('marks the stale stage on the rail without relying on colour', async ({ page }) => {
    await openProject(page, STALE_PROJECT_TITLE)

    const rail = page.getByRole('list', { name: 'Pipeline stages' })
    await expect(
      rail.getByText(/^Script — needs re-running, the stage this project is on$/),
    ).toBeAttached()
  })
})
