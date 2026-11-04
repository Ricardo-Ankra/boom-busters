import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { Database } from '@boom-busters/db'
import type { BibleResearchDigest, ChannelBible } from '@boom-busters/schemas'
import { expect, test, type Page } from '@playwright/test'
import { channelPath, expectHitTargets, SECOND_SLUG, signIn } from './fixtures'

/**
 * A second channel's bible, drafted, approved, saved, frozen into a project
 * and moved forward (bible drafting design, section 9), driven through
 * visible labelled buttons on `e2e-second`.
 *
 * No Inngest Dev Server runs in this suite, so neither the research run nor
 * the drafting run can start: the actions answer with the honest "Could not
 * reach Inngest" copy and mark the run failed. The tests press the real
 * buttons and assert that refusal. What the runners would then have left (the
 * research digest and the seven sections drafted from the mock provider's
 * answers; Voice drafted again after a steer) is written straight to the
 * database, the way playbook-shorts.spec.ts does, and everything after it is
 * read and pressed through the real screens.
 *
 * Runs in order within this file (workers: 1). The channel is put back to its
 * blank state afterwards, because channels.spec.ts, which runs later, expects
 * a second channel that starts with an empty bible and no project.
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const SECTION_LABELS = [
  'Identity',
  'Formats',
  'Voice',
  'Look',
  'Examples',
  'Hooks, openings and titles',
  'Search',
  'Publishing',
] as const

const CASE_TITLE = 'A psychology case for the second channel (E2E)'
const REDRAFTED_REGISTER = 'warm, precise, unhurried, with a dry aside now and then'
const VOICE_EDIT = ' Edited by hand in the Bible tab.'

const bibleTab = channelPath('/settings?tab=bible', SECOND_SLUG)

/** The draft's chips: how many sections currently read the given status. */
function chips(page: Page, status: 'Drafted, not approved' | 'Approved') {
  return page.getByText(status, { exact: true })
}

/** The save bar keeps what stops Save behind a button; open it if it is shut. */
async function showWhatToFix(page: Page): Promise<void> {
  const show = page.getByRole('button', { name: 'Show what to fix' })
  if (await show.isVisible()) await show.click()
}

async function openCard(page: Page, label: string): Promise<void> {
  const summary = page.locator('summary').filter({ hasText: label })
  const details = page.locator('details').filter({ has: summary })
  if ((await details.getAttribute('open')) === null) await summary.click()
}

async function withDb<T>(work: (db: Database, channelId: string) => Promise<T>): Promise<T> {
  const { createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    const [row] = await connection.sql<{ id: string }[]>`
      select id from channels where slug = ${SECOND_SLUG}`
    if (!row) throw new Error('the second channel was not seeded')
    return await work(connection.db, row.id)
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

/**
 * The mock provider's answers, read from a child process (see
 * `e2e/mock-bible.ts` for why it cannot be imported here).
 */
function mockDraft(): { bible: ChannelBible; digest: BibleResearchDigest } {
  const repoRoot = path.join(import.meta.dirname, '..', '..')
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join(import.meta.dirname, '..', 'mock-bible.ts')],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  if (result.status !== 0) throw new Error(`the mock bible could not be built: ${result.stderr}`)
  return JSON.parse(result.stdout) as { bible: ChannelBible; digest: BibleResearchDigest }
}

/**
 * What the research run and the drafting run leave: the digest, every section
 * drafted from the mock provider's answers, nothing flagged, the job done.
 */
async function leaveDraftedBible(): Promise<void> {
  const mock = mockDraft()
  await withDb(async (db, channelId) => {
    const { writeBibleDraft } = await import('@boom-busters/db')
    await writeBibleDraft(
      db,
      channelId,
      (draft) => {
        if (!draft.inputs) throw new Error('the Start press did not save the inputs')
        return {
          ...draft,
          // The mock draft leaves the starting format untouched, which reads Empty; name a keyword.
          bible: {
            ...mock.bible,
            formats: mock.bible.formats.map((format) => ({
              ...format,
              keywords: ['psychology cases'],
            })),
          },
          statuses: {
            identity: 'drafted',
            formats: 'drafted',
            voice: 'drafted',
            look: 'drafted',
            examples: 'drafted',
            hooks: 'drafted',
            search: 'drafted',
            publishing: 'drafted',
          },
          tooClose: {},
          errors: {},
          research: mock.digest,
          job: {
            kind: 'draft',
            state: 'done',
            current: null,
            error: null,
            startedAt: new Date().toISOString(),
          },
        }
      },
      { allowWhileRunning: true },
    )
  })
}

/** What a Voice redraft with a steer leaves: the register reworded, Voice drafted again. */
async function leaveRedraftedVoice(): Promise<void> {
  await withDb(async (db, channelId) => {
    const { writeBibleDraft } = await import('@boom-busters/db')
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({
        ...draft,
        bible: { ...draft.bible, narrationRegister: REDRAFTED_REGISTER },
        statuses: { ...draft.statuses, voice: 'drafted' },
        job: {
          kind: 'draft',
          state: 'done',
          current: null,
          error: null,
          startedAt: new Date().toISOString(),
        },
      }),
      { allowWhileRunning: true },
    )
  })
}

