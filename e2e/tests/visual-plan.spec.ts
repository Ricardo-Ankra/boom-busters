import { expect, test, type Page } from '@playwright/test'
import { VISUAL_PLAN_TITLE } from '../global-setup'
import { signIn } from './fixtures'

/**
 * The PLAN checkpoint (staged-visuals design, closed out in M8.7): the
 * seeded project has its shot list written and nothing fetched. What e2e can
 * honestly prove without live Inngest: the plan bar with its priced button,
 * plan-phase wording (save-only edits, `planned` chips, no generic
 * Approve), and a mechanical re-type landing on the click that asked —
 * that write happens in the server action since the M8 picker fix.
 */

async function openPlan(page: Page): Promise<void> {
  await page.goto('/projects')
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: VISUAL_PLAN_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await openPlan(page)
})

test.describe('the shot plan checkpoint', () => {
  test('one priced Fetch button, planned chips, and no generic Approve', async ({ page }) => {
    // The still is the only paid slot, and global-setup owns the routing:
    // the shipped default, gemini-3.1-flash-image, at two variants a slot
    // (decision 264). A settings row left behind by a unit-test run must
    // not decide this number.
    await expect(
      page.getByRole('button', { name: 'Fetch visuals · 2 slots · est. $0.14' }),
    ).toBeVisible()
    await expect(page.getByText('planned').first()).toBeVisible()
    // The plan bar owns approval; the generic gate bar would speak an event
    // the parked runner is not listening for.
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(page.getByText(/Nothing has been fetched or generated yet/)).toBeVisible()
  })

  test('plan-phase edits say Save, never re-fetch', async ({ page }) => {
    /**
     * Scoped to the slot card, not the page. The plan screen also carries the
     * Cast card, whose editor has a Save of its own once this project has a
     * cast member, so a page-wide "Save" is two buttons and a strict-mode
     * failure — intermittently, depending on what earlier specs left behind.
     */
    const card = page.locator('[id^="slot-"]').first()
    await card.getByRole('button', { name: 'Edit brief', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: /Save & re-fetch/ })).toHaveCount(0)

    const description = card.getByLabel('Visual description')
    await description.fill('A boardroom nobody sits in any more, dust on the table.')
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Brief saved', { exact: true }).first()).toBeVisible()
  })

  test('re-typing still → stock lands on the click that asked', async ({ page }) => {
    const card = page.locator('[id^="slot-"]').filter({ hasText: 'boardroom' })
    const picker = card.getByRole('group', { name: 'Slot format' })
    // The current type's button is pressed and disabled — that is the badge
    // the accessibility tree can actually read (the visual badge uppercases
    // via CSS, which selectors must not depend on).
    await expect(picker.getByRole('button', { name: 'AI image' })).toBeDisabled()

    await picker.getByRole('button', { name: 'stock' }).click()

    // Synchronous since the M8 picker fix: the type changes on the button's
    // own refresh. Retried, because the dev server can race the commit.
    await expect(async () => {
      await expect(picker.getByRole('button', { name: 'stock' })).toBeDisabled({ timeout: 5_000 })
    }).toPass({ timeout: 20_000 })
    await expect(picker.getByRole('button', { name: 'AI image' })).toBeEnabled()

    // Put it back, so a re-run of this file starts from the seeded state.
    await picker.getByRole('button', { name: 'AI image' }).click()
    await expect(async () => {
      await expect(picker.getByRole('button', { name: 'AI image' })).toBeDisabled({
        timeout: 5_000,
      })
    }).toPass({ timeout: 20_000 })
  })
})

test.describe('the Direction card (decision 252)', () => {
  test('sits on the plan screen and offers a priced redraft', async ({ page }) => {
    await expect(page.getByText('Direction', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Redraft direction · ≈\$0\.05/ })).toBeVisible()
    // Re-planning belongs to the plan, so it sits with the fetch, not here.
    await expect(page.getByRole('button', { name: /Re-plan shot list/ })).toBeVisible()
  })
})

/**
 * Reusing a shot before Fetch (decision 261): the link is recorded, the
 * priced button drops the slot, and taking it back restores the seeded
 * state exactly, so a re-run of this file starts where the seed left it.
 */
test.describe('reusing a shot (decision 261)', () => {
  test('links a slot before Fetch, drops it from the bill, and can take it back', async ({
    page,
  }) => {
    const still = page.locator('[id^="slot-"]').filter({ hasText: 'boardroom' })
    await still.getByRole('button', { name: 'Use an existing shot' }).click()

    const picker = still.getByRole('group', { name: 'Shots to reuse' })
    await expect(picker.getByText(/Trading floor panic/)).toBeVisible()
    await expect(picker.getByText('6 s later')).toBeVisible()
    await picker.getByRole('button', { name: 'Use whatever this slot chooses' }).click()

    await expect(still.getByText('Reused from ch 1 · 0:06')).toBeVisible()
    await expect(page.getByRole('button', { name: /Fetch visuals · 1 slot/ })).toBeVisible()
    // The fetch-shaped buttons left the card; the words are still editable.
    await expect(still.getByRole('button', { name: /Fetch this slot/ })).toHaveCount(0)
    await expect(still.getByRole('button', { name: 'Edit brief', exact: true })).toBeVisible()

    await still.getByRole('button', { name: 'Choose its own shot' }).click()
    await expect(still.getByText(/Reused from/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Fetch visuals · 2 slots/ })).toBeVisible()
  })
})

/**
 * The Set card (decision 264): seeded with one set carrying one plate, so
 * the card opens collapsed and the test drives it open with "Edit sets".
 * Adding a set is scoped to the add-a-set form by id, because "Look" is
 * ambiguous once a set row exists on the page too.
 */
test.describe('sets (decision 264)', () => {
  test('the Set card lists the rooms and takes a new one', async ({ page }) => {
    // The Card itself carries aria-label="Sets"; the collapsed-state list
    // inside it carries the same label on a <ul>, so the selector is
    // narrowed to the <div> to stay unambiguous.
    const card = page.locator('div[aria-label="Sets"]')
    await card.getByRole('button', { name: 'Edit sets' }).click()
    // Each set row is a <section aria-label={set.name}> (role "region"); the
    // name also sits inside an <input>'s value, which getByText cannot see.
    await expect(card.getByRole('region', { name: 'Venture Capital Boardroom' })).toBeVisible()
    await expect(
      card.getByText('Up to two plates travel with every still shot in this room.'),
    ).toBeVisible()

    await card.locator('#set-new-name').fill('Stability AI London Headquarters')
    await card.locator('#set-new-look').fill('An open-plan office at night, monitors glowing.')
    await card.getByRole('button', { name: 'Add set' }).click()
    await expect(
      card.getByRole('region', { name: 'Stability AI London Headquarters' }),
    ).toBeVisible()
  })
})

/**
 * The per-slot model select (decision 264): scoped to the still card's own
 * brief editor, the same "Edit brief" button the plan-phase edit test above
 * uses, since the plan screen never offers "Save & re-fetch".
 */
test.describe('per-slot model routing (decision 264)', () => {
  test('a slot can be pointed at a different model', async ({ page }) => {
    const card = page.locator('[id^="slot-"]').filter({ hasText: 'boardroom' })
    await card.getByRole('button', { name: 'Edit brief', exact: true }).click()
    // playwright's selectOption takes a literal label, not a RegExp.
    await card.getByLabel('Image model').selectOption({ label: 'Gemini 3 Pro Image' })
    await expect(
      page.getByText('Model changed; re-fetch this shot to buy it', { exact: true }).first(),
    ).toBeVisible()
  })
})
