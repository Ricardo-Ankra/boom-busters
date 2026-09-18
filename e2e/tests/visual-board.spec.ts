import { expect, test, type Page } from '@playwright/test'
import { VISUAL_BOARD_TITLE } from '../global-setup'
import { expectHitTargets, signIn } from './fixtures'

/**
 * The visual board (build spec section 11.3), driven against the seeded
 * project parked at the visuals gate: 4 slots — a stock slot with a chosen
 * candidate, a claim-sourced chart, a map, and one placeholder.
 *
 * Everything here runs without Inngest: candidate selection is a plain
 * server action, and the gate wording is rendered state. Re-fetch and
 * approve hand events to Inngest and are exercised by the unit suites.
 */

async function openBoard(page: Page): Promise<void> {
  await page.goto('/projects')
  // Click-and-verify, retried — the same pattern and the same timeouts as
  // `openProject` in project-lifecycle, for the same dev-server reason.
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: VISUAL_BOARD_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await openBoard(page)
})

test.describe('the visual board', () => {
  test('shows the filmstrip, the chapter, and the covered sentence', async ({ page }) => {
    await expect(page.getByRole('list', { name: 'Filmstrip' })).toBeVisible()
    await expect(page.getByText(/Chapter 1 — The collapse on screen/)).toBeVisible()
    await expect(
      page.getByText(/“The auditors signed the accounts for eighteen straight years.”/),
    ).toBeVisible()
  })

  test('marks the chosen candidate and carries its licence line', async ({ page }) => {
    await expect(page.getByText('Selected')).toBeVisible()
    await expect(page.getByText(/Pexels License · Photo by Somebody/)).toBeVisible()
  })

  test('swapping a candidate is one click and survives a reload', async ({ page }) => {
    const strip = page.getByRole('list', { name: 'Candidates' })
    await strip.getByRole('listitem').nth(1).click()
    await expect(page.getByText('Selected', { exact: true })).toBeVisible()

    // The swap was persisted, not optimistic theatre: the second candidate's
    // licence line is now the audit line. Reload-until, because an immediate
    // reload can race the action's commit on the dev server (the same
    // bargain publish.spec and preview-render.spec already make).
    await expect(async () => {
      await page.reload()
      await expect(page.getByText(/Pixabay Content License/)).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
  })

  test('renders the chart from real data with its source-claim chip', async ({ page }) => {
    await expect(page.getByRole('img', { name: /line chart/ })).toBeVisible()
    await expect(page.getByText('From 104 to 1.28 in nine days.')).toBeVisible()
    await expect(page.getByText('claim 1')).toBeVisible()
  })

  test('renders the map with its locations', async ({ page }) => {
    await expect(page.getByRole('img', { name: /Map: Munich, Manila/ })).toBeVisible()
  })

  test('the placeholder slot demands the explicit approval wording', async ({ page }) => {
    await expect(page.getByText(/Nothing usable was found for this slot/)).toBeVisible()

    // The gate button itself carries the count — there is no plain Approve.
    await expect(page.getByRole('button', { name: 'Approve with 1 placeholder' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  })

  test('offers the repairs as labelled buttons on the card', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Edit brief & re-fetch' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Regenerate/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload own' }).first()).toBeVisible()
  })

  test('the brief editor opens inline with the current direction, and cancels', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Edit brief & re-fetch' }).first().click()
    await expect(page.getByLabel('Search query')).toHaveValue('empty office dusk')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByLabel('Search query')).toHaveCount(0)
  })

  test('Preview enlarges the chosen candidate with its facts, and closes', async ({ page }) => {
    await page.getByRole('button', { name: 'Preview' }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('img')).toBeVisible()
    await expect(dialog.getByText(/candidate 1 of 2/)).toBeVisible()
    // Which candidate is chosen depends on the swap test that ran before
    // this one, so assert the audit line's presence, not its provider.
    await expect(dialog.getByText(/License/)).toBeVisible()
    // The current choice cannot be re-chosen; the whole point of the button
    // is judging it at size.
    await expect(dialog.getByRole('button', { name: 'Selected for this slot' })).toBeDisabled()

    // The lightbox's controls only exist while it is open, so the page-wide
    // sweep below never sees them — sweep here.
    await expectHitTargets(page)

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('every control clears the 40px hit target', async ({ page }) => {
    await expectHitTargets(page)
  })
})

/**
 * The headline card (decision 257). The seeded article was read but carried no
 * byline, which is the common real case: the fetch worked, one field needs a
 * human, and the card has to make that a small job.
 */
/**
 * "Draft a different brief" (decision 258). The board could only edit a brief
 * by hand or re-plan every slot in the film; this is the control in between.
 *
 * Stops at the ask, like the re-type cases: pressing Draft it hands the work
 * to Inngest, and this suite runs without it.
 */
test.describe('asking for a different brief', () => {
  test('offers a steer, says it is not kept, and never asks a headline card', async ({ page }) => {
    const buttons = page.getByRole('button', { name: 'Draft a different brief' })
    await buttons.first().click()

    await expect(page.getByLabel(/What are you picturing/)).toBeVisible()
    await expect(page.getByText(/used once and not kept/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Draft it' })).toBeVisible()

    // The headline card is not offered one: every word on it is read from the
    // article rather than written. Asserted ON THAT CARD rather than by
    // counting buttons across the board, which would couple this test to what
    // every other test on the shared board happens to have done first.
    const headlineCard = page
      .locator('[id^="slot-"]')
      .filter({ has: page.getByLabel('Headline card preview') })
    await expect(headlineCard).toHaveCount(1)
    await expect(headlineCard.getByRole('button', { name: 'Draft a different brief' })).toHaveCount(
      0,
    )
  })
})

test.describe('a headline card', () => {
  test('draws what the article said, and says where each field came from', async ({ page }) => {
    const card = page.getByLabel('Headline card preview')
    // Twice on purpose: with no byline the card prints the outlet where the
    // byline goes, rather than inventing a name.
    await expect(card.getByText('The Financial Record')).toHaveCount(2)
    await expect(card.getByText(/Auditors cannot find the/)).toBeVisible()

    const provenance = page.getByLabel('Where each field came from')
    await expect(provenance.getByText(/headline . from the article/)).toBeVisible()
  })

  /**
   * The format picker asks instead of guessing (fixed 2026-09-18). It used to
   * treat headline as a structured target like a chart: it stamped the slot
   * "drafting", told the owner Claude was drafting the map locations, and then
   * failed, because no model is allowed to choose the article.
   *
   * Stops at the question deliberately: pressing "Quote this" writes the brief
   * and then asks Inngest to read the article, and this suite runs without it.
   */
  test('asks which article, rather than telling the owner it is drafting a map', async ({
    page,
  }) => {
    const picker = page.getByRole('group', { name: 'Slot format' }).first()
    await picker.getByRole('button', { name: 'news headline' }).click()

    const chooser = page.getByRole('group', { name: 'Which article this card quotes' })
    await expect(chooser.getByText(/the escrow accounts had never existed/)).toBeVisible()
    await expect(chooser.getByText('The Financial Record')).toBeVisible()
    await expect(chooser.getByRole('button', { name: 'Quote this' })).toBeVisible()

    // Nothing was re-typed by asking, and nothing claims to be drafting.
    await expect(page.getByText(/Claude is drafting/)).toHaveCount(0)
  })

  test('offers a card that is already a headline a different article, not the same one', async ({
    page,
  }) => {
    // The headline card's own picker: the one whose format button is pressed.
    const picker = page
      .getByRole('group', { name: 'Slot format' })
      .filter({ has: page.getByRole('button', { name: 'news headline', pressed: true }) })
    const button = picker.getByRole('button', { name: 'news headline' })

    // Live, unlike every other current-format button, because on this slot it
    // changes which article is quoted rather than the format.
    await expect(button).toBeEnabled()
    await button.click()

    const chooser = page.getByRole('group', { name: 'Which article this card quotes' })
    await expect(chooser.getByText('quoted now')).toBeVisible()
    // The seed has one news claim, and the card already quotes it, so there is
    // nothing else on offer — the marking is what is under test.
    await expect(chooser.getByRole('button', { name: 'Quote this' })).toHaveCount(0)
  })

  test('takes a correction, refuses an invented highlight, and keeps the rest', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Correct the details' }).click()

    // A marker over words the publication did not print is refused, not
    // quietly dropped: the owner typed it and deserves to know.
    await page.getByLabel('Highlight this phrase').fill('two billion')
    await page.getByRole('button', { name: 'Save' }).click()
    // `.first()`: the toast body and its aria-live announcer both say it.
    await expect(
      page.getByText(/has to appear in the headline, word for word/).first(),
    ).toBeVisible()

    await page.getByLabel('Byline').fill('Elena Marsh')
    await page.getByLabel('Highlight this phrase').fill('$1.9 billion')
    await page.getByRole('button', { name: 'Save' }).click()

    const card = page.getByLabel('Headline card preview')
    await expect(card.getByText('By Elena Marsh')).toBeVisible()

    // And it survives a reload, because it was written, not held in state.
    await page.reload()
    await expect(page.getByLabel('Headline card preview').getByText('By Elena Marsh')).toBeVisible()
    // The field the owner typed now says so, where the fetched ones do not.
    await expect(
      page.getByLabel('Where each field came from').getByText(/author . typed by you/),
    ).toBeVisible()
  })
})

/**
 * Reusing a shot on the board (decision 261). Opens the picker on the
 * placeholder, checks what the film offers and how far away it plays, and
 * cancels: a copy cannot be put back into the exact seeded placeholder from
 * the UI, and every test in this file shares the board. The copy itself is
 * proved by the db, action and component suites.
 */
test.describe('reusing a shot on the board (decision 261)', () => {
  test('offers the film’s fetched shots to the placeholder, with their distance, and cancels', async ({
    page,
  }) => {
    const placeholder = page.locator('[id^="slot-"]').filter({ hasText: 'courtroom sketch' })
    await placeholder.getByRole('button', { name: 'Use an existing shot' }).click()

    const picker = placeholder.getByRole('group', { name: 'Shots to reuse' })
    await expect(picker.getByText(/Deserted open-plan office at dusk/)).toBeVisible()
    await expect(picker.getByText('12 s earlier')).toBeVisible()
    // The chosen candidate is lendable; the unchosen one with no bytes is not.
    await expect(picker.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(1)

    await picker.getByRole('button', { name: 'Cancel' }).click()
    await expect(placeholder.getByRole('group', { name: 'Shots to reuse' })).toHaveCount(0)
  })

  test('never offers a chart the picker', async ({ page }) => {
    const chart = page
      .locator('[id^="slot-"]')
      .filter({ has: page.getByRole('img', { name: /line chart/ }) })
    await expect(chart).toHaveCount(1)
    await expect(chart.getByRole('button', { name: 'Use an existing shot' })).toHaveCount(0)
  })
})
