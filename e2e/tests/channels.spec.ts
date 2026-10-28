import { expect, test, type Page } from '@playwright/test'
import { channelPath, FIRST_SLUG, SECOND_SLUG, signIn } from './fixtures'

/**
 * Stage A of the multiple-channels design, driven through visible buttons in
 * one ordered story: a second channel starts blank, is taken from set-up to
 * usable, proves it shares nothing it should not, and a third is created and
 * archived. Global setup re-creates the second channel (blank bible, no cases,
 * no connection) and drops the third on every run, so the story is repeatable.
 */
test.describe.configure({ mode: 'serial' })

const SECOND_CASE_TITLE = 'A case that belongs to the second channel (E2E)'
const NEW_ACCENT = '#12ab34'

async function openSwitcher(page: Page): Promise<void> {
  // The switcher is the top bar's first button: it is labelled with the
  // current channel's name, which differs per channel, so find it by its
  // popup rather than by name.
  await page.locator('header button[aria-haspopup="true"]').click()
}

async function monthMeter(page: Page): Promise<string> {
  const meter = page.getByTitle(/Actual spend this month against the monthly ceiling/)
  await expect(meter).toBeVisible()
  return ((await meter.textContent()) ?? '').trim()
}

async function musicLibraryHeading(page: Page, slug: string): Promise<string> {
  // The first-run strip's own link when it is showing, the same address
  // otherwise: either way the music library is the workspace's.
  await page.goto(channelPath('', slug))
  const link = page.getByRole('link', { name: 'Open music library' })
  if ((await link.count()) > 0) {
    await link.first().click()
  } else {
    await page.goto('/settings?tab=music')
  }
  await expect(page).toHaveURL(/\/settings\?tab=music/)
  const heading = page.getByText(/^Library . \d+ tracks?$/)
  await expect(heading).toBeVisible()
  return ((await heading.textContent()) ?? '').trim()
}

