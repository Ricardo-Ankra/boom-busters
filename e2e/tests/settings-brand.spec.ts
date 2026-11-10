import { expect, test } from '@playwright/test'
import { channelPath, signIn } from './fixtures'

/**
 * Chapter marking (decision 457): the Brand Kit tab offers cards, title or
 * none as a labelled select, and the choice survives a reload. The test puts
 * the setting back to `cards` at the end.
 */

test('the Brand Kit tab offers Chapter marking as a labelled select and keeps the choice', async ({
  page,
}) => {
  await signIn(page)
  await page.goto(channelPath('/settings?tab=brand-kit'))

  const select = page.getByLabel('Chapter marking')
  await expect(select).toBeVisible()
  await expect(select).toHaveValue('cards')
  await select.selectOption('none')
  await expect(page.getByText('Saved').first()).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('Chapter marking')).toHaveValue('none')

  await page.getByLabel('Chapter marking').selectOption('cards')
  await expect(page.getByText('Saved').first()).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Chapter marking')).toHaveValue('cards')
})
