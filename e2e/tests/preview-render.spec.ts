import { expect, test, type Page } from '@playwright/test'
import { PREVIEW_PROJECT_TITLE } from '../global-setup'
import { expectHitTargets, signIn } from './fixtures'

/**
 * Preview & render — Gate 5a (build spec sections 11.3 and 13), driven
 * against the seeded project parked at the preview gate with a compiled
 * timeline and a finished master beside it. The master is a REAL local
 * `renderMedia` of the 20-second fixture — the spec's "instead of Lambda in
 * CI" — produced by global-setup and served through the file route.
 *
 * The Render master click itself hands `gate/preview.approved` to Inngest,
 * which the suite runs without; the confirm step and its section 8.1
 * wording are asserted here, the runner in the `@inngest/test` suite.
 */

async function openPreview(page: Page): Promise<void> {
  await page.goto('/projects')
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: PREVIEW_PROJECT_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await openPreview(page)
})

test.describe('the preview screen', () => {
  test('mounts the player over the compiled timeline, with stats and chapters', async ({
    page,
  }) => {
    // The seeded project has a FINISHED master, so the master owns the
    // stage by default (decision 187); the live preview is one tab away.
    await page.getByRole('button', { name: /Preview · v\d/ }).click()
    // The Remotion Player is on screen (it renders into a labelled group).
    await expect(page.locator('.__remotion-player')).toBeVisible()

    await expect(page.getByText(/Timeline v1/)).toBeVisible()
    // 15s of narration plus the decision-215 breathing room (opening card,
    // chapter-two lead + card) stretches the cut to 20.4s.
    await expect(page.getByText(/0:20 · 2 slots · 2 chapters/)).toBeVisible()
    // Chapter seek buttons, labelled with their timecodes.
    await expect(page.getByRole('button', { name: /1\. The audit/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /2\. The collapse/ })).toBeVisible()

    // Captions toggle is a visible labelled button.
    await expect(page.getByRole('button', { name: 'Hide captions' })).toBeVisible()

    // No bed on the compiled timeline; the line says so instead of drawing.
    await expect(page.getByText(/No music bed on this timeline/)).toBeVisible()

    await expectHitTargets(page)
  })

  test('offers the music library and the two-step Render master with its cost', async ({
    page,
  }) => {
    // The picker lists the seeded library.
    await expect(page.getByText('Documentary tension 01 (E2E)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use this bed' }).first()).toBeVisible()

    // Render master: no spend on the first click — the confirm carries the
    // honest consequence (mock mode: local, free).
    await page.getByRole('button', { name: /Render master · est\. \$0\.00/ }).click()
    await expect(page.getByText(/Renders on this machine in mock mode/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Render now' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Render now' })).toHaveCount(0)
  })

  test('shows the QC report card and plays the locally rendered master', async ({ page }) => {
    // The QC card: passed, every check OK.
    const qc = page.getByTestId('qc-report')
    await expect(qc).toBeVisible()
    await expect(qc.getByText('Passed')).toBeVisible()
    await expect(qc.getByText('-14.0 LUFS')).toBeVisible()

    // The master video gets its src from the 2 s progress poll and is a real
    // mp4 — the 20-second fixture rendered by renderMedia in global-setup.
    const video = page.getByTestId('master-video')
    await expect(video).toBeVisible()
    const src = await video.getAttribute('src')
    expect(src).toMatch(/\/api\/renders\/[0-9A-Z]{26}\/file/)

    const response = await page.request.get(src!)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('video/mp4')
    expect((await response.body()).byteLength).toBeGreaterThan(100_000)

    // And the browser can actually play it: metadata resolves to ~20 s.
    const duration = await video.evaluate(
      (element: HTMLVideoElement) =>
        new Promise<number>((resolve) => {
          if (element.readyState >= 1) return resolve(element.duration)
          element.addEventListener('loadedmetadata', () => resolve(element.duration), {
            once: true,
          })
        }),
    )
    expect(duration).toBeGreaterThan(19)
    expect(duration).toBeLessThan(21)
  })

  test('swapping the music bed recompiles the timeline as a new version', async ({ page }) => {
    // Runs LAST in this file: it moves the fixture from v1 to v2.
    await page.getByRole('button', { name: 'Use this bed' }).first().click()
    // .first(): the toast also mirrors its text into an aria-live region.
    await expect(page.getByText(/Bed swapped — timeline recompiled/).first()).toBeVisible()

    // The swap is persisted, not optimistic theatre: reload until the
    // recompiled version is what the server renders (the action's own
    // router.refresh can lose a race with the dev server's recompile).
    await expect(async () => {
      await page.reload()
      await expect(page.getByText(/Timeline v2/)).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
    // The bed's bytes are mock:// with no storage behind them, so the preview
    // says what it could not fetch instead of crashing the player. That note
    // lives on the Preview tab (the master owns the stage by default).
    await page.getByRole('button', { name: /Preview · v2/ }).click()
    await expect(page.getByText(/not previewable/)).toBeVisible()
    await expect(page.getByText('Current', { exact: true })).toBeVisible()
  })
})
