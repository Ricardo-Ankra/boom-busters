import type { SearchBrief } from '@boom-busters/schemas'
import { expect, test, type Page } from '@playwright/test'
import { channelPath, expectHitTargets, signIn } from './fixtures'

/**
 * Case research from subject to frozen brief (VidIQ case research design),
 * driven through visible labelled buttons on the first channel.
 *
 * No Inngest Dev Server runs in this suite, so the research run cannot start:
 * the action answers with the honest "Could not reach Inngest" copy and marks
 * the job failed. The test presses the real button and asserts that refusal.
 * What the runner would then have left (a finished search brief, as the mock
 * VidIQ client and the model steps would shape it) is written straight to the
 * database, the way bible.spec.ts leaves a drafted bible, and everything after
 * it is read and pressed through the real screens.
 *
 * Runs in order within this file (workers: 1). The case, and the project the
 * last test starts from it, are removed afterwards.
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const SUBJECT = 'Iomega Zip Drive (E2E case research)'
const TARGET = 'iomega zip drive'
const SECONDARY = 'zip drive click of death'
const FIRST_ANGLE =
  'The click of death was a hardware failure that spread from one drive to another.'
const SECOND_ANGLE =
  'The Zip drive sold forty million disks, and the click of death took the blame for the end.'

/** What a research run would have stored for the case. */
function seededBrief(measuredAt: string): SearchBrief {
  return {
    subject: SUBJECT,
    measuredAt,
    targetKeyword: {
      keyword: TARGET,
      volume: 61,
      competition: 28,
      overall: 72,
      estimatedMonthlySearch: 3400,
      growthPct: 4,
    },
    secondaryKeywords: [
      {
        keyword: SECONDARY,
        volume: 44,
        competition: 19,
        overall: 70,
        estimatedMonthlySearch: 1900,
        growthPct: 2,
      },
    ],
    searchedQuestions: ['what was the click of death', 'why did zip drives fail'],
    outliers: [
      {
        videoId: 'e2eoutlier01',
        title: 'The Click of Death, Explained',
        channel: 'Retro Hardware Lab',
        subscribers: 120_000,
        views: 1_800_000,
        breakoutScore: 14,
        publishedAt: '2024-03-01T00:00:00.000Z',
        tags: ['zip drive', 'iomega'],
      },
    ],
    titlePatterns: ['The ___ That ___'],
    toldAlready: ['A 2019 retrospective on the Zip format'],
    angleOptions: [
      {
        angle: FIRST_ANGLE,
        keyword: TARGET,
        answers: ['what was the click of death'],
        gap: 'Existing videos show the sound, not the cause.',
      },
      {
        angle: SECOND_ANGLE,
        keyword: SECONDARY,
        answers: ['why did zip drives fail'],
        gap: 'No video ties the sales figure to the failure story.',
      },
    ],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: null,
    recommendationReason: null,
    ownAngle: false,
  }
}

