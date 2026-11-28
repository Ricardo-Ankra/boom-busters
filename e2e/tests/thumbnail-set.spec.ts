import { expect, test, type Page } from '@playwright/test'
import type * as DbModule from '@boom-busters/db'
import type { createDb } from '@boom-busters/db'
import { PUBLISH_PROJECT_TITLE } from '../global-setup'
import { channelPath, signIn } from './fixtures'

/**
 * Generated thumbnails and title sets (design 2026-11-24): generate, edit,
 * approve, then the hand-off for the Studio test.
 *
 * No Inngest runs in this suite, so pressing "Generate a set" can only prove
 * the action accepted the request; the run that would plan and paint the three
 * packages never happens. The spec therefore writes the three ready packages
 * a finished run leaves behind, straight through the db package's helpers,
 * and carries on from there through visible labelled buttons. The upload
 * never happens either, so the record is moved to `scheduled` the way
 * publish.spec.ts does for its moved-slot test.
 *
 * The spec borrows the seeded publish project and puts back everything it
 * changed (stage, the master's record, the packages) in `finally`: other
 * specs read the same project.
 */

test.setTimeout(180_000)

const TITLES = [
  'The auditors signed for eighteen years (E2E set)',
  'Where the 1.9 billion never was (E2E set)',
  'The week the cash vanished (E2E set)',
]

type Saved = {
  projectId: string
  stage: string
  stageStatus: string
  record: {
    status: string
    publish_at: Date | null
    uploaded_thumb_keys: string[]
    metadata: Record<string, unknown>
    youtube_video_id: string | null
    privacy_status: string
    upload_started_at: Date | null
    error: Record<string, unknown> | null
    test_reminder_sent_at: Date | null
    test_started_at: Date | null
    test_ended_at: Date | null
  } | null
}

async function withDb<T>(
  work: (connection: ReturnType<typeof createDb>, db: typeof DbModule) => Promise<T>,
): Promise<T> {
  const db = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = db.createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    return await work(connection, db)
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

/** Park the seeded project at Publish and remember what was there. */
async function prepare(): Promise<Saved> {
  return withDb(async ({ db, sql }, lib) => {
    const [project] = await sql<{ id: string; stage: string; stage_status: string }[]>`
      select id, stage, stage_status from projects where title = ${PUBLISH_PROJECT_TITLE}`
    if (!project) throw new Error('the publish fixture project is missing')
    const [record] = await sql<NonNullable<Saved['record']>[]>`
      select status, publish_at, uploaded_thumb_keys, metadata, youtube_video_id, privacy_status,
        upload_started_at, error, test_reminder_sent_at, test_started_at, test_ended_at
      from publish_records where target_type = 'master' and target_id = ${project.id}`
    await lib.setProjectStage(db, project.id, { stage: 'publish', stageStatus: 'awaiting_review' })
    return {
      projectId: project.id,
      stage: project.stage,
      stageStatus: project.stage_status,
      record: record ?? null,
    }
  })
}

/** What the run leaves behind: three ready, unapproved packages on three different ideas. */
async function seedReadyPackages(projectId: string): Promise<void> {
  await withDb(async ({ db }, lib) => {
    const record = await lib.ensurePublishRecord(db, 'master', projectId)
    const ideas = ['person', 'figure', 'moment'] as const
    const { inserted } = await lib.replaceUnapprovedGenerated(
      db,
      record.id,
      ideas.map((idea, index) => ({
        idea,
        angle: `Promises the ${idea} of the story (E2E ${index + 1})`,
        title: TITLES[index]!,
        headline: ['Eighteen years', 'Nobody asked', 'It never existed'][index]!,
        picture: {
          subject: 'A tired auditor over a ledger',
          framing: 'Close, eye level',
          textSide: 'left' as const,
          stillSlotIds: [],
          depicts: [],
        },
        claimIds: ['01E2EC000000000000000000AA'],
      })),
    )
    for (const row of inserted) {
      await lib.updateThumbnailPackage(db, row.id, {
        state: 'ready',
        composedKey: `boom-busters/thumbs/${projectId}/mock-${row.id}.jpg`,
      })
    }
  })
}

/** Put back everything the spec changed. */
async function restore(saved: Saved): Promise<void> {
  await withDb(async ({ db, sql }, lib) => {
    if (saved.record === null) {
      // The record did not exist: its packages go with it (cascade).
      await sql`delete from publish_records where target_type = 'master' and target_id = ${saved.projectId}`
    } else {
      const r = saved.record
      await sql`
        update publish_records set
          status = ${r.status}::publish_status,
          publish_at = ${r.publish_at},
          uploaded_thumb_keys = ${r.uploaded_thumb_keys}::text[],
          metadata = ${JSON.stringify(r.metadata)}::text::jsonb,
          youtube_video_id = ${r.youtube_video_id},
          privacy_status = ${r.privacy_status}::privacy_status,
          upload_started_at = ${r.upload_started_at},
          error = ${r.error === null ? null : JSON.stringify(r.error)}::text::jsonb,
          test_reminder_sent_at = ${r.test_reminder_sent_at},
          test_started_at = ${r.test_started_at},
          test_ended_at = ${r.test_ended_at}
        where target_type = 'master' and target_id = ${saved.projectId}`
      await sql`
        delete from thumbnail_packages
        where publish_record_id in (
          select id from publish_records where target_type = 'master' and target_id = ${saved.projectId})`
    }
    await lib.setProjectStage(db, saved.projectId, {
      stage: saved.stage as never,
      stageStatus: saved.stageStatus as never,
    })
  })
}

async function openPublish(page: Page): Promise<void> {
  await page.goto(channelPath('/projects'))
  // One click and a long wait: a cold dev-server compile of the project page
  // outlasts a short wait, and a second click would land on the wrong page.
  await page
    .getByRole('listitem')
    .filter({ hasText: PUBLISH_PROJECT_TITLE })
    .getByRole('link')
    .first()
    .click()
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 60_000 })
}

