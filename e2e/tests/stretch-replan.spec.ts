import { expect, test, type Page } from '@playwright/test'
import { STRETCH_BOARD_TITLE } from '../global-setup'
import { signIn } from './fixtures'

/**
 * The stretch re-plan on the board (the stretch re-plan design), driven
 * against the seeded project whose headline shares a 17-word sentence pair
 * with the stock shot after it.
 *
 * Like visual-board.spec, this runs without Inngest: a sent event never runs,
 * so the action answers with the "Could not reach Inngest" copy and clears
 * the stamps it wrote. The replacement itself is proven by the stretch
 * replanner's own tests; what is asserted here is everything the owner sees
 * before and around it, including that the cleared stamps are in the database.
 */

async function openBoard(page: Page): Promise<void> {
  await page.goto('/projects')
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: STRETCH_BOARD_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

const cardFor = (page: Page, description: string) =>
  page.locator('[id^="slot-"]').filter({ hasText: description })

async function expectThreeCardsAtRest(page: Page): Promise<void> {
  await expect(cardFor(page, 'The CNBC story on screen.')).toHaveCount(1)
  await expect(cardFor(page, 'Investors around a boardroom table.')).toHaveCount(1)
  await expect(cardFor(page, 'An empty office after the collapse.')).toHaveCount(1)
  await expect(page.getByText(/Re-planning these shots/)).toHaveCount(0)
}

test('a short headline and its neighbour are selected together, and a refused send leaves no stamp', async ({
  page,
}) => {
  await signIn(page)
  await openBoard(page)

  const headline = cardFor(page, 'The CNBC story on screen.')
  const neighbour = cardFor(page, 'Investors around a boardroom table.')
  const next = cardFor(page, 'An empty office after the collapse.')

  await expect(headline.getByText(/this news headline is on screen for/)).toBeVisible()
  await expect(headline.getByText(/this shot and the next both quote/).first()).toBeVisible()

  await headline.getByRole('button', { name: 'Re-plan this stretch' }).first().click()
  await expect(headline.getByRole('button', { name: 'Selected' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(neighbour.getByRole('button', { name: 'Selected' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(next.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  await page.getByLabel('What should change? (optional)').fill('Keep the quote on one picture.')
  const replan = page.getByRole('button', { name: /^Re-plan these 2 shots · ≈\$0\.03$/ })
  await expect(replan).toBeVisible()
  await replan.click()

  await expect(
    page
      .getByLabel('Notifications (F8)')
      .getByText(/Could not reach Inngest to re-plan these shots/),
  ).toBeVisible()
  await expectThreeCardsAtRest(page)

  // The stamps were cleared in the database, not only in the client.
  await page.reload()
  await expect(cardFor(page, 'The CNBC story on screen.')).toBeVisible()
  await expectThreeCardsAtRest(page)
})