test.describe('channels', () => {
  let firstAccent = ''
  let firstMeter = ''

  test('the switcher lists both channels and opens the second, which starts at set-up', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('', FIRST_SLUG))

    await openSwitcher(page)
    const list = page.getByRole('list', { name: 'Channels' })
    const first = list.locator(`a[href="/c/${FIRST_SLUG}"]`)
    const second = list.locator(`a[href="/c/${SECOND_SLUG}"]`)
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    // Each entry carries its own count of what waits on the owner.
    await expect(first).toContainText(/\d+$/)
    await expect(second).toContainText(/^Second Channel\s*0$/)

    await second.click()
    await expect(page).toHaveURL(new RegExp(`/c/${SECOND_SLUG}$`))

    // A blank bible is the first thing set-up asks for.
    const strip = page.getByRole('heading', { name: 'Set up Boom-Busters' })
    await expect(strip).toBeVisible()
    await expect(
      page
        .getByRole('list')
        .filter({ has: page.getByText('Write the channel bible') })
        .getByRole('listitem')
        .first(),
    ).toContainText('Write the channel bible')
  })

  test('an incomplete bible stops Suggest cases, and filling the Channel tab does not yet free it', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('/cases', SECOND_SLUG))
    await expect(page.getByRole('button', { name: 'Suggest cases' })).toBeDisabled()
    await expect(page.getByText('Complete the channel bible in Settings first.')).toBeVisible()

    await page.goto(channelPath('/settings?tab=channel', SECOND_SLUG))
    const fields: Record<string, string> = {
      subject: 'The psychology of everyday decisions',
      whatACaseIs: 'A named, documented episode where a known bias changed an outcome.',
      subjectKind: 'The study or episode as its Wikipedia article titles it',
      audience: 'Curious adults who read popular science.',
      narrationRegister: 'Calm, plain and a little dry.',
      visualRegister: 'Archival photographs and muted documentary stills.',
      titleStyle: 'A plain statement of what happened, under 60 characters.',
    }
    for (const [key, value] of Object.entries(fields)) {
      await page.locator(`#bible-${key}`).fill(value)
    }
    for (let index = 1; index <= 2; index += 1) {
      await page.getByRole('button', { name: 'Add category' }).click()
      await page.getByLabel(`Category ${index} key`).fill(`category-${index}`)
      await page.getByLabel(`Category ${index} label`).fill(`Category ${index}`)
    }
    // The bible's full shape needs fields the Channel tab cannot set yet, so
    // filling every field it does have leaves the bible incomplete.
    await expect(page.getByText('Bible incomplete')).toBeVisible()
    await page.getByRole('button', { name: 'Save bible' }).click()
    await expect(page.getByText('Saved').first()).toBeVisible()

    await page.goto(channelPath('/cases', SECOND_SLUG))
    await expect(page.getByRole('button', { name: 'Suggest cases' })).toBeDisabled()
    await expect(page.getByText('Complete the channel bible in Settings first.')).toBeVisible()
  })

  test('the brand kit belongs to the channel', async ({ page }) => {
    await signIn(page)

    await page.goto(channelPath('/settings?tab=brand-kit', FIRST_SLUG))
    firstAccent = await page.locator('#colour-accent').inputValue()
    expect(firstAccent).not.toBe(NEW_ACCENT)

    await page.goto(channelPath('/settings?tab=brand-kit', SECOND_SLUG))
    await page.locator('#colour-accent').fill(NEW_ACCENT)
    await page.locator('#colour-accent').blur()
    await expect(page.getByText('Saved').first()).toBeVisible()

    await page.goto(channelPath('/settings?tab=brand-kit', SECOND_SLUG))
    await expect(page.locator('#colour-accent')).toHaveValue(NEW_ACCENT)
    await page.goto(channelPath('/settings?tab=brand-kit', FIRST_SLUG))
    await expect(page.locator('#colour-accent')).toHaveValue(firstAccent)
  })

  test('a case, the calendar and the month meter', async ({ page }) => {
    await signIn(page)

    await page.goto(channelPath('/cases', SECOND_SLUG))
    await page.getByRole('button', { name: 'Add case' }).click()
    await page.getByLabel('Title').fill(SECOND_CASE_TITLE)
    await page.getByLabel('Angle').fill('An angle, so the form is valid.')
    await page.getByRole('button', { name: 'Save case' }).click()
    await expect(page.getByText('Case added to your backlog').first()).toBeVisible()
    await expect(page.getByText(SECOND_CASE_TITLE).first()).toBeVisible()

    await page.goto(channelPath('/cases', FIRST_SLUG))
    await expect(page.getByRole('heading', { name: 'Case Library' })).toBeVisible()
    await expect(page.getByText(SECOND_CASE_TITLE)).toHaveCount(0)

    // Nothing of the first channel's is on the second channel's calendar.
    await page.goto(channelPath('/calendar', SECOND_SLUG))
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible()
    await expect(page.getByText(/Nothing is scheduled yet/)).toBeVisible()

    // The ceiling is the workspace's, so the meter reads the same on both.
    await page.goto(channelPath('', FIRST_SLUG))
    firstMeter = await monthMeter(page)
    await page.goto(channelPath('', SECOND_SLUG))
    expect(await monthMeter(page)).toBe(firstMeter)
  })

  test('a third channel is created from the switcher and archived with its typed address', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('', FIRST_SLUG))

    await openSwitcher(page)
    await page.getByRole('link', { name: 'New channel' }).click()
    await expect(page.getByRole('heading', { name: 'New channel' })).toBeVisible()

    await page.getByLabel('Name').first().fill('Third Channel')
    // The address follows the name until it is edited by hand.
    await expect(page.locator('#new-channel-slug')).toHaveValue('third-channel')
    await page.getByRole('button', { name: 'Create channel' }).click()

    await expect(page).toHaveURL(/\/c\/third-channel\/settings\?tab=channel/)
    await page.locator('#archive-confirm').fill('third-channel')
    await page.getByRole('button', { name: 'Archive channel' }).click()

    // The default channel is where the owner lands, and the third is gone
    // from the switcher.
    await expect(page).toHaveURL(new RegExp(`/c/${FIRST_SLUG}$`))
    await openSwitcher(page)
    await expect(
      page.getByRole('list', { name: 'Channels' }).locator('a[href^="/c/third-channel"]'),
    ).toHaveCount(0)
  })

  test('the music library is the workspace’s, whichever channel links to it', async ({ page }) => {
    await signIn(page)
    const fromFirst = await musicLibraryHeading(page, FIRST_SLUG)
    const fromSecond = await musicLibraryHeading(page, SECOND_SLUG)
    expect(fromSecond).toBe(fromFirst)
  })
})