test('a set is generated, edited, approved and handed over for a Studio test', async ({ page }) => {
  const saved = await prepare()
  try {
    await signIn(page)
    await openPublish(page)

    // Generate: the action is accepted (or says plainly why it was not). The
    // run that would plan the packages never starts here, so nothing appears.
    const generate = page.getByRole('button', { name: /^Generate a set · about \$/ })
    await expect(generate).toBeVisible()
    await generate.click()
    await expect(
      page.getByText(/making the set|could not reach inngest to start the set/i).first(),
    ).toBeVisible({ timeout: 15_000 })

    // What a finished run leaves behind: three ready packages.
    await seedReadyPackages(saved.projectId)
    await expect(async () => {
      await page.reload()
      await expect(page.getByRole('article', { name: /^Thumbnail [123]$/ })).toHaveCount(3, {
        timeout: 5_000,
      })
    }).toPass({ timeout: 30_000 })

    await page.getByRole('heading', { name: 'Thumbnails and titles' }).scrollIntoViewIfNeeded()

    const first = page.getByRole('article', { name: 'Thumbnail 1' })
    const second = page.getByRole('article', { name: 'Thumbnail 2' })
    await expect(first.getByText('Default', { exact: true })).toBeVisible()
    await expect(first.getByLabel('Title', { exact: true })).toHaveValue(TITLES[0]!)

    // Edit one headline and save it.
    await second.getByLabel('Headline', { exact: true }).fill('Nobody checked')
    await second.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Changes saved').first()).toBeVisible({ timeout: 15_000 })

    // Highlight a word of that headline. Words that are not in it are refused
    // on the card and cannot be saved; a word that is in it saves and stays.
    const highlight = second.getByLabel('Highlight', { exact: true })
    const mismatch = second.getByText('The highlight must be words from the headline.')
    await highlight.fill('banks')
    await expect(mismatch).toBeVisible()
    await expect(second.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await highlight.fill('checked')
    await expect(mismatch).toHaveCount(0)
    await second.getByRole('button', { name: 'Save changes' }).click()
    // The button is not drawn once nothing differs from the saved row, so its
    // going is the card's own sign that the save landed. A reload before that
    // could abort the request, and the reload below cannot repair that.
    await expect(second.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
    await expect(async () => {
      await page.reload()
      await expect(second.getByLabel('Highlight', { exact: true })).toHaveValue('checked', {
        timeout: 5_000,
      })
      await expect(second.getByLabel('Headline', { exact: true })).toHaveValue('Nobody checked', {
        timeout: 5_000,
      })
    }).toPass({ timeout: 30_000 })

    // Ask for a change to the first picture. No Inngest runs in this suite, so
    // the paint itself never happens: the action is accepted up to the send,
    // says plainly that it could not reach Inngest, and puts the card back as
    // it was. A package with a picture is what the card needs for the field,
    // so the picture a finished run leaves is written here, after the save
    // above (a save on a package with a picture asks for a new compose).
    const keys = await withDb(async ({ sql }) => {
      const rows = await sql<{ id: string }[]>`
        select tp.id from thumbnail_packages tp
        join publish_records pr on pr.id = tp.publish_record_id
        where pr.target_type = 'master' and pr.target_id = ${saved.projectId}
        order by tp.position asc limit 1`
      const id = rows[0]!.id
      await sql`update thumbnail_packages
        set picture_key = ${`boom-busters/thumbs/${saved.projectId}/mock-picture-${id}.png`}
        where id = ${id}`
      return id
    })
    await expect(async () => {
      await page.reload()
      await expect(first.getByRole('textbox', { name: 'Change the picture' })).toBeVisible({
        timeout: 5_000,
      })
    }).toPass({ timeout: 30_000 })
    await expect(first.getByRole('button', { name: 'Change picture', exact: true })).toBeDisabled()
    await expect(first.getByRole('button', { name: 'Back to previous picture' })).toHaveCount(0)
    await first
      .getByRole('textbox', { name: 'Change the picture' })
      .fill('fewer people in the queue')
    await first.getByRole('button', { name: 'Change picture', exact: true }).click()
    await expect(page.getByText('Could not reach Inngest to start the work.').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(first.getByText('Being made')).toHaveCount(0, { timeout: 15_000 })

    // What a finished change leaves behind: the picture it replaced. Then the
    // way back shows, and pressing it fails the same plain way and leaves the
    // card, and the button, as they were.
    await withDb(async ({ sql }) => {
      await sql`update thumbnail_packages
        set previous_picture_key = ${`boom-busters/thumbs/${saved.projectId}/mock-before-${keys}.png`}
        where id = ${keys}`
    })
    const back = first.getByRole('button', { name: 'Back to previous picture' })
    await expect(async () => {
      await page.reload()
      await expect(back).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
    await back.click()
    await expect(page.getByText('Could not reach Inngest to start the work.').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(first.getByText('Being made')).toHaveCount(0, { timeout: 15_000 })
    await expect(back).toBeVisible()

    // Rewrite the first picture's brief. The fields open filled with what the
    // planner wrote, and the card says who the new words will show. With no
    // Inngest to reach, the request fails the same plain way and the stored
    // brief is put back, which the second reload shows. Every name is matched
    // exactly: "Picture" is also inside "Change the picture". The first reload
    // clears the earlier refusals, which stay on screen, so the one asserted
    // below is this press's own.
    const unreachable = page.getByText('Could not reach Inngest to start the work.')
    const picture = first.getByRole('textbox', { name: 'Picture', exact: true })
    await expect(async () => {
      await page.reload()
      await expect(picture).toHaveValue('A tired auditor over a ledger', { timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
    await expect(unreachable).toHaveCount(0)
    await expect(first.getByRole('textbox', { name: 'Framing', exact: true })).toHaveValue(
      'Close, eye level',
    )
    await picture.fill('A vault door left open at night')
    await expect(first.getByText('Will show: nobody from the cast')).toBeVisible()
    await first.getByRole('button', { name: 'Regenerate picture', exact: true }).click()
    await expect(unreachable.first()).toBeVisible({ timeout: 15_000 })
    await expect(first.getByText('Being made')).toHaveCount(0, { timeout: 15_000 })
    await expect(picture).toHaveValue('A vault door left open at night')
    await expect(async () => {
      await page.reload()
      await expect(picture).toHaveValue('A tired auditor over a ledger', { timeout: 5_000 })
    }).toPass({ timeout: 30_000 })

    // Approve the set.
    await page.getByRole('button', { name: 'Approve this set' }).click()
    await expect(page.getByText('Set approved').first()).toBeVisible({ timeout: 15_000 })

    // After a reload the first package is the default, all three are approved,
    // and the title field of the metadata form holds the default's title.
    await expect(async () => {
      await page.reload()
      await expect(page.getByText('Approved', { exact: true })).toHaveCount(3, { timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
    await expect(
      page.getByRole('article', { name: 'Thumbnail 1' }).getByText('Default', { exact: true }),
    ).toBeVisible()
    // The metadata form's title is a bare span above its input (the package
    // cards' titles are labels), so this reaches only the form's.
    const metadataTitle = page.locator(
      'xpath=//span[normalize-space(text())="Title"]/following::input[1]',
    )
    await expect(metadataTitle).toHaveValue(TITLES[0]!)

    // The upload runner never runs here: move the record to what a finished
    // upload leaves behind, then the card shows the hand-off.
    await withDb(async ({ sql }) => {
      await sql`
        update publish_records
        set status = 'scheduled', youtube_video_id = 'mock-e2e-thumbnail-set'
        where target_type = 'master' and target_id = ${saved.projectId}`
    })
    await expect(async () => {
      await page.reload()
      // A scheduled master is no longer the first item to edit: select it
      // again (its own card is the first) so its editor, and the hand-off in
      // it, comes back.
      await page.getByRole('button', { name: 'Move the slot' }).first().click()
      await expect(page.getByText('Test & Compare in Studio')).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Copy title' })).toHaveCount(2)
    await expect(page.getByText('Variant 1 is on the video.')).toBeVisible()
  } finally {
    await restore(saved)
  }
})
