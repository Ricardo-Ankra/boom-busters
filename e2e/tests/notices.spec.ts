import { expect, test, type Page } from '@playwright/test'
import { VISUAL_PLAN_TITLE } from '../global-setup'
import { signIn } from './fixtures'

/**
 * Notices (decision 293): a line on the card an answer concerns, with a
 * Dismiss button. Seeded straight into the database (no model runs in e2e)
 * on the plan project's Direction card, then dismissed with the button.
 */

const MESSAGE = 'Trimmed to fit: era rule 1 (e2e).'

async function clearNotice(): Promise<void> {
  const { createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    await connection.sql`delete from notices where message = ${MESSAGE}`
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

async function seedNotice(): Promise<void> {
  const { addNotice, createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    const [project] = await connection.sql<{ id: string }[]>`
      select id from projects where title = ${VISUAL_PLAN_TITLE}`
    if (!project) throw new Error('The plan project is not seeded')
    await addNotice(
      connection.db,
      { projectId: project.id, subject: 'direction', subjectId: null },
      {
        kind: 'trimmed',
        message: MESSAGE,
      },
    )
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

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

// Before as well as after: an interrupted earlier run can leave its notice,
// and two copies would put two Dismiss buttons on the card.
test.beforeEach(async () => {
  await clearNotice()
})

test.afterEach(async () => {
  await clearNotice()
})

test('a notice on the Direction card is dismissed with its button', async ({ page }) => {
  await seedNotice()
  await signIn(page)
  await openPlan(page)

  const line = page.getByRole('status').filter({ hasText: MESSAGE })
  await expect(line).toBeVisible()
  await line.locator('xpath=..').getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('status').filter({ hasText: MESSAGE })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: MESSAGE })).toHaveCount(0)
})
