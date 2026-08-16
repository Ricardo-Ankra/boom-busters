import { expect, test, type Page } from '@playwright/test'
import {
  BEYOND_RUNNERS_TITLE,
  DENSE_WARNINGS_TITLE,
  FLAGGED_TAKE_TITLE,
  NARRATED_PROJECT_TITLE,
  NO_DOSSIER_TITLE,
  QUEUED_PROJECT_TITLE,
  STALE_PROJECT_TITLE,
  STOPPED_PROJECT_TITLE,
} from '../global-setup'
import { expectHitTargets, openFixtureProject, signIn, touchQueuedProject } from './fixtures'

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

  /**
   * Click-and-verify, retried. On a dev server mid-compile the click can land
   * before hydration and simply vanish — the link resolves, the click fires,
   * the URL never changes. Three separate specs in this family have each
   * flaked exactly this way. `toPass` re-clicks until the navigation actually
   * happened, which is the assertion that mattered all along. The inner wait
   * must be LONGER than a slow-but-real navigation (~2-3s on a cold compile):
   * a short one re-clicks mid-navigation and restarts what it is waiting for.
   */
  await expect(async () => {
    await page.getByRole('listitem').filter({ hasText: title }).getByRole('link').first().click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

test.describe('a project that was just created', () => {
  /**
   * This one re-stamps the fixture before it looks at it.
   *
   * "Queued and young" is a state with a three-minute shelf life
   * (`QUEUED_STUCK_AFTER_MS`): after that the console stops saying "nothing to
   * press" and correctly starts offering the button that re-sends the event.
   * A fixture seeded once in global setup ages past that window as the suite
   * grows, so this assertion began failing not because the screen was wrong but
   * because the fixture had got old — a test reporting on the clock rather than
   * on the code.
   *
   * Creating one through the UI is not an option: no Inngest Dev Server runs
   * in this suite, so `project/created` cannot be delivered and the project is
   * correctly marked `failed` rather than `queued` — which is what the
   * create-from-case test below asserts.
   *
   * So the state is made current instead of being waited out. The other tests
   * in this block still use the seeded project as it stands: what they assert
   * (no start-shaped button, no gate bar, 40px targets) is true of a queued
   * project at any age.
   */
  test('says its research is on the way and offers nothing to press', async ({ page }) => {
    await touchQueuedProject()
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
    await page.getByRole('button', { name: 'Cancel' }).click()
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

    // "Re-run stage" on the list has to lead somewhere that can actually
    // re-run. (It said "Resume" until 2026-08-16 — a label promising
    // continuation on an action that runs the stage from scratch at full cost.)
    const row = page.getByRole('listitem').filter({ hasText: STOPPED_PROJECT_TITLE })
    await expect(row.getByRole('link', { name: 'Re-run stage' })).toBeVisible()
  })
})

/**
 * Spec §11.3 says each rail segment "is clickable". It shipped as eight
 * `<div>`s, so a project on the script stage had no way back to the dossier its
 * narration was written from — the research, and the sources any later dispute
 * turns on, were unreachable from the screen that needed them most.
 */
/**
 * States taken from the production database rather than invented.
 *
 * Every fixture above this block was designed from what I expected a project to
 * look like, and four rounds of live defects came from the gap between that and
 * what projects actually look like. These three were surveyed out of the run
 * mirror: a project past the last runner that exists, a project on the script
 * stage with no dossier behind it, and a chapter at the warning density the
 * self-check really produces.
 */
test.describe('shapes taken from production', () => {
  test('a project past the last runner is explained, not offered a dead button', async ({
    page,
  }) => {
    // Production had one at `voice`/`running` with no live run: approved
    // through the script gate into a stage that had no runner. M4 built the
    // voice runner, so the fixture moved on to `visuals` — the shape is the
    // point, and "past the last runner" moves with every milestone.
    await openProject(page, BEYOND_RUNNERS_TITLE)

    await expect(page.getByRole('button', { name: /Run the visuals stage again/i })).toHaveCount(0)
    await expect(page.getByText(/arrives with its runner/i)).toBeVisible()
  })

  test('and it does not turn a spinner at a stage where nothing is running', async ({ page }) => {
    // `stageStatus` says `running`; the run mirror says nothing is. A spinner
    // here promised work that was not happening, for as long as you watched.
    await openProject(page, BEYOND_RUNNERS_TITLE)

    const rail = page.getByRole('list', { name: 'Pipeline stages' })
    await expect(rail.getByText(/^Visuals — the current stage, nothing running$/)).toBeAttached()
    await expect(page.getByText('Updating automatically')).toHaveCount(0)
  })

  test('a script stage with no dossier is not offered a re-run that can only fail', async ({
    page,
  }) => {
    /**
     * The exact production failure: this project was restarted from the console
     * and died on `load-dossier` — "The dossier is gone, so there is nothing to
     * script from" — because a script is written from a dossier's claims.
     */
    await openProject(page, NO_DOSSIER_TITLE)

    await expect(page.getByRole('button', { name: /Run the script stage again/i })).toHaveCount(0)
    await expect(page.getByText(/no dossier to write this script from/i)).toBeVisible()
  })

  test('a heavily flagged chapter stays usable at the density the self-check produces', async ({
    page,
  }) => {
    // Production's densest chapter carries 22 warnings. Fixtures with two clean
    // chapters never showed whether the gutter survives that.
    await openProject(page, DENSE_WARNINGS_TITLE)

    await expect(page.getByText(/22 warnings/).first()).toBeVisible()
    await expectHitTargets(page)
  })

  test('the whole page still fits at 22 warnings, with no sideways scroll', async ({ page }) => {
    await openProject(page, DENSE_WARNINGS_TITLE)

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows).toBe(false)
  })
})

test.describe('deleting a project', () => {
  const CASE_TITLE = 'A case whose project gets deleted (E2E)'

  test('removes it, states what goes, and keeps the case', async ({ page }) => {
    // Self-contained: it makes its own case and project rather than deleting a
    // shared fixture out from under the tests that follow it.
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
    await expect(page.getByText(/nothing is researching it/i).first()).toBeVisible()

    await openProject(page, CASE_TITLE)

    await page.getByRole('button', { name: /Delete this project/i }).click()
    // Named consequences, not "this cannot be undone".
    await expect(page.getByText(/The case it came from is kept/i)).toBeVisible()
    await page.getByRole('button', { name: 'Delete it' }).click()

    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByRole('listitem').filter({ hasText: CASE_TITLE })).toHaveCount(0)

    // The case survives: a case is a story worth telling, and abandoning one
    // attempt at it does not retract that.
    await page.goto('/cases')
    await expect(page.getByText(CASE_TITLE)).toBeVisible()
  })

  test('is not offered while a run is in flight', async ({ page }) => {
    // The fixture is parked at its gate with a live run behind it. Deleting it
    // there would leave the runner writing to a project that no longer exists.
    await openFixtureProject(page)

    await expect(page.getByRole('button', { name: /Delete this project/i })).toHaveCount(0)
    await expect(page.getByText(/Not while a run is in flight/i)).toBeVisible()
  })
})

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

    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  test('marks the stale stage on the rail without relying on colour', async ({ page }) => {
    await openProject(page, STALE_PROJECT_TITLE)

    const rail = page.getByRole('list', { name: 'Pipeline stages' })
    await expect(
      rail.getByText(/^Script — needs re-running, the stage this project is on$/),
    ).toBeAttached()
  })
})

