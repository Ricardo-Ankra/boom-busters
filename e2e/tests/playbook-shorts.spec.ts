import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { Database } from '@boom-busters/db'
import { expect, test, type Page } from '@playwright/test'
import {
  PLAYBOOK_POINT_ID_PREFIX,
  PLAYBOOK_SHORTS_TITLE,
  RENDER_ARTIFACTS_DIR,
  RENDER_LOCAL_DIR,
} from '../global-setup'
import { channelPath, expectHitTargets, signIn } from './fixtures'

/**
 * The playbook Shorts flow (design sections 3 and 8), driven from the seeded
 * project parked at the talking points checkpoint to the publish guard, all
 * through visible labelled buttons.
 *
 * No Inngest Dev Server runs in this suite, so a redo or an approve cannot
 * start its runner: the action answers with the honest "Could not reach
 * Inngest" copy and puts the checkpoint back. The tests press those buttons
 * and assert that refusal. What the runners would then have left (proposal
 * version 2; the approved set with its three built Shorts) is written
 * straight to the database, the way publish.spec.ts promotes a scheduled
 * upload, and everything after it is read through the real screens.
 *
 * Runs in order within this file (workers: 1): later tests need the state
 * the earlier ones leave.
 */

test.setTimeout(180_000)

const POINT_IDS = [1, 2, 3].map((n) => `${PLAYBOOK_POINT_ID_PREFIX}${n}`)

async function openProject(page: Page): Promise<void> {
  await page.goto(channelPath('/projects'))
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: PLAYBOOK_SHORTS_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 60_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await openProject(page)
})

test.describe('the playbook Shorts flow', () => {
  test('the checkpoint shows three cards and the redo buttons refuse in words without Inngest', async ({
    page,
  }) => {
    await expect(page.getByRole('heading', { name: 'Talking points', exact: true })).toBeVisible()
    await expect(page.getByText('Version 1', { exact: true }).first()).toBeVisible()
    for (const title of [
      'Eighteen clean audits',
      'The hole was never a theft',
      'The answer nobody wanted',
    ]) {
      await expect(page.getByRole('article', { name: title })).toBeVisible()
    }
    await expect(page.getByRole('article')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Approve talking points' })).toBeVisible()
    await expectHitTargets(page)

    // Redo the whole set with a note: nothing can run it here.
    await page.getByLabel('Suggest changes').fill('make one about the auditors')
    await page.getByRole('button', { name: 'Redo talking points' }).click()
    await expect(
      page.getByText('Could not reach Inngest to redo the talking points.').first(),
    ).toBeVisible({ timeout: 15_000 })

    // Redo one card (card 2): the per-card note box and its own Redo button.
    const second = page.getByRole('article', { name: 'The hole was never a theft' })
    await second.getByRole('button', { name: 'Redo this one' }).click()
    await second.getByLabel('Note for this point').fill('sharper hook')
    await second.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(
      page.getByText('Could not reach Inngest to redo the talking points.').first(),
    ).toBeVisible({ timeout: 15_000 })

    // Approve: the same refusal, and the checkpoint is back where it was.
    await page.getByRole('button', { name: 'Approve talking points' }).click()
    await expect(
      page.getByText('Could not reach Inngest to start building the Shorts.').first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Version 1', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve talking points' })).toBeEnabled()
  })

  test('a redone proposal lands as Version 2', async ({ page }) => {
    await proposeVersionTwo()
    await expect(async () => {
      await page.reload()
      await expect(page.getByText('Version 2', { exact: true }).first()).toBeVisible({
        timeout: 5_000,
      })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByRole('article', { name: 'The hole, said more sharply' })).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(3)
    await expect(page.getByText('sharper hook')).toBeVisible()
  })

  test('approved: the Shorts screen shows three point cards, and a card opens its studio', async ({
    page,
  }) => {
    await approveAndBuild()
    await expect(async () => {
      await page.reload()
      await expect(page.getByText(/^Point Short · its own narration/).first()).toBeVisible({
        timeout: 5_000,
      })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByText(/^Point Short · its own narration/)).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Open the Short studio' })).toHaveCount(3)

    await page.getByRole('button', { name: 'Open the Short studio' }).first().click()
    const studio = page.getByLabel('Point Short studio')
    await expect(studio).toBeVisible()
    await expect(studio.getByRole('heading', { name: 'Findings' })).toBeVisible()
    await expect(studio.getByRole('button', { name: /^Assemble and render/ })).toBeVisible()
  })

  test('the Publish screen refuses a point Short before its long form is scheduled', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Continue to Publish' }).click()
    await expect(page.getByText(/on to the publish screen/i).first()).toBeVisible()
    await expect(async () => {
      await page.reload()
      await expect(page.getByText(/going public is a manual step/i)).toBeVisible({
        timeout: 5_000,
      })
    }).toPass({ timeout: 30_000 })

    // The rendered point Short is the first Short card; select it.
    await page.getByRole('button', { name: 'Edit metadata' }).first().click()
    await expect(page.getByText('Point short: Eighteen clean audits')).toBeVisible()
    await page.getByRole('button', { name: 'Schedule here' }).first().click()
    await expect(page.getByText('Schedule the long-form video first.').first()).toBeVisible({
      timeout: 15_000,
    })
  })
})

