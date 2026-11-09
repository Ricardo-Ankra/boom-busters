import { expect, test } from '@playwright/test'
import { OUTCOME_COPY } from '@boom-busters/schemas'
import type { SearchReport } from '@boom-busters/schemas'
import { signIn } from './fixtures'

/**
 * The search report card on the publish screen: a live master with frozen
 * day 7 and day 28 reports, read back through the visible Day buttons.
 * Mock mode, no spend: the reports are frozen straight into the table, as
 * the analytics runner would leave them.
 *
 * The project is this file's own (created here, removed afterwards), so the
 * publish flow's fixture and its record counts stay untouched.
 */

const TITLE = 'Search report, live master (E2E)'
const VIDEO_ID = 'mock-e2e-search-report'
const PUBLISHED = '2026-09-01T10:00:00.000Z'

let projectId = ''
let day7: SearchReport
let day28: SearchReport

async function seed(): Promise<void> {
  const {
    createDb,
    createProjectFromCase,
    ensurePublishRecord,
    updatePublishRecord,
    setProjectStage,
    pendingReport,
    freezeSearchReport,
    FIXTURE_CASE_ID,
  } = await import('@boom-busters/db')
  const { buildSearchReport, DEFAULT_RESEARCH_THRESHOLDS, FIRST_CHANNEL_ID } =
    await import('@boom-busters/schemas')
  const { e2eDatabaseUrl } = await import('../database')

  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    const project = await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: TITLE,
    })
    projectId = project.id
    await setProjectStage(connection.db, project.id, {
      stage: 'publish',
      stageStatus: 'awaiting_review',
    })
    const record = await ensurePublishRecord(connection.db, 'master', project.id)
    await updatePublishRecord(connection.db, record.id, {
      status: 'live',
      youtubeVideoId: VIDEO_ID,
      publishAt: new Date(PUBLISHED),
    })

    const common = {
      publishedAt: PUBLISHED,
      durationSec: 840,
      avgViewDurationSec: 210,
      subscribersGained: 4,
      likes: 30,
      comments: 5,
      retentionCurve: null,
      targetKeyword: 'wirecard scandal',
      matching: 'full' as const,
      rank: null,
      baselineInputs: {
        holdBand: [],
        holdChannel: [],
        dropBand: [],
        dropChannel: [],
        subsBand: [],
        subsChannel: [],
      },
      thresholds: DEFAULT_RESEARCH_THRESHOLDS,
    }

    // Day 7: under 100 views, so it reads "Too early".
    day7 = buildSearchReport({
      ...common,
      checkpoint: 7,
      range: { start: '2026-09-01', end: '2026-09-08' },
      views: 60,
      searchViews: 20,
      terms: [{ term: 'wirecard scandal', views: 12, minutes: 30, bucket: 'target' }],
      now: new Date('2026-09-11T06:00:00.000Z'),
    })
    // Day 28: plenty of views, mostly search, the target holds the top term.
    day28 = buildSearchReport({
      ...common,
      checkpoint: 28,
      range: { start: '2026-09-01', end: '2026-09-29' },
      views: 4_000,
      searchViews: 1_600,
      terms: [
        { term: 'wirecard scandal', views: 900, minutes: 2_700, bucket: 'target' },
        { term: 'wirecard auditors', views: 300, minutes: 900, bucket: 'unresearched' },
        { term: 'ey wirecard', views: 120, minutes: 300, bucket: 'unresearched' },
      ],
      now: new Date('2026-10-02T06:00:00.000Z'),
    })

    for (const report of [day7, day28]) {
      const row = await pendingReport(connection.db, {
        channelId: FIRST_CHANNEL_ID,
        projectId: project.id,
        videoId: VIDEO_ID,
        checkpoint: report.checkpoint,
      })
      await freezeSearchReport(connection.db, row.id, report)
    }
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

async function cleanUp(): Promise<void> {
  if (!projectId) return
  const { createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    await connection.sql`delete from search_reports where project_id = ${projectId}`
    await connection.sql`delete from publish_records where target_id = ${projectId}`
    await connection.sql`delete from projects where id = ${projectId}`
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

test.setTimeout(120_000)

test.beforeAll(async () => {
  await seed()
})

test.afterAll(async () => {
  await cleanUp()
})

test.describe('the search report card', () => {
  test('Day 7 shows its outcome and the whole video label, apart from Day 28', async ({ page }) => {
    await signIn(page)
    await page.goto(`/projects/${projectId}?stage=publish`)

    await expect(page.getByText('Search report', { exact: true })).toBeVisible({
      timeout: 30_000,
    })

    // Opens on the latest frozen day.
    expect(OUTCOME_COPY[day28.outcome].label).not.toBe(OUTCOME_COPY[day7.outcome].label)
    await expect(page.getByText(OUTCOME_COPY[day28.outcome].label, { exact: true })).toBeVisible()

    // Switch to Day 7: its own verdict, and the engagement lines say "whole video".
    await page.getByRole('button', { name: 'Day 7', exact: true }).click()
    await expect(page.getByText(OUTCOME_COPY[day7.outcome].label, { exact: true })).toBeVisible()
    await expect(page.getByText(/\(whole video\)/).first()).toBeVisible()

    // Day 90 is not frozen, so its button is disabled.
    await expect(page.getByRole('button', { name: 'Day 90', exact: true })).toBeDisabled()
  })
})
