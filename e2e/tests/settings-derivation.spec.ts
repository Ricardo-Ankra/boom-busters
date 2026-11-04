import { expect, test } from '@playwright/test'
import { channelPath, FIRST_SLUG, SECOND_SLUG, signIn } from './fixtures'

/**
 * A channel's own exemplars (spec 2026-11-04, sections 9.1, 9.3, 9.4 and
 * 11): the Derive dialogue, the side by side after a refine, approve, keep,
 * Versions and restore, and the copy to another channel. The jobs
 * themselves run under the `@inngest/test` harness in `apps/web/inngest`;
 * no Inngest server runs here, so the versions a refine would have built
 * are written to the database first, as the pipeline spec seeds its runs.
 */

/** Every channel's exemplar rows gone: the Exemplars spec expects the house examples. */
async function clearVersions(): Promise<void> {
  const { channelExemplars, createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    await connection.db.delete(channelExemplars)
    // The copy refuses a target with live references, so the second channel's seeded one is archived.
    await connection.sql`update motion_references set archived_at = now()
      where archived_at is null and channel_id in (select id from channels where slug = ${SECOND_SLUG})`
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

/** An approved v1 and a draft v2 refined from it, for the first channel's stat counter. */
async function seedVersions(): Promise<void> {
  await clearVersions()
  const { approveExemplarVersion, createDb, insertExemplarVersion } =
    await import('@boom-busters/db')
  const { FIRST_CHANNEL_ID } = await import('@boom-busters/schemas')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    const plan = {
      slot: { intent: 'The 40 minutes is the whole story.', words: [{ text: 'forty', atMs: 900 }] },
      concept: 'one figure rises out of the sentence',
      storyboard: ['0.0 s the sentence lands', '2.0 s the figure rises'],
      mechanisms: ['word-splits-open' as const, 'drum' as const],
      leansOn: [],
    }
    const code = {
      version: 1 as const,
      source: 'function Graphic(props) { return null }',
      compiled: 'function Graphic(props) { return null }',
      title: 'The forty minutes',
      facts: [],
      words: [{ text: 'forty', atMs: 900 }],
      durationMs: 6000,
      motion: 2,
    }
    const v1 = await insertExemplarVersion(connection.db, {
      channelId: FIRST_CHANNEL_ID,
      technique: 'stat-counter',
      plan,
      code,
    })
    await approveExemplarVersion(connection.db, v1.id)
    await insertExemplarVersion(connection.db, {
      channelId: FIRST_CHANNEL_ID,
      technique: 'stat-counter',
      plan: { ...plan, concept: 'the figure rises slower' },
      code: { ...code, title: 'The forty minutes, slower' },
      parentId: v1.id,
      steer: 'slower',
    })
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

test.describe('Derivation', () => {
  test.beforeEach(async () => {
    await seedVersions()
  })

  test.afterAll(async () => {
    await clearVersions()
  })

  test('opens the Derive dialogue with the estimate, the rounds in words and the cap in red above $20', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await page.getByRole('button', { name: 'Derive exemplars' }).click()
    const dialog = page.getByRole('dialog', { name: 'Derive exemplars' })
    await expect(dialog.getByText(/one round gives a correct exemplar/)).toBeVisible()
    // Stat counter has an approved version, so it is not ticked by default.
    await expect(dialog.getByRole('checkbox', { name: /Stat counter/ })).not.toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: /Bar chart/ })).toBeChecked()
    await expect(dialog.getByText(/^About \$/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start deriving' })).toBeDisabled()
    await dialog.getByLabel('Cap in dollars').fill('25')
    await expect(dialog.getByText('Above $20. It still runs.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start deriving' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })

  test('approves the refined version beside the approved one, keeps, lists the versions and restores', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=exemplars', FIRST_SLUG))
    const stat = page.getByRole('region', { name: 'Stat counter' })
    await expect(stat.getByText('Approved v1, derived', { exact: false })).toBeVisible()
    await expect(stat.getByText('The forty minutes', { exact: true })).toBeVisible()
    await expect(stat.getByRole('heading', { name: 'New' })).toBeVisible()
    await expect(stat.getByText('the figure rises slower')).toBeVisible()
    await expect(stat.getByText('Steer: slower')).toBeVisible()

    await stat.getByRole('button', { name: 'Approve this' }).click()
    await expect(stat.getByText('Approved v2, derived', { exact: false })).toBeVisible({
      timeout: 15_000,
    })
    await expect(stat.getByRole('heading', { name: 'New' })).toBeHidden()

    await stat.getByRole('button', { name: 'Versions' }).click()
    const items = stat.getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(1)).toContainText('v1, retired')
    await items.nth(1).getByRole('button', { name: 'Restore' }).click()
    await expect(stat.getByText('Approved v1, derived', { exact: false })).toBeVisible()

    // The steer that would refine it is a button away; the job itself runs under the test harness.
    await expect(stat.getByLabel(/Refine with a steer/)).toBeVisible()
    await expect(stat.getByRole('button', { name: 'Refine' })).toBeDisabled()
  })

  test('keeps the approved one and sets the draft aside', async ({ page }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=exemplars', FIRST_SLUG))
    const stat = page.getByRole('region', { name: 'Stat counter' })
    await stat.getByRole('button', { name: 'Keep the approved one' }).click()
    await expect(page.getByText('Kept the approved one').first()).toBeVisible()
    // The page re-renders on the server after the toast; the dev server takes its time.
    await expect(stat.getByRole('heading', { name: 'New' })).toBeHidden({ timeout: 15_000 })
    await expect(stat.getByText('Approved v1, derived', { exact: false })).toBeVisible()
    await stat.getByRole('button', { name: 'Versions' }).click()
    await expect(stat.getByRole('listitem').first()).toContainText('v2, retired')
  })

  test('copies motion to the second channel', async ({ page }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=motion', SECOND_SLUG))
    await page.getByLabel('Copy motion from').selectOption({ label: 'Boom & Busters' })
    await page.getByRole('button', { name: 'Copy motion from this channel' }).click()
    await page.getByRole('button', { name: 'Yes, copy it' }).click()
    // The toast comes and goes; what the copy leaves behind is the proof.
    await expect(page.getByRole('button', { name: 'Copy motion from this channel' })).toBeDisabled()
    await page.goto(channelPath('/settings?tab=exemplars', SECOND_SLUG))
    const stat = page.getByRole('region', { name: 'Stat counter' })
    await expect(stat.getByText('Approved v1, derived', { exact: false })).toBeVisible()
    await expect(stat.getByText('The forty minutes', { exact: true })).toBeVisible()
  })
})
