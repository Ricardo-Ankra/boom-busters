import { expect, test } from '@playwright/test'
import { channelPath, FIRST_SLUG, SECOND_SLUG, signIn } from './fixtures'

/**
 * A channel's own exemplars (spec 2026-11-04, sections 9.1, 9.3, 9.4 and
 * 11): the Derive dialogue, the side by side after a refine, approve, keep,
 * Versions and restore, and the copy to another channel. The jobs
 * themselves run under the `@inngest/test` harness in `apps/web/inngest`;
 * no Inngest server runs here, so the versions a refine would have built
 * are written to the database first, as the pipeline spec seeds its runs.
 * A technique of the channel's own (spec 8.5) is seeded the same way.
 */

/** The channel's own technique, as a derivation would have proposed it. */
const LEDGER_WIPE = {
  key: 'ledger-wipe',
  name: 'Ledger wipe',
  description: 'a ruled line wipes the old figure away',
  steerPhrases: ['ledger wipe'],
  mechanisms: ['persistent-actor' as const],
  slot: {
    durationMs: 6000,
    words: [{ text: 'forty', atMs: 900 }],
    intent: 'The old figure is gone.',
  },
  fromReference: 'Ledger scene',
}

/** Every channel's exemplar rows gone: the Exemplars spec expects the house examples. */
async function clearVersions(): Promise<void> {
  const { channelExemplars, createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    await connection.db.delete(channelExemplars)
    // The channel-only key leaves every channel's techniques in use with its rows.
    await connection.sql`update channels
      set settings = jsonb_set(settings, '{motion,techniques}',
        (select coalesce(jsonb_agg(t), '[]'::jsonb)
           from jsonb_array_elements(settings->'motion'->'techniques') t
          where t <> '"ledger-wipe"'::jsonb))
      where settings->'motion'->'techniques' ? 'ledger-wipe'`
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
  const { approveExemplarVersion, createDb, insertExemplarVersion, syncChannelTechniqueInUse } =
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
    // The channel's own technique (spec 8.5): one approved version, in use.
    const own = await insertExemplarVersion(connection.db, {
      channelId: FIRST_CHANNEL_ID,
      technique: LEDGER_WIPE.key,
      plan: {
        ...plan,
        concept: 'the ledger line wipes the figure',
        mechanisms: ['persistent-actor'],
      },
      code: { ...code, title: 'The ledger wipe' },
      proposal: LEDGER_WIPE,
    })
    await approveExemplarVersion(connection.db, own.id)
    await syncChannelTechniqueInUse(connection.db, FIRST_CHANNEL_ID, LEDGER_WIPE.key)
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
    // The page re-renders on the server after the restore; the dev server takes its time.
    await expect(stat.getByText('Approved v1, derived', { exact: false })).toBeVisible({
      timeout: 15_000,
    })

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

  test('the channel-only technique shows its card, its phrase and its place in use', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=exemplars', FIRST_SLUG))
    const card = page.getByRole('region', { name: 'Ledger wipe' })
    await expect(card.getByText(/proposed from "Ledger scene"/)).toBeVisible()
    await expect(card.getByText(/Reach it with a steer that says: 'ledger wipe'\./)).toBeVisible()
    await expect(card.getByText('Approved v1, derived', { exact: false })).toBeVisible()
    await expect(card.getByText('The ledger wipe', { exact: true })).toBeVisible()
    await expect(card.getByText('House exemplar')).toBeHidden()

    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await expect(page.getByLabel('ledger-wipe')).toBeChecked()
    await expect(
      page.getByText(/This channel's own, reached by a steer that says: 'ledger wipe'\./),
    ).toBeVisible()
  })

  test('unticking it on the Motion tab saves, and its card keeps its versions', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
    await page.getByLabel('ledger-wipe').click()
    await expect(page.getByLabel('ledger-wipe')).not.toBeChecked()
    // The save lands on the server; a fresh load reads it back.
    await expect
      .poll(
        async () => {
          await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
          return page.getByLabel('ledger-wipe').isChecked()
        },
        { timeout: 15_000 },
      )
      .toBe(false)
    await expect(
      page.getByText(/This channel's own, reached by a steer that says: 'ledger wipe'\./),
    ).toBeVisible()

    await page.goto(channelPath('/settings?tab=exemplars', FIRST_SLUG))
    const card = page.getByRole('region', { name: 'Ledger wipe' })
    await card.getByRole('button', { name: 'Versions' }).click()
    await expect(card.getByRole('listitem').first()).toContainText('v1')
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
    // The channel-only technique came with the copy (spec 8.5), its key in use on the target.
    const ledger = page.getByRole('region', { name: 'Ledger wipe' })
    await expect(ledger.getByText('Approved v1, derived', { exact: false })).toBeVisible()
    await page.goto(channelPath('/settings?tab=motion', SECOND_SLUG))
    await expect(page.getByLabel('ledger-wipe')).toBeChecked()
  })

  test('keeps the tab you clicked when Start deriving refreshes the page', async ({ page }) => {
    await signIn(page)
    // Reached the way the owner does: Settings, then the Motion tab, not a deep link.
    await page.goto(channelPath('/settings', FIRST_SLUG))
    await page.getByRole('tab', { name: 'Motion' }).click()
    await expect(page).toHaveURL(/[?&]tab=motion/)
    await page.getByRole('button', { name: 'Derive exemplars' }).click()
    const dialog = page.getByRole('dialog', { name: 'Derive exemplars' })
    await dialog.getByLabel('Cap in dollars').fill('1')
    try {
      // No Inngest runs here, so the launch fails on the send; the refresh after it is the point.
      await dialog.getByRole('button', { name: 'Start deriving' }).click()
      // The card's failed line comes from the server, so it shows once the refresh has landed.
      await expect(page.getByText(/^Failed: Could not reach Inngest/)).toBeVisible()
      // The router knew only the URL Settings opened on, and the refresh put that back.
      await expect(page).toHaveURL(/[?&]tab=motion/)
      // Any full load of that URL (a deploy since the page opened, a failed refresh) opened on Models.
      await page.reload()
      await expect(page.getByRole('tab', { name: 'Motion', selected: true })).toBeVisible()
    } finally {
      const { createDb } = await import('@boom-busters/db')
      const { FIRST_CHANNEL_ID } = await import('@boom-busters/schemas')
      const { e2eDatabaseUrl } = await import('../database')
      const connection = createDb(e2eDatabaseUrl(), { max: 1 })
      try {
        await connection.sql`delete from motion_derivations where channel_id = ${FIRST_CHANNEL_ID}`
      } finally {
        await connection.sql.end({ timeout: 5 })
      }
    }
  })
})
