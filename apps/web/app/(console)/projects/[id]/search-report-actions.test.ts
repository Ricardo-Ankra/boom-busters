// @vitest-environment node

import {
  createCase,
  createChannel,
  createProjectFromCase,
  dismissedTermKeys,
  ensurePublishRecord,
  listBibleVersions,
  projects,
  rankChecksForVideo,
  requireTestDatabase,
  saveBibleVersion,
  seed,
  truncateSearchReports,
  updatePublishRecord,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, defaultFormat } from '@boom-busters/schemas'
import type { SearchBrief } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  addTermToKeywordsAction,
  checkRankAction,
  dismissTermAction,
} from './search-report-actions'

/** The search report card's Add to keywords button, against the test database. */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const seam = vi.hoisted(() => {
  class CapReached extends Error {}
  return { CapReached, rankFor: vi.fn(), cap: false }
})
vi.mock('@/lib/case-evidence', () => ({
  rankFor: (...args: unknown[]) => seam.rankFor(...args),
  CapReached: seam.CapReached,
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('addTermToKeywordsAction', () => {
  let channelId = ''
  let projectId = ''

  beforeEach(async () => {
    await seed(db)
    const channel = await createChannel(db, {
      name: 'Keywords',
      handle: null,
      slug: `kw-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: { ...EMPTY_BIBLE, language: 'en', formats: [defaultFormat('Main')] },
    })
    channelId = channel.id
    const kase = await createCase(db, { title: 'Enron', category: 'collapse', channelId })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Enron' })).id
  })

  it('adds the trimmed term to the project format and says so', async () => {
    const result = await addTermToKeywordsAction(projectId, '  enron collapse  ')
    expect(result).toEqual({ ok: true, message: 'Added to the Main keywords.' })
    const versions = await listBibleVersions(db, channelId)
    expect(versions.at(-1)!.bible.formats[0]!.keywords).toEqual(['enron collapse'])
    expect(await addTermToKeywordsAction(projectId, 'Collapse Enron')).toEqual({
      ok: true,
      message: 'Already a keyword.',
    })
  })

  it('refuses an empty term and an unknown project', async () => {
    expect(await addTermToKeywordsAction(projectId, '   ')).toMatchObject({ ok: false })
    expect(await addTermToKeywordsAction('01J0000000000000000000ZZZZ', 'enron')).toEqual({
      ok: false,
      error: 'Unknown project',
    })
  })

  it('refuses to add a seventh keyword with a plain message', async () => {
    const { bible } = (await listBibleVersions(db, channelId)).at(-1)!
    await saveBibleVersion(
      db,
      channelId,
      {
        ...bible,
        formats: [{ ...bible.formats[0]!, keywords: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] }],
      },
      'Six keywords',
    )
    const result = await addTermToKeywordsAction(projectId, 'seventh term')
    expect(result).toEqual({
      ok: false,
      error: 'This format has 6 keywords already. Remove one in Settings first.',
    })
    expect(await listBibleVersions(db, channelId)).toHaveLength(2)
  })
})

const keyword = (word: string) => ({
  keyword: word,
  volume: 50,
  competition: 40,
  overall: 50,
  estimatedMonthlySearch: 1000,
  growthPct: 0,
})

const BRIEF: SearchBrief = {
  subject: 'Enron',
  measuredAt: '2026-11-02T12:00:00.000Z',
  targetKeyword: keyword('enron collapse'),
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
}

describeDb('checkRankAction and dismissTermAction', () => {
  let channelId = ''
  let projectId = ''

  beforeEach(async () => {
    seam.rankFor.mockReset()
    await seed(db)
    await truncateSearchReports(db)
    const channel = await createChannel(db, {
      name: 'Ranks',
      handle: null,
      slug: `rk-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: { ...EMPTY_BIBLE, language: 'en', formats: [defaultFormat('Main')] },
    })
    channelId = channel.id
    const kase = await createCase(db, { title: 'Enron', category: 'collapse', channelId })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Enron' })).id
  })

  // The brief is set on every project row: leave none behind for other suites.
  afterEach(async () => {
    await db.update(projects).set({ searchBrief: null })
  })

  const goLive = async (videoId: string) => {
    const record = await ensurePublishRecord(db, 'master', projectId)
    await updatePublishRecord(db, record.id, { youtubeVideoId: videoId, status: 'live' })
  }
  const setBrief = (value: SearchBrief | null) => db.update(projects).set({ searchBrief: value })

  it('checkRankAction records a rank check and refuses at the cap', async () => {
    await setBrief(BRIEF)
    await goLive('yt-rank-1')
    seam.rankFor.mockResolvedValueOnce(4)

    expect(await checkRankAction(projectId)).toEqual({
      ok: true,
      position: 4,
      keyword: 'enron collapse',
    })
    expect(seam.rankFor).toHaveBeenCalledWith('enron collapse', 'yt-rank-1', channelId)
    const checks = await rankChecksForVideo(db, 'yt-rank-1')
    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ keyword: 'enron collapse', position: 4 })

    seam.rankFor.mockResolvedValueOnce(null)
    expect(await checkRankAction(projectId)).toMatchObject({ ok: true, position: null })
    expect((await rankChecksForVideo(db, 'yt-rank-1'))[0]!.position).toBeNull()

    seam.rankFor.mockRejectedValueOnce(new seam.CapReached('cap'))
    expect(await checkRankAction(projectId)).toEqual({
      ok: false,
      error: 'The monthly VidIQ credit cap is reached.',
    })
    expect(await rankChecksForVideo(db, 'yt-rank-1')).toHaveLength(2)
  })

  it('checkRankAction refuses a project with no target', async () => {
    await goLive('yt-rank-2')
    expect(await checkRankAction(projectId)).toEqual({
      ok: false,
      error: 'This video has no researched target to check.',
    })
    expect(seam.rankFor).not.toHaveBeenCalled()
  })

  it('checkRankAction refuses a master that is not on YouTube', async () => {
    await setBrief(BRIEF)
    expect(await checkRankAction(projectId)).toMatchObject({ ok: false })
    expect(seam.rankFor).not.toHaveBeenCalled()
  })

  it('dismissTermAction stores the normalised term key for the channel', async () => {
    expect(await dismissTermAction(projectId, 'The Enron Collapse 2001')).toEqual({ ok: true })
    expect(await dismissedTermKeys(db, channelId)).toEqual(new Set(['collapse enron']))
    expect(await dismissTermAction(projectId, '   ')).toMatchObject({ ok: false })
    expect(await dismissTermAction('01J0000000000000000000ZZZZ', 'enron')).toEqual({
      ok: false,
      error: 'Unknown project',
    })
  })
})