async function withDb<T>(
  work: (connection: Awaited<ReturnType<typeof open>>) => Promise<T>,
): Promise<T> {
  const connection = await open()
  try {
    return await work(connection)
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

async function open() {
  const { createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  return createDb(e2eDatabaseUrl(), { max: 1 })
}

/** What the runner leaves: the brief stored, the job done. */
async function leaveBrief(measuredAt: string): Promise<void> {
  const brief = seededBrief(measuredAt)
  await withDb(async ({ sql }) => {
    const job = {
      state: 'done',
      current: null,
      error: null,
      startedAt: measuredAt,
      subject: SUBJECT,
    }
    await sql`update cases
      set search_brief = ${JSON.stringify(brief)}::text::jsonb,
        search_job = ${JSON.stringify(job)}::text::jsonb
      where subject = ${SUBJECT}`
  })
}

async function removeCase(): Promise<void> {
  await withDb(async ({ sql }) => {
    await sql`delete from projects where case_id in (select id from cases where subject = ${SUBJECT})`
    await sql`delete from cases where subject = ${SUBJECT}`
  })
}

const row = (page: Page) => page.getByRole('listitem').filter({ hasText: SUBJECT })

async function openBrief(page: Page): Promise<void> {
  await page.goto(channelPath('/cases'))
  await row(page).getByText('Search brief', { exact: true }).click()
}

async function addCaseBySubject(page: Page): Promise<void> {
  await page.goto(channelPath('/cases'))
  await page.getByRole('button', { name: 'Add case' }).click()
  await page.getByLabel('Subject').fill(SUBJECT)
  await page.getByRole('button', { name: 'Save case' }).click()
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** The cap in force before this file ran, so afterAll can put it back. */
let capBefore: number | null = null

/**
 * The spec presses Research with VidIQ, which refuses when the month's credits
 * are spent. Spend left by earlier runs, or a cap another spec lowered, must
 * not decide that: it clears this month's rows and sets the cap itself.
 */
async function startFromCleanCredits(): Promise<void> {
  const { getWorkspace, updateWorkspace } = await import('@boom-busters/db')
  await withDb(async ({ db, sql }) => {
    capBefore ??= (await getWorkspace(db)).settings.vidiq.monthlyCreditCap
    await sql`delete from vidiq_credits
      where occurred_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`
    await updateWorkspace(db, { vidiq: { monthlyCreditCap: 1000 } })
  })
}

async function restoreCap(): Promise<void> {
  if (capBefore === null) return
  const { updateWorkspace } = await import('@boom-busters/db')
  const cap = capBefore
  await withDb(({ db }) => updateWorkspace(db, { vidiq: { monthlyCreditCap: cap } }))
}

// A CI retry reruns the serial group: start it from a clean slate.
test.beforeAll(async () => {
  await removeCase()
  await startFromCleanCredits()
})

test.afterAll(async () => {
  await removeCase()
  await restoreCap()
})

test.describe('case research', () => {
  test('adds a case by subject and refuses the same subject twice', async ({ page }) => {
    await addCaseBySubject(page)
    await expect(page.getByText('Case added to your backlog').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(row(page)).toBeVisible()

    await addCaseBySubject(page)
    await expect(page.getByText('A case for this subject already exists').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(row(page)).toHaveCount(1)
  })

  test('Research with VidIQ shows its estimate and says plainly that Inngest is missing', async ({
    page,
  }) => {
    await page.goto(channelPath('/cases'))
    await row(page)
      .getByRole('button', { name: /^Research with VidIQ/ })
      .click()
    await expect(row(page).getByText(/About 20 credits/)).toBeVisible({ timeout: 15_000 })

    await row(page).getByRole('button', { name: 'Start research' }).click()
    await expect(page.getByText(/Could not reach Inngest/).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByText('Research failed: The research run could not be started'),
    ).toBeVisible({
      timeout: 15_000,
    })
  })

  test('choosing an angle sets it on the case and rewrites the demand line', async ({ page }) => {
    await leaveBrief(new Date().toISOString())
    await openBrief(page)
    await expect(row(page).getByText(`for ${SUBJECT}`)).toBeVisible()

    await row(page)
      .getByRole('listitem')
      .filter({ hasText: FIRST_ANGLE })
      .getByRole('button', { name: 'Use this angle' })
      .click()
    await expect(page.getByText('Angle chosen').first()).toBeVisible({ timeout: 15_000 })

    await expect(row(page).getByText('Chosen', { exact: true })).toBeVisible()
    // The row's own angle line now carries the chosen angle.
    await expect(row(page).getByText(FIRST_ANGLE).first()).toBeVisible()

    const stored = await withDb(
      ({ sql }) =>
        sql<{ angle: string; demand_notes: string }[]>`
          select angle, demand_notes from cases where subject = ${SUBJECT}`,
    )
    expect(stored[0]?.angle).toBe(FIRST_ANGLE)
    expect(stored[0]?.demand_notes).toContain(`${TARGET}: 61 volume, competition 28`)
    expect(stored[0]?.demand_notes).toMatch(/; 1 winning video(?!s)/)
  })

  test('Make target promotes a secondary keyword', async ({ page }) => {
    await openBrief(page)
    await row(page)
      .getByRole('listitem')
      .filter({ hasText: SECONDARY })
      .getByRole('button', { name: 'Make target' })
      .click()
    await expect(page.getByText('Target keyword set').first()).toBeVisible({ timeout: 15_000 })

    const stored = await withDb(
      ({ sql }) =>
        sql<{ brief: SearchBrief }[]>`
          select search_brief as brief from cases where subject = ${SUBJECT}`,
    )
    expect(stored[0]?.brief.targetKeyword?.keyword).toBe(SECONDARY)
    expect(stored[0]?.brief.secondaryKeywords.map((k) => k.keyword)).toContain(TARGET)
  })

  test('at 390 px the brief has no sideways scroll and every control is 40 px tall', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openBrief(page)
    await expect(row(page).getByText('Target keyword', { exact: true })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await expectHitTargets(page)
  })

  test('a stale brief asks before a project starts, and Start without refreshing freezes it', async ({
    page,
  }) => {
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString()
    await leaveBrief(old)
    await page.goto(channelPath('/cases'))

    await row(page).getByRole('button', { name: 'New project' }).click()
    await expect(row(page).getByText('The search research is 45 days old.')).toBeVisible()
    await expect(row(page).getByRole('button', { name: /^Refresh research/ })).toBeVisible()

    await row(page).getByRole('button', { name: 'Start without refreshing' }).click()
    // No Inngest here, so the project is made but nothing researches it.
    await expect(page.getByText(/nothing is researching it/i).first()).toBeVisible({
      timeout: 15_000,
    })

    const frozen = await withDb(
      ({ sql }) =>
        sql<{ brief: SearchBrief | null }[]>`
          select p.search_brief as brief
          from projects p join cases c on c.id = p.case_id
          where c.subject = ${SUBJECT}`,
    )
    expect(frozen).toHaveLength(1)
    expect(frozen[0]?.brief?.subject).toBe(SUBJECT)
    expect(frozen[0]?.brief?.measuredAt).toBe(old)
  })
})