/**
 * The voice stage (M4).
 *
 * The retake half of this loop cannot be driven here — flagging enqueues
 * `voice/retake.requested` through Inngest, and the suite runs without a Dev
 * Server (decision 22). So these tests cover what the *screen* does, and
 * `voice-review.test.tsx` covers what happens after a successful flag.
 *
 * What is genuinely worth an E2E is the thing a component test cannot fake:
 * that the audio route serves playable bytes for a seeded take.
 */
test.describe('voice review', () => {
  test('lists every paragraph with its duration, take number and status', async ({ page }) => {
    await openProject(page, NARRATED_PROJECT_TITLE)

    await expect(page.getByText(/The auditors signed the accounts/)).toBeVisible()
    await expect(page.getByText(/3 paragraphs ·/)).toBeVisible()
    await expect(page.getByText(/ready to approve/)).toBeVisible()
  })

  test('serves playable audio for the take the row asked to play', async ({ page }) => {
    await openProject(page, NARRATED_PROJECT_TITLE)

    await page.getByRole('button', { name: 'Play' }).first().click()

    const src = await page.locator('audio').first().getAttribute('src')
    expect(src).toMatch(/\/api\/voice-takes\/[0-9A-Z]{26}\/audio/)

    /**
     * The one assertion no component test can make: the route answers with a
     * real container. In mock mode nothing was ever written to R2, so this is
     * also the check that the deterministic regeneration path works — a take
     * whose audio only exists as a function of its own text and seed.
     */
    const audio = await page.request.get(src ?? '')
    expect(audio.status()).toBe(200)
    expect(audio.headers()['content-type']).toBe('audio/wav')
    expect((await audio.body()).subarray(0, 4).toString('ascii')).toBe('RIFF')
  })

  test('offers an A/B toggle only where a retake exists', async ({ page }) => {
    await openProject(page, NARRATED_PROJECT_TITLE)

    // Paragraph one was flagged and retaken by the seed; the other two were not.
    await expect(page.getByRole('button', { name: /Compare with take 1/ })).toHaveCount(1)

    await page.getByRole('button', { name: /Compare with take 1/ }).click()
    await expect(page.getByRole('button', { name: /Back to take 2/ })).toBeVisible()
  })

  test('refuses the gate while a take is flagged, and says which', async ({ page }) => {
    await openProject(page, FLAGGED_TAKE_TITLE)

    await expect(page.getByText(/1 flagged take is unresolved/)).toBeVisible()
    await expect(page.getByText('Note: Read the figure as a question.')).toBeVisible()
    // The escape from a mis-click, without paying for a replacement.
    await expect(page.getByRole('button', { name: 'Clear the flag' })).toBeVisible()
  })

  test('keeps its controls at the 40px minimum', async ({ page }) => {
    await openProject(page, NARRATED_PROJECT_TITLE)
    await expectHitTargets(page)
  })

  test('reads the voice stage of a project that has moved past it', async ({ page }) => {
    // The rail is navigable, so narration stays reachable from later stages —
    // which is where a dispute about what was actually said gets settled.
    await openProject(page, NARRATED_PROJECT_TITLE)

    const rail = page.getByRole('list', { name: 'Pipeline stages' })
    await rail.getByRole('link', { name: /Script/ }).click()
    await expect(page).toHaveURL(/stage=script/)

    await rail.getByRole('link', { name: /Voice/ }).click()
    await expect(page).toHaveURL(/stage=voice/)
    await expect(page.getByText(/The auditors signed the accounts/)).toBeVisible()
  })
})