/** The second channel as global setup leaves it: a blank bible, no project, no case, no draft. */
async function resetSecondChannel(): Promise<void> {
  const { createDb, createChannel } = await import('@boom-busters/db')
  const { DEFAULT_SETTINGS, EMPTY_BIBLE } = await import('@boom-busters/schemas')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    const slug = SECOND_SLUG
    await connection.sql`delete from projects where channel_id in (select id from channels where slug = ${slug})`
    await connection.sql`delete from cases where channel_id in (select id from channels where slug = ${slug})`
    // vidiq_credits.channel_id restricts, so the ledger rows go before the channel.
    await connection.sql`delete from vidiq_credits where channel_id in (select id from channels where slug = ${slug})`
    await connection.sql`delete from bible_drafts where channel_id in (select id from channels where slug = ${slug})`
    await connection.sql`update channels set current_bible_id = null where slug = ${slug}`
    await connection.sql`delete from channel_bibles where channel_id in (select id from channels where slug = ${slug})`
    await connection.sql`delete from youtube_connections where channel_id in (select id from channels where slug = ${slug})`
    await connection.sql`delete from channels where slug = ${slug}`
    await createChannel(connection.db, {
      name: 'Second Channel',
      handle: null,
      slug,
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

async function saveDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved as a new version').first()).toBeVisible({ timeout: 15_000 })
}

async function openHistory(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'History', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

// A CI retry reruns the serial group: start it from the state global setup leaves.
test.beforeAll(async () => {
  await resetSecondChannel()
})

test.afterAll(async () => {
  await resetSecondChannel()
})

test.describe('a second channel’s bible', () => {
  test('Draft with AI: the research cannot start without Inngest, and says so', async ({
    page,
  }) => {
    await page.goto(bibleTab)
    await expect(page.getByText('Version 1 is what the channel runs on.')).toBeVisible()

    await page.getByRole('button', { name: 'Draft with AI' }).click()
    await page
      .getByLabel('Describe the channel in a few lines')
      .fill('The psychology of everyday decisions: landmark experiments and the biases they found.')
    await page.getByLabel('Who is it for?').fill('Curious adults who read popular science.')
    await page.getByLabel('Channels you admire').fill(['@veritasium', '@kurzgesagt'].join('\n'))
    await page
      .getByLabel('Videos that feel right')
      .fill('https://www.youtube.com/watch?v=TZIC1sL9XTk')
    await page.getByLabel("Anything you don't want").fill('Clickbait and pop-psychology jargon')

    // Mock mode stands in for the VidIQ key: the estimate shows before any spend.
    await page.getByRole('button', { name: 'Research with VidIQ, then draft' }).click()
    await expect(page.getByText(/^About [\d,]+ VidIQ credits\. Balance: [\d,]+\.$/)).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: 'Start', exact: true }).click()

    // Nothing can run it here: the refusal is in words, and the run is marked failed.
    await expect(
      page.getByText(/Could not reach Inngest to start the research/).first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('The research run could not be started')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('every section reads Drafted, not approved once the run has written them', async ({
    page,
  }) => {
    await leaveDraftedBible()
    await page.goto(bibleTab)

    await expect(chips(page, 'Drafted, not approved')).toHaveCount(SECTION_LABELS.length)
    await expect(chips(page, 'Approved')).toHaveCount(0)
    // Saving is refused while anything is still only drafted.
    await showWhatToFix(page)
    await expect(page.getByText('Identity is drafted, not approved')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  })

  test('Redraft Voice with a steer: refused in words without Inngest, then it lands drafted', async ({
    page,
  }) => {
    await page.goto(bibleTab)
    await page.getByRole('button', { name: 'Redraft Voice', exact: true }).click()
    await page.getByLabel('What should change?').fill('A little drier, with an aside now and then')
    await page.getByRole('button', { name: 'Start redraft of Voice', exact: true }).click()
    await expect(
      page.getByText(/Could not reach Inngest to start the drafting/).first(),
    ).toBeVisible({ timeout: 15_000 })

    await leaveRedraftedVoice()
    await page.reload()
    await openCard(page, 'Voice')
    await expect(page.getByText(REDRAFTED_REGISTER)).toBeVisible()
    await expect(chips(page, 'Drafted, not approved')).toHaveCount(SECTION_LABELS.length)
  })

  test('approving every section and saving makes version 2, and History lists both', async ({
    page,
  }) => {
    await page.goto(bibleTab)

    for (const [index, label] of SECTION_LABELS.entries()) {
      await page.getByRole('button', { name: `Approve ${label}`, exact: true }).click()
      await expect(chips(page, 'Drafted, not approved')).toHaveCount(
        SECTION_LABELS.length - index - 1,
        { timeout: 15_000 },
      )
    }
    await expect(chips(page, 'Approved')).toHaveCount(SECTION_LABELS.length)
    await expect(page.getByText(/is drafted, not approved/)).toHaveCount(0)

    await saveDraft(page)
    await expect(page.getByText('Version 2 is what the channel runs on.')).toBeVisible({
      timeout: 15_000,
    })

    await openHistory(page)
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible()
    // Version 1 is the empty bible the channel was created with.
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible()
    await expect(page.getByText('Drafted with AI')).toBeVisible()
  })

  test('a project started from a shortlisted case is frozen to version 2', async ({ page }) => {
    await page.goto(channelPath('/cases', SECOND_SLUG))
    await expect(page.getByText('Complete the channel bible in Settings first.')).toHaveCount(0)

    await page.getByRole('button', { name: 'Add case' }).click()
    await page.getByLabel('Subject').fill(CASE_TITLE)
    await page.getByLabel('Title').fill(CASE_TITLE)
    await page.getByLabel('Angle').fill('An angle, so the form is valid.')
    await page.getByRole('button', { name: 'Save case' }).click()
    await expect(page.getByText('Case added to your backlog').first()).toBeVisible()

    await page
      .getByRole('listitem')
      .filter({ hasText: CASE_TITLE })
      .getByRole('button', { name: 'New project' })
      .click()
    // The dossier run cannot be sent from here; the project row is made first.
    await expect(page.getByText(/nothing is researching it/i).first()).toBeVisible({
      timeout: 15_000,
    })

    await openProject(page)
    await expect(page.getByText(/Bible version 2$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use the latest bible' })).toHaveCount(0)
  })

  test('editing Voice and saving makes version 3', async ({ page }) => {
    await page.goto(bibleTab)
    await openCard(page, 'Voice')
    await page.getByRole('button', { name: 'Edit Voice', exact: true }).click()
    const hedging = page.getByLabel('Hedging rules')
    await hedging.fill(`${await hedging.inputValue()}${VOICE_EDIT}`)
    await page.getByRole('button', { name: 'Done editing Voice', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({
      timeout: 15_000,
    })

    // A runtime that runs the wrong way is refused in words and holds Save; fixed, it saves.
    await openCard(page, 'Formats')
    await page.getByRole('button', { name: 'Edit Formats', exact: true }).click()
    const longest = page.getByLabel('Longest')
    await longest.fill('2')
    await expect(page.getByText(/Runtime needs/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await longest.fill('60')
    await page.getByRole('button', { name: 'Add keyword' }).click()
    await page.getByLabel('Keyword 2', { exact: true }).fill('mind explained')
    // Shorts are a visible labelled switch per format; turning it off is what saves with the rest.
    const shorts = page.getByRole('button', { name: 'Shorts: on', exact: true })
    await expect(shorts).toHaveAttribute('aria-pressed', 'true')
    await shorts.click()
    await expect(page.getByRole('button', { name: 'Shorts: off', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await page.getByRole('button', { name: 'Done editing Formats', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({
      timeout: 15_000,
    })

    await saveDraft(page)
    await expect(page.getByText('Version 3 is what the channel runs on.')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Shorts off', { exact: true })).toBeVisible()
    await openHistory(page)
    await expect(page.getByText('Version 3', { exact: true })).toBeVisible()
  })

  test('Copy from another channel brings in the chosen sections as drafted, and Discard undoes it', async ({
    page,
  }) => {
    await page.goto(bibleTab)
    await expect(page.getByText('Version 3 is what the channel runs on.')).toBeVisible()

    await page.getByRole('button', { name: 'Copy from another channel' }).click()
    const picker = page.getByLabel('Channel to copy from')
    const value = await picker
      .locator('option')
      .filter({ hasText: 'Boom & Busters' })
      .first()
      .getAttribute('value')
    await picker.selectOption(value!)
    await page.getByRole('checkbox', { name: 'Identity' }).uncheck()
    await page.getByRole('button', { name: 'Copy', exact: true }).click()

    // The ticked sections came across and need approval; Identity stayed as it was. (A section
    // the source holds nothing in reads Empty, so the blockers are the count to trust.)
    await expect(page.getByRole('button', { name: 'Show what to fix' })).toBeVisible({
      timeout: 15_000,
    })
    await showWhatToFix(page)
    await expect(page.getByText('Voice is drafted, not approved')).toBeVisible()
    await expect(page.getByText('Identity is drafted, not approved')).toHaveCount(0)
    await expect(page.getByLabel('Version note')).toHaveValue(
      /^Copied from Boom & Busters version \d+$/,
    )
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

    // Nothing was saved: Discard throws the copy away and version 3 stands.
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click()
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0, {
      timeout: 15_000,
    })
    await expect(page.getByText('Version 3 is what the channel runs on.')).toBeVisible()
  })

  test('the project still reads Bible version 2 until Use the latest bible moves it to 3', async ({
    page,
  }) => {
    await openProject(page)
    await expect(page.getByText(/Bible version 2$/)).toBeVisible()

    await page.getByRole('button', { name: 'Use the latest bible' }).click()
    await expect(page.getByText(/Bible version 3$/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Use the latest bible' })).toHaveCount(0)
  })

  test('at 390 px the Bible tab does not scroll sideways and every button is 40 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(bibleTab)
    await expect(page.getByText('Version 3 is what the channel runs on.')).toBeVisible()

    // The busiest the tab gets: History open, the input and copy cards open, a section open.
    // Only one panel is open at a time, so each is opened in turn and the page checked after each.
    const noSidewaysScroll = async (what: string) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${what}: the page scrolls ${overflow}px sideways`).toBeLessThanOrEqual(0)
    }
    await openHistory(page)
    await noSidewaysScroll('History open')
    await page.getByRole('button', { name: 'Copy from another channel' }).click()
    await expect(page.getByLabel('Channel to copy from')).toBeVisible()
    await noSidewaysScroll('Copy open')
    await page.getByRole('button', { name: 'Draft with AI' }).click()
    await expect(page.getByLabel('Describe the channel in a few lines')).toBeVisible()
    await noSidewaysScroll('Draft with AI open')
    await openCard(page, 'Voice')
    await expect(page.getByRole('button', { name: 'Edit Voice', exact: true })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `the page scrolls ${overflow}px sideways`).toBeLessThanOrEqual(0)
    await expectHitTargets(page)
  })
})

/** Opens the second channel's only project from its list. */
async function openProject(page: Page): Promise<void> {
  await page.goto(channelPath('/projects', SECOND_SLUG))
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: CASE_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 60_000 })
}
