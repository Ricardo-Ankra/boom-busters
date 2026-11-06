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
/** A searched video title: the colon marks it, so it is kept apart from the keywords. */
const COLON_TITLE = 'Zip Drive: The Click of Death Explained'
/** A row with a figure in it: shown, but it cannot become the target. */
const FIGURE_ROW = 'zip drive 100mb'
const OFF_ROW = 'zip drive repair near me'
const FIRST_ANGLE =
  'The click of death was a hardware failure that spread from one drive to another.'
const SECOND_ANGLE =
  'The Zip drive sold forty million disks, and the click of death took the blame for the end.'

/** Ten ranking videos, one from a small channel with real views: the field's single open door. */
function fieldResults() {
  return Array.from({ length: 10 }, (_, i) => ({
    videoId: `e2efield${String(i).padStart(2, '0')}`,
    title: `Zip drive video ${i + 1}`,
    channelTitle: i === 0 ? 'Small Retro Channel' : `Big Channel ${i}`,
    subscribers: i === 0 ? 40_000 : 900_000 + i * 1000,
    views: i === 0 ? 50_000 : 4_000 + i,
    publishedAt: '2025-09-01T00:00:00.000Z',
    seconds: 600 + i,
  }))
}

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
      intent: 'wants to know what the drive was and why it mattered',
      fit: 'fits',
      topic: 'zip drive',
    },
    secondaryKeywords: [
      {
        keyword: SECONDARY,
        volume: 44,
        competition: 19,
        overall: 70,
        estimatedMonthlySearch: 1900,
        growthPct: 2,
        intent: 'wants the cause of the click of death',
        fit: 'fits',
        topic: 'zip drive',
      },
      {
        keyword: FIGURE_ROW,
        volume: 20,
        competition: 15,
        overall: 60,
        estimatedMonthlySearch: 800,
        growthPct: 1,
        intent: 'wants the 100 MB disk',
        fit: 'partly',
        topic: 'zip drive',
      },
      {
        keyword: COLON_TITLE,
        volume: null,
        competition: null,
        overall: 75,
        estimatedMonthlySearch: 2600,
        growthPct: 9,
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
    fit: { inScope: true, pillarKey: null, reason: 'Retro hardware is in scope.' },
    language: 'en',
    niche: 'retro computer hardware',
    offIntent: [
      {
        keyword: OFF_ROW,
        volume: 5,
        competition: 3,
        overall: 55,
        estimatedMonthlySearch: 300,
        growthPct: 0,
        intent: 'wants a repair shop, not a story',
        fit: 'off',
        topic: 'repairs',
      },
    ],
    fieldChecks: [{ keyword: TARGET, checkedAt: measuredAt, results: fieldResults() }],
    commentThemes: [
      {
        theme: 'Viewers want the real cause of the click of death',
        count: 12,
        quote: 'Nobody ever explained why the heads failed.',
        videoId: 'e2eoutlier01',
      },
      {
        theme: 'Viewers ask how many Zip disks were sold',
        count: 7,
        quote: null,
        videoId: 'e2eoutlier01',
      },
    ],
    commentsRead: { videos: 1, comments: 240 },
    nicheTests: [
      {
        angle: FIRST_ANGLE,
        verdict: 'Retro hardware fans do ask about this failure.',
        direct: true,
        evidence: [{ text: 'Forum threads on the click of death', count: 31 }],
        notes: '',
      },
    ],
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

/** The case's row in the list: a link that opens its panel. */
const row = (page: Page) => page.getByRole('listitem').filter({ hasText: SUBJECT })

/** The open case's panel, named by its title (a case added by subject is titled by it). */
const panel = (page: Page) => page.getByRole('region', { name: SUBJECT })

async function openCase(page: Page): Promise<void> {
  await page.goto(channelPath('/cases'))
  await row(page).getByRole('link').click()
  await expect(page).toHaveURL(/[?&]case=/)
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
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
    // The list refreshes after the toast; a cold dev server can take longer than the default wait.
    await expect(row(page)).toBeVisible({ timeout: 15_000 })

    await addCaseBySubject(page)
    await expect(page.getByText('A case for this subject already exists').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(row(page)).toHaveCount(1)
  })

  test('Research with VidIQ shows its estimate and says plainly that Inngest is missing', async ({
    page,
  }) => {
    await openCase(page)
    await panel(page)
      .getByRole('button', { name: /^Research with VidIQ/ })
      .click()
    await expect(panel(page).getByText(/About 55 credits/)).toBeVisible({ timeout: 15_000 })

    await panel(page).getByRole('button', { name: 'Start research' }).click()
    await expect(page.getByText(/Could not reach Inngest/).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByText('Research failed: The research run could not be started').first(),
    ).toBeVisible({
      timeout: 15_000,
    })
  })

  test('the panel keeps titles apart, makes a target, rates the angles and takes one', async ({
    page,
  }) => {
    await leaveBrief(new Date().toISOString())
    await openCase(page)

    // The target card carries its labelled figures.
    const card = panel(page).getByTestId('target-card')
    await expect(card.getByText(TARGET, { exact: true })).toBeVisible()
    await expect(card.getByText('Searches a month', { exact: true })).toBeVisible()
    await expect(card.getByText('~3,400')).toBeVisible()
    await expect(card.getByTestId('volume')).toContainText('61')
    await expect(card.getByText('moderate')).toBeVisible()
    await expect(card.getByTestId('competition')).toContainText('28')
    await expect(card.getByText('low')).toBeVisible()
    await expect(card.getByText('Trend')).toBeVisible()

    // The colon title is a searched video title, not a keyword: no Make target.
    const titles = panel(page).getByRole('heading', { name: 'Searched video titles' }).locator('..')
    await expect(titles.getByText(COLON_TITLE)).toBeVisible()
    await expect(
      panel(page).getByRole('button', { name: `Make target: ${COLON_TITLE}` }),
    ).toHaveCount(0)
    await expect(panel(page).getByRole('table').getByText(COLON_TITLE)).toHaveCount(0)

    // The verdict card names its five checks, each with the reason in words.
    const verdict = panel(page).getByRole('region', { name: 'Verdict' })
    await expect(verdict.getByRole('listitem')).toHaveCount(5)
    await expect(verdict).toContainText(`Searchers for "${TARGET}" want what this channel makes`)
    await expect(verdict).toContainText('2 comment themes found, none tied to this angle')
    await expect(verdict).toContainText('The subject is in scope for this channel')
    await expect(verdict).toContainText('6,100 searches a month for zip drive')
    await expect(verdict).toContainText(`1 open door in the top 10 for "${TARGET}"`)

    // Who ranks now marks the one open door; the other nine are not marked.
    const field = panel(page).getByRole('list', { name: `Who ranks for ${TARGET}` })
    await expect(field.getByRole('listitem')).toHaveCount(10)
    await expect(field.getByText('Open door', { exact: true })).toHaveCount(1)
    await expect(
      field.getByRole('listitem').filter({ hasText: 'Small Retro Channel' }),
    ).toContainText('Open door')

    // A row with a figure says why it cannot be the target; one that does not fit sits apart.
    await expect(panel(page).getByText("Has a figure, can't be the target")).toBeVisible()
    await expect(
      panel(page).getByRole('button', { name: `Make target: ${FIGURE_ROW}` }),
    ).toHaveCount(0)
    await expect(panel(page).getByText("Doesn't fit this channel").last()).toBeVisible()

    // The comment themes and the niche test sit behind and beside the angles.
    await expect(panel(page).getByText('2 themes')).toBeVisible()
    await expect(
      panel(page).getByText('Retro hardware fans do ask about this failure.'),
    ).toBeVisible()

    // A real secondary keyword can become the target.
    await panel(page)
      .getByRole('button', { name: `Make target: ${SECONDARY}` })
      .click()
    await expect(page.getByText('Target keyword set').first()).toBeVisible({ timeout: 15_000 })
    await expect(panel(page).getByTestId('target-card').getByText(SECONDARY)).toBeVisible({
      timeout: 15_000,
    })

    // Rate the angles, confirm (mock mode), and a Recommended badge appears.
    await panel(page).getByRole('button', { name: 'Rate the angles' }).click()
    await panel(page).getByRole('button', { name: 'Rate now' }).click()
    await expect(page.getByText('Angles rated').first()).toBeVisible({ timeout: 15_000 })
    await expect(panel(page).getByText('Recommended', { exact: true })).toBeVisible()

    // Take the first angle: the list row says so.
    await panel(page)
      .getByRole('button', { name: /^Use this angle: The click of death was a hardware/ })
      .click()
    // That angle's keyword is a secondary now, so choosing it moves the target back, and says so.
    await expect(page.getByText(`Target keyword is now ${TARGET}`).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(row(page).getByText('Angle chosen')).toBeVisible()
    await expect(panel(page).getByText('Chosen', { exact: true })).toBeVisible()

    const stored = await withDb(
      ({ sql }) =>
        sql<{ angle: string; demand_notes: string; brief: SearchBrief }[]>`
          select angle, demand_notes, search_brief as brief
          from cases where subject = ${SUBJECT}`,
    )
    expect(stored[0]?.angle).toBe(FIRST_ANGLE)
    expect(stored[0]?.demand_notes).toContain(`${TARGET}: 61 volume, competition 28`)
    expect(stored[0]?.demand_notes).toMatch(/; 1 winning video(?!s)/)
    expect(stored[0]?.brief.targetKeyword?.keyword).toBe(TARGET)
    expect(stored[0]?.brief.secondaryKeywords.map((k) => k.keyword)).toContain(SECONDARY)
    expect(stored[0]?.brief.secondaryKeywords.map((k) => k.keyword)).not.toContain(COLON_TITLE)
    expect(stored[0]?.brief.recommendedAngle).not.toBeNull()
  })

  test('at 390 px the panel has no sideways scroll and every control is 40 px tall', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openCase(page)
    await expect(panel(page).getByText('Target keyword', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to cases' })).toBeVisible()

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
    await openCase(page)

    await panel(page).getByRole('button', { name: 'New project' }).click()
    await expect(panel(page).getByText('The search research is 45 days old.')).toBeVisible()
    await expect(panel(page).getByRole('button', { name: /^Refresh research/ })).toBeVisible()

    await panel(page).getByRole('button', { name: 'Start without refreshing' }).click()
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