// ---------------------------------------------------------------------------
// What the runners leave behind, written the way they would
// ---------------------------------------------------------------------------

async function withDb<T>(work: (db: Database, projectId: string) => Promise<T>): Promise<T> {
  const { createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    const [row] = await connection.sql<{ id: string }[]>`
      select id from projects where title = ${PLAYBOOK_SHORTS_TITLE}`
    if (!row) throw new Error('the playbook Shorts project was not seeded')
    return await work(connection.db, row.id)
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

/** The talking-points runner's output for "redo": version 2, card 2 rewritten. */
async function proposeVersionTwo(): Promise<void> {
  await withDb(async (db, projectId) => {
    const { insertTalkingPointSet, latestTalkingPointSet } = await import('@boom-busters/db')
    const latest = await latestTalkingPointSet(db, projectId)
    if (!latest || latest.version !== 1) throw new Error('expected proposal version 1')
    await insertTalkingPointSet(db, {
      projectId,
      scriptVersion: latest.scriptVersion,
      points: latest.points.map((point) =>
        point.id === POINT_IDS[1] ? { ...point, title: 'The hole, said more sharply' } : point,
      ),
      note: 'sharper hook',
    })
  })
}

/**
 * Approve version 2 and leave what the point-short runner leaves: the stage at
 * phase `review`, one assembled point Short per point (its mini master set),
 * the first one rendered so the Publish screen offers it a slot.
 */
async function approveAndBuild(): Promise<void> {
  await withDb(async (db, projectId) => {
    const {
      approveTalkingPointSet,
      insertRender,
      insertShort,
      latestTalkingPointSet,
      latestTimeline,
      setProjectStage,
      updateRender,
      updateShort,
      shortForPoint,
    } = await import('@boom-busters/db')
    const set = await latestTalkingPointSet(db, projectId)
    if (!set) throw new Error('no talking points to approve')
    if ((await approveTalkingPointSet(db, projectId, set.version)) !== 'approved') {
      throw new Error('the seeded set could not be approved')
    }
    const master = await latestTimeline(db, projectId)
    if (!master) throw new Error('the seeded master timeline is missing')

    for (const [index, point] of set.points.entries()) {
      if (await shortForPoint(db, projectId, point.id)) continue
      const chapterIndex = point.sourceChapters[0] ?? 0
      const row = await insertShort(db, {
        projectId,
        title: point.title,
        segmentRef: { chapterId: '0P01NTP01NTP01NTP01NTP01NT', fromParagraph: 0, toParagraph: 4 },
        kind: 'point',
        pointId: point.id,
        pointScript: {
          scriptVersion: set.scriptVersion,
          pointId: point.id,
          title: point.title,
          paragraphs: (['hook', 'stakes', 'delivery', 'resolution', 'bridge'] as const).map(
            (phase) => ({
              phase,
              text: `${point.title}: the ${phase} beat of this Short.`,
              chapterIndex,
            }),
          ),
        },
        sourceTimeline: master.json as Record<string, unknown>,
      })
      if (index !== 0) continue
      const render = await insertRender(db, {
        projectId,
        timelineVersion: master.version,
        kind: 'short',
        shortId: row.id,
        costUsd: '0',
      })
      const cached = path.join(RENDER_ARTIFACTS_DIR, 'fixture-master.mp4')
      if (existsSync(cached)) {
        copyFileSync(cached, path.join(RENDER_LOCAL_DIR, `${render.id}.mp4`))
      }
      await updateRender(db, render.id, {
        status: 'done',
        progressPct: 100,
        outputS3Key: `local://${render.id}.mp4`,
        completedAt: new Date(Date.now() - 30_000),
      })
      await updateShort(db, row.id, { renderId: render.id, relatedLinkChecked: true })
    }

    await setProjectStage(db, projectId, {
      stage: 'shorts',
      stageStatus: 'awaiting_review',
      shortsPhase: 'review',
    })
  })
}
