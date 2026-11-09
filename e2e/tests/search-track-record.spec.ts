import { expect, test } from '@playwright/test'
import { channelPath, signIn } from './fixtures'

/**
 * The Search track record panel in the Case Library: five published videos on
 * the first channel, each with a frozen research verdict that warned on demand
 * and a frozen day-28 report that was found for its target, with the target
 * under 1,000 searches a month. That supports one suggestion, lowering the
 * demand warning line from 1,000 to 500. The test opens the panel, presses
 * Apply and reads the applied value back with its Reset to default button.
 *
 * Mock mode, no spend: verdicts, briefs and reports are written straight into
 * the tables, as the research and analytics runners would leave them. The
 * projects, their reports and the channel's tuning rows are this file's own
 * and are removed afterwards.
 */

const SEARCHES = [300, 400, 500, 600, 700]
const PUBLISHED = '2026-09-01T10:00:00.000Z'

let projectIds: string[] = []

async function seed(): Promise<void> {
  const { createDb, createProjectFromCase, pendingReport, freezeSearchReport, FIXTURE_CASE_ID } =
    await import('@boom-busters/db')
  const { buildSearchReport, DEFAULT_RESEARCH_THRESHOLDS, FIRST_CHANNEL_ID } =
    await import('@boom-busters/schemas')
  const { e2eDatabaseUrl } = await import('../database')

  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    for (const [i, searches] of SEARCHES.entries()) {
      const title = `Track record video ${i + 1} (E2E)`
      const videoId = `mock-e2e-track-record-${i + 1}`
      const project = await createProjectFromCase(connection.db, {
        caseId: FIXTURE_CASE_ID,
        title,
      })
      projectIds.push(project.id)

      const brief = {
        subject: title,
        measuredAt: PUBLISHED,
        targetKeyword: {
          keyword: 'wirecard scandal',
          volume: 1,
          competition: 1,
          overall: 1,
          estimatedMonthlySearch: searches,
          growthPct: null,
          fit: 'fits',
          intent: 'how it collapsed',
          topic: 'collapse',
        },
        secondaryKeywords: [],
        searchedQuestions: [],
        outliers: [],
        titlePatterns: [],
        toldAlready: [],
        angleOptions: [],
        chosenAngle: null,
        formatKey: null,
        fit: null,
        searchedTitles: [],
        otherLanguages: [],
        recommendedAngle: null,
        recommendationReason: null,
        ownAngle: false,
        fieldChecks: [],
      }
      const verdict = {
        lines: [{ check: 'demand', state: 'warn', reason: 'Few searches a month.' }],
        thresholds: { ...DEFAULT_RESEARCH_THRESHOLDS },
        frozenAt: PUBLISHED,
      }
      await connection.sql`
        update projects
        set search_brief = ${JSON.stringify(brief)}::text::jsonb,
            research_verdict = ${JSON.stringify(verdict)}::text::jsonb
        where id = ${project.id}`

      const report = buildSearchReport({
        checkpoint: 28,
        range: { start: '2026-09-01', end: '2026-09-29' },
        publishedAt: PUBLISHED,
        durationSec: 840,
        views: 4_000,
        searchViews: 1_600,
        avgViewDurationSec: 210,
        subscribersGained: 4,
        likes: 30,
        comments: 5,
        retentionCurve: null,
        terms: [
          { term: 'wirecard scandal', views: 900, minutes: 2_700, bucket: 'target' },
          { term: 'wirecard auditors', views: 300, minutes: 900, bucket: 'unresearched' },
        ],
        targetKeyword: 'wirecard scandal',
        matching: 'full',
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
        now: new Date('2026-10-02T06:00:00.000Z'),
      })
      expect(report.foundForTarget).toBe(true)
      const row = await pendingReport(connection.db, {
        channelId: FIRST_CHANNEL_ID,
        projectId: project.id,
        videoId,
        checkpoint: 28,
      })
      await freezeSearchReport(connection.db, row.id, report)
    }
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

async function cleanUp(): Promise<void> {
  const { createDb } = await import('@boom-busters/db')
  const { FIRST_CHANNEL_ID } = await import('@boom-busters/schemas')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    await connection.sql`delete from research_tuning where channel_id = ${FIRST_CHANNEL_ID}`
    await connection.sql`delete from research_suggestion_dismissals where channel_id = ${FIRST_CHANNEL_ID}`
    if (projectIds.length > 0) {
      await connection.sql`delete from search_reports where project_id in ${connection.sql(projectIds)}`
      await connection.sql`delete from projects where id in ${connection.sql(projectIds)}`
    }
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

test.describe('the search track record panel', () => {
  test('a demand suggestion is applied and shows its value with Reset to default', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(channelPath('/cases'))

    await page.getByRole('button', { name: 'Search track record', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Search track record' })).toBeVisible({
      timeout: 30_000,
    })

    await expect(page.getByText(/Lower the warning line to 500\?/)).toBeVisible()
    await expect(page.getByText('Demand warning line: 1,000 to 500, from 5 videos')).toBeVisible()

    await page.getByRole('button', { name: 'Apply', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Applied values' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/Demand warning line: 500, was 1,000/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reset to default' })).toBeVisible()
  })
})
