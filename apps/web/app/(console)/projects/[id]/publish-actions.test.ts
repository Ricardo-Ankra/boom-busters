// @vitest-environment node

import {
  channelForProject,
  castMembers,
  createCase,
  createChannel,
  createProjectFromCase,
  createScriptVersion,
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  insertShort,
  insertTimeline,
  listCastMembers,
  recordChannelYoutubeVerify,
  saveChannelYoutubeConnection,
  updatePublishRecord,
  projects,
  publishRecords,
  requireTestDatabase,
  saveChapter,
  scripts,
  shorts,
  seed,
  timelines,
  updateWorkspace,
  vidiqCredits,
} from '@boom-busters/db'
import {
  DEFAULT_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_ID,
  PublishDraftSchema,
  resolveBrandKit,
} from '@boom-busters/schemas'
import type { SearchBrief, Timeline } from '@boom-busters/schemas'
import type * as DbModule from '@boom-busters/db'
import type * as YoutubeLib from '@/lib/youtube'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FROZEN_BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import {
  generateDescription,
  generateTitles,
  publishNow,
  reschedulePublish,
  schedulePublish,
  scoreAllTitlesAction,
  savePublishDraft,
  unlinkPublishRecord,
} from './publish-actions'

/**
 * The Generate titles button (decision 293) against the test database: at
 * most two calls, so a cut-off answer is asked once more at double the
 * budget, and half a list of titles is never offered.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const youtube = vi.hoisted(() => ({
  movePublishAt: vi.fn(),
  refreshAccessToken: vi.fn(),
}))
vi.mock('@/lib/youtube', async (importOriginal) => ({
  ...(await importOriginal<typeof YoutubeLib>()),
  movePublishAt: youtube.movePublishAt,
  refreshAccessToken: youtube.refreshAccessToken,
}))
const callLlm = vi.hoisted(() => vi.fn())
const creditsSeam = vi.hoisted(() => ({ calls: 0, failOn: 0 }))
const credentialSeam = vi.hoisted(() => ({ fail: false, message: 'the credential store is down' }))
vi.mock('@boom-busters/db', async (importOriginal) => {
  const original = await importOriginal<typeof DbModule>()
  return {
    ...original,
    // The Nth read of the month's credits fails: the budget check is the first, each purchase another.
    vidiqCreditsThisMonth: (...args: Parameters<typeof original.vidiqCreditsThisMonth>) => {
      creditsSeam.calls += 1
      if (creditsSeam.calls === creditsSeam.failOn) throw new Error('the ledger is unreachable')
      return original.vidiqCreditsThisMonth(...args)
    },
    vidiqCredential: (...args: Parameters<typeof original.vidiqCredential>) => {
      if (credentialSeam.fail) throw new Error(credentialSeam.message)
      return original.vidiqCredential(...args)
    },
  }
})
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

/** A one-chapter master: enough for the description to gloss one chapter. */
function masterTimeline(chapterId: string): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [0, 1].map((index) => ({
      r2Key: `mock://voice/p${index}.wav`,
      startMs: index * 6000,
      durationMs: 6000,
      chapterId,
      paragraphIndex: index,
    })),
    music: null,
    captions: { words: [], style: 'karaoke' },
    slots: [
      {
        type: 'still',
        startMs: 0,
        durationMs: 12_000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/x.png' } },
      },
    ],
    overlays: [],
  }
}

const HALF = '{"titles": ["The audit that said no to the mon'
const WHOLE = JSON.stringify({
  titles: ['The audit that said no to the money', 'Nine days from a record high to nothing'],
})

describeDb('generateTitles (decision 293)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    // A record another suite scheduled would refuse the edit.
    await db.delete(publishRecords)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more at double the budget when the titles are cut off, and offers none of the half', async () => {
    callLlm
      .mockResolvedValueOnce({ text: HALF, truncated: true })
      .mockResolvedValueOnce({ text: WHOLE })

    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

    const [first, second] = callLlm.mock.calls
    expect(first![1]).toEqual({
      projectId: FIXTURE_PROJECT_ID,
      channelId: FIRST_CHANNEL_ID,
      estimateOutputTokens: 500,
    })
    expect(second![0].maxTokens).toBe(first![0].maxTokens * 2)
    expect(second![1]).toEqual({
      projectId: FIXTURE_PROJECT_ID,
      channelId: FIRST_CHANNEL_ID,
      purpose: 'retry: cut off',
    })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      titleOptions: [
        'The audit that said no to the money',
        'Nine days from a record high to nothing',
      ],
    })
  })

  it.each(['', '1'])(
    'refuses a project frozen to an incomplete bible with the gate message and no call (MOCK_PROVIDERS=%j)',
    async (mock) => {
      vi.stubEnv('MOCK_PROVIDERS', mock)
      const channel = await createChannel(db, {
        name: 'Blank channel',
        handle: null,
        slug: `blank-${Math.random().toString(36).slice(2, 8)}`,
        settings: DEFAULT_SETTINGS,
        bible: EMPTY_BIBLE,
      })
      const kase = await createCase(db, { channelId: channel.id, title: 'T', category: 'collapse' })
      const blank = await createProjectFromCase(db, { caseId: kase.id, title: 'T' })

      expect(await generateTitles('master', blank.id)).toEqual({
        ok: false,
        error: FROZEN_BIBLE_INCOMPLETE_MESSAGE,
      })
      expect(await generateDescription('master', blank.id)).toEqual({
        ok: false,
        error: FROZEN_BIBLE_INCOMPLETE_MESSAGE,
      })
      expect(callLlm).not.toHaveBeenCalled()
    },
  )

  it('stops after a second cut-off with the reason, and offers nothing', async () => {
    callLlm.mockResolvedValue({ text: HALF, truncated: true })

    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({
      ok: false,
      error: 'The titles could not be generated: the answer was cut off at its length limit',
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).not.toHaveProperty(
      'titleOptions',
    )
  })
})

/**
 * Decision 303: titles are grounded in the claim list; the search description
 * is written from the claims and the script, stamped with the script version
 * it was written for; and an opening the owner rewrites is stamped too.
 */
describeDb('the search description (decision 303)', () => {
  const DESCRIPTION = JSON.stringify({
    body: 'How Wirecard, the German payments company, collapsed in June 2020.',
    chapterGlosses: ['The trustee accounts that never existed'],
    hashtags: ['#Wirecard', '#Fraud', '#Documentary'],
    tags: ['Wirecard', 'Markus Braun'],
  })

  let chapterId = ''

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    await db.delete(publishRecords)
    await db.delete(timelines)
    await db.delete(scripts)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: '[pause] EY refused to sign the accounts.\n\nThe shares collapsed in nine days.',
      estRuntimeSec: 12,
    })
    chapterId = chapter.id
    await insertTimeline(db, {
      projectId: FIXTURE_PROJECT_ID,
      json: masterTimeline(chapter.id),
      s3Key: '',
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('grounds the titles in the claim list', async () => {
    callLlm.mockResolvedValueOnce({ text: WHOLE })
    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    const request = callLlm.mock.calls[0]![0] as { system: string; messages: { content: string }[] }
    expect(request.system).toMatch(/early pitch/)
    expect(request.messages.map((m) => m.content).join('\n')).toContain(
      'Wirecard AG filed for insolvency',
    )
    // An unverified claim is no ground for a title (decision 303, review).
    expect(request.messages.map((m) => m.content).join('\n')).not.toContain(
      'Jan Marsalek is alleged to have maintained contacts',
    )
  })

  it('writes the opening, the chapter glosses, the hashtags and tags, stamped with the script version', async () => {
    await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    await savePublishDraft('master', FIXTURE_PROJECT_ID, {
      title: '',
      descriptionBody: '',
      tags: 'Owner tag',
    })
    callLlm.mockResolvedValueOnce({ text: DESCRIPTION })

    expect(await generateDescription('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

    const request = callLlm.mock.calls[0]![0] as { messages: { content: string }[] }
    const sent = request.messages.map((m) => m.content).join('\n')
    expect(sent).toContain('1. The audit')
    expect(sent).toContain('Wirecard AG filed for insolvency')
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      descriptionBody: 'How Wirecard, the German payments company, collapsed in June 2020.',
      bodyScriptVersion: 1,
      // Keyed by chapter id: a rewritten script drops a gloss rather than
      // moving it under another chapter (decision 303, review).
      chapterGlosses: { [chapterId]: 'The trustee accounts that never existed' },
      hashtags: ['#Wirecard', '#Fraud', '#Documentary'],
      // The owner's tag is kept, first; the written ones join it.
      tags: ['Owner tag', 'Wirecard', 'Markus Braun'],
    })
  })

  it("sends the description no fixed line of the project's format", async () => {
    const { bible } = await channelForProject(db, FIXTURE_PROJECT_ID)
    const format = { ...bible.formats[0]!, introLine: 'Settle in.', outroLine: 'Sleep well.' }
    const channel = await createChannel(db, {
      name: 'Fixed-line description channel',
      handle: null,
      slug: `fixed-desc-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: { ...bible, formats: [format] },
    })
    const kase = await createCase(db, {
      channelId: channel.id,
      title: 'Wirecard',
      category: 'collapse',
    })
    const projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Wirecard' })).id
    const script = await createScriptVersion(db, projectId)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'Settle in.\n\nA billion euros was never there.\n\nSleep well.',
      estRuntimeSec: 12,
    })
    await insertTimeline(db, { projectId, json: masterTimeline(chapter.id), s3Key: '' })
    callLlm.mockResolvedValueOnce({ text: DESCRIPTION })

    expect(await generateDescription('master', projectId)).toEqual({ ok: true })

    const request = callLlm.mock.calls[0]![0] as { messages: { content: string }[] }
    const sent = request.messages.map((m) => m.content).join('\n')
    expect(sent).toContain('A billion euros was never there.')
    expect(sent).not.toContain('Settle in.')
    expect(sent).not.toContain('Sleep well.')
  })

  it("writes a Short's titles and description from the clip, not the film's opening", async () => {
    const short = await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'Nine days',
      segmentRef: { chapterId, fromParagraph: 1, toParagraph: 1 },
    })
    callLlm.mockResolvedValueOnce({ text: WHOLE }).mockResolvedValueOnce({
      text: JSON.stringify({
        body: 'Wirecard shares collapsed in nine days.',
        chapterGlosses: [],
        hashtags: ['#Wirecard'],
        tags: ['Wirecard'],
      }),
    })

    expect(await generateTitles('short', short.id)).toEqual({ ok: true })
    expect(await generateDescription('short', short.id)).toEqual({ ok: true })

    for (const [request] of callLlm.mock.calls as [{ messages: { content: string }[] }][]) {
      const sent = request.messages.map((m) => m.content).join('\n')
      expect(sent).toContain('What this Short says:\nThe shares collapsed in nine days.')
      // The film's opening is another paragraph; it is not this Short.
      expect(sent).not.toContain('EY refused to sign the accounts')
    }
  })

  it('stamps an opening the owner rewrites, and leaves the stamp when only the tags change', async () => {
    await savePublishDraft('master', FIXTURE_PROJECT_ID, {
      title: '',
      descriptionBody: 'My own opening.',
      tags: '',
    })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      bodyScriptVersion: 1,
    })
    await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await savePublishDraft('master', FIXTURE_PROJECT_ID, {
      title: '',
      descriptionBody: 'My own opening.',
      tags: 'one more',
      hashtags: '#Wirecard, AI Documentary',
      chapterGlosses: { [chapterId]: '  The audit that said no  ' },
    })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      bodyScriptVersion: 1,
      hashtags: ['#Wirecard', '#AIDocumentary'],
      chapterGlosses: { [chapterId]: 'The audit that said no' },
    })
  })
})

describeDb('reschedulePublish on an unverified connection', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    vi.clearAllMocks()
    await seed(db)
    await db.delete(publishRecords)
    const record = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    await updatePublishRecord(db, record.id, {
      status: 'scheduled',
      youtubeVideoId: 'vid-1',
      publishAt: new Date(Date.now() + 86_400_000),
    })
    await saveChannelYoutubeConnection(db, FIRST_CHANNEL_ID, {
      refreshToken: '1//refresh',
      encryptionKey: env.SECRETS_ENCRYPTION_KEY,
      youtubeChannelId: 'UC-first',
      youtubeChannelTitle: 'First',
    })
    youtube.refreshAccessToken.mockResolvedValue({ accessToken: 'ya29.x' })
    youtube.movePublishAt.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const later = () => new Date(Date.now() + 3 * 86_400_000).toISOString()

  it('refuses, and never mints a token, when the connection is invalid', async () => {
    await recordChannelYoutubeVerify(db, FIRST_CHANNEL_ID, 'invalid')

    const result = await reschedulePublish('master', FIXTURE_PROJECT_ID, later())

    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/reconnecting/) })
    expect(youtube.refreshAccessToken).not.toHaveBeenCalled()
    expect(youtube.movePublishAt).not.toHaveBeenCalled()
  })

  it('moves the slot when the connection is ok', async () => {
    await recordChannelYoutubeVerify(db, FIRST_CHANNEL_ID, 'ok', 'UC-first')

    expect(await reschedulePublish('master', FIXTURE_PROJECT_ID, later())).toEqual({ ok: true })
    expect(youtube.movePublishAt).toHaveBeenCalledTimes(1)
  })
})

describeDb('point Shorts publish only after their long form', () => {
  const day = 86_400_000
  let pointShortId: string
  let teaserShortId: string
  let excerptShortId: string

  async function masterAt(status: 'draft' | 'scheduled' | 'live', publishAt: Date | null) {
    const record = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    await updatePublishRecord(db, record.id, { status, publishAt })
  }

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    youtube.movePublishAt.mockReset()
    await seed(db)
    await db.delete(publishRecords)
    await db.delete(shorts)
    const base = {
      projectId: FIXTURE_PROJECT_ID,
      segmentRef: { chapterId: 'c', fromParagraph: 0, toParagraph: 0 },
    }
    pointShortId = (
      await insertShort(db, { ...base, title: 'A point', kind: 'point', pointId: 'p1' })
    ).id
    teaserShortId = (await insertShort(db, { ...base, title: 'A teaser', kind: 'teaser' })).id
    excerptShortId = (await insertShort(db, { ...base, title: 'An excerpt' })).id
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const at = (offset: number) => new Date(Date.now() + offset).toISOString()

  it('refuses to schedule while the long form has no publish time', async () => {
    expect(await schedulePublish('short', pointShortId, at(3 * day))).toEqual({
      ok: false,
      error: 'Schedule the long-form video first.',
    })
    await masterAt('draft', null)
    expect(await schedulePublish('short', pointShortId, at(3 * day))).toEqual({
      ok: false,
      error: 'Schedule the long-form video first.',
    })
  })

  it("refuses a time that is not after the long form's, and names that time", async () => {
    const master = new Date(Date.now() + 5 * day)
    await masterAt('scheduled', master)
    const expected = `A Short goes out after its long-form video, which is scheduled for ${master.toLocaleString('en-ZA', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC.`

    expect(await schedulePublish('short', pointShortId, at(2 * day))).toEqual({
      ok: false,
      error: expected,
    })
    // The very same instant is not after it either.
    expect(await schedulePublish('short', pointShortId, master.toISOString())).toEqual({
      ok: false,
      error: expected,
    })
  })

  it('lets a time after the long form through the guard', async () => {
    await masterAt('scheduled', new Date(Date.now() + 2 * day))
    // Past the guard it meets the ordinary readiness check: no render yet.
    expect(await schedulePublish('short', pointShortId, at(3 * day))).toEqual({
      ok: false,
      error: 'This Short has no finished render to upload.',
    })
  })

  it('applies the same guard to a reschedule', async () => {
    const master = new Date(Date.now() + 5 * day)
    await masterAt('scheduled', master)
    const record = await ensurePublishRecord(db, 'short', pointShortId)
    await updatePublishRecord(db, record.id, {
      status: 'scheduled',
      youtubeVideoId: 'vid-s',
      publishAt: new Date(Date.now() + 6 * day),
    })

    const result = await reschedulePublish('short', pointShortId, at(2 * day))

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^A Short goes out after its long-form video/),
    })
    expect(youtube.movePublishAt).not.toHaveBeenCalled()
  })

  it('refuses Publish now unless the long form is live', async () => {
    const refusal = { ok: false, error: 'The long-form video has to be live first.' }
    expect(await publishNow('short', pointShortId)).toEqual(refusal)
    await masterAt('scheduled', new Date(Date.now() + day))
    expect(await publishNow('short', pointShortId)).toEqual(refusal)
    await masterAt('live', new Date(Date.now() - day))
    expect(await publishNow('short', pointShortId)).toEqual({
      ok: false,
      error: 'This Short has no finished render to upload.',
    })
  })

  describe('the long form cannot move past its Shorts', () => {
    const sayAt = (at: Date) =>
      `${at.toLocaleString('en-ZA', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`

    async function scheduledShort(id: string, publishAt: Date) {
      const record = await ensurePublishRecord(db, 'short', id)
      await updatePublishRecord(db, record.id, {
        status: 'scheduled',
        youtubeVideoId: `vid-${id}`,
        publishAt,
      })
    }
    async function scheduledMaster(publishAt: Date) {
      const record = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      await updatePublishRecord(db, record.id, {
        status: 'scheduled',
        youtubeVideoId: 'vid-master',
        publishAt,
      })
    }

    it('refuses moving the long form to or past the earliest scheduled point Short', async () => {
      const earliest = new Date(Date.now() + 6 * day)
      const masterAt0 = new Date(Date.now() + 2 * day)
      await scheduledMaster(masterAt0)
      await scheduledShort(pointShortId, earliest)
      const refusal = {
        ok: false,
        error: `Move its Shorts first: the earliest goes out ${sayAt(earliest)}.`,
      }

      expect(await reschedulePublish('master', FIXTURE_PROJECT_ID, at(7 * day))).toEqual(refusal)
      // The very same instant is not before it either.
      expect(await reschedulePublish('master', FIXTURE_PROJECT_ID, earliest.toISOString())).toEqual(
        refusal,
      )
      expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.publishAt?.getTime()).toBe(
        masterAt0.getTime(),
      )
    })

    it('lets the long form move to a time before its Shorts', async () => {
      await scheduledMaster(new Date(Date.now() + 2 * day))
      await scheduledShort(pointShortId, new Date(Date.now() + 6 * day))
      const moved = new Date(Date.now() + 4 * day)

      expect(await reschedulePublish('master', FIXTURE_PROJECT_ID, moved.toISOString())).toEqual({
        ok: true,
      })
      expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.publishAt).toEqual(moved)
    })

    it('refuses unscheduling the long form while a point Short is scheduled, then allows it', async () => {
      const earliest = new Date(Date.now() + 6 * day)
      await scheduledMaster(new Date(Date.now() + 2 * day))
      await scheduledShort(pointShortId, earliest)

      expect(await unlinkPublishRecord('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: `Its Shorts are scheduled, so move or unlink them first: the earliest goes out ${sayAt(earliest)}.`,
      })
      expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.status).toBe('scheduled')

      // The Short is unlinked first, as the sentence says.
      expect(await unlinkPublishRecord('short', pointShortId)).toEqual({ ok: true })
      expect(await unlinkPublishRecord('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    })

    it('does not count teasers or excerpts', async () => {
      await scheduledMaster(new Date(Date.now() + 2 * day))
      await scheduledShort(teaserShortId, new Date(Date.now() + 3 * day))
      await scheduledShort(excerptShortId, new Date(Date.now() + 3 * day))

      expect(await reschedulePublish('master', FIXTURE_PROJECT_ID, at(9 * day))).toEqual({
        ok: true,
      })
    })
  })

  it('leaves teasers and excerpts unguarded', async () => {
    // No master record at all: a point Short would be refused here.
    for (const id of [teaserShortId, excerptShortId]) {
      const expected = { ok: false, error: 'This Short has no finished render to upload.' }
      expect(await schedulePublish('short', id, at(day))).toEqual(expected)
      expect(await publishNow('short', id)).toEqual(expected)
    }
  })
})

/**
 * The frozen search brief: the prompts carry it, the tags lead with it, and a
 * master's first three titles are scored with VidIQ (mock client here, so no
 * credit is spent), each call a ledger row. A cap refusal keeps the titles.
 */
describeDb('the search brief in titles, description and tags', () => {
  const keyword = (word: string) => ({
    keyword: word,
    volume: 50,
    competition: 40,
    overall: 50,
    estimatedMonthlySearch: 1000,
    growthPct: 0,
  })
  const BRIEF: SearchBrief = {
    subject: 'Wirecard',
    measuredAt: '2026-11-02T12:00:00.000Z',
    targetKeyword: keyword('wirecard scandal'),
    secondaryKeywords: [keyword('wirecard documentary')],
    searchedQuestions: ['Where did the missing billion go?'],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [],
    chosenAngle: null,
    formatKey: null,
    fit: null,
  }
  const TITLES = JSON.stringify({
    titles: ['One title here', 'Two title here', 'Three title here', 'Four title here'],
  })
  const DESCRIPTION = JSON.stringify({
    body: 'How Wirecard collapsed in June 2020.',
    chapterGlosses: ['The audit'],
    hashtags: ['#Wirecard', '#Fraud', '#Documentary'],
    tags: ['Wirecard', 'wirecard scandal', 'fintech fraud'],
  })
  const setBrief = (value: SearchBrief | null) => db.update(projects).set({ searchBrief: value })
  const draft = async () =>
    (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata as Record<string, unknown>

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    await db.delete(publishRecords)
    await db.delete(vidiqCredits)
    // Cast and a brief left by another suite would show up in the tags this suite asserts.
    await db.delete(castMembers)
    await setBrief(null)
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'EY refused to sign the accounts.',
      estRuntimeSec: 12,
    })
  })

  afterEach(async () => {
    creditsSeam.calls = 0
    creditsSeam.failOn = 0
    credentialSeam.fail = false
    credentialSeam.message = 'the credential store is down'
    await setBrief(null)
    vi.unstubAllEnvs()
  })

  it('sends the brief to the titles prompt and to the description prompt', async () => {
    await setBrief(BRIEF)
    callLlm.mockResolvedValueOnce({ text: TITLES }).mockResolvedValueOnce({ text: DESCRIPTION })
    // No VidIQ key is stored, so the titles are not scored here: the prompts are under test.
    await generateTitles('master', FIXTURE_PROJECT_ID)
    await generateDescription('master', FIXTURE_PROJECT_ID)
    const [titles, description] = callLlm.mock.calls.map(
      ([request]) => request as { system: string },
    )
    expect(titles!.system).toContain('At least half the titles contain "wirecard scandal"')
    expect(description!.system).toContain('within the first 150 characters')
    expect(description!.system).toContain('"Where did the missing billion go?"')
    expect(await db.select().from(vidiqCredits)).toHaveLength(0)
  })

  it('leads the tags with the owner, then the brief, then the model, and stores which came from the brief', async () => {
    await setBrief(BRIEF)
    await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    await savePublishDraft('master', FIXTURE_PROJECT_ID, {
      title: '',
      descriptionBody: '',
      tags: 'Owner tag',
    })
    callLlm.mockResolvedValueOnce({ text: DESCRIPTION })
    expect(await generateDescription('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    // The project's cast follows the brief's keywords, before the model's tags.
    const cast = (await listCastMembers(db, FIXTURE_PROJECT_ID)).map((member) => member.name)
    const fromBrief = ['wirecard scandal', 'wirecard documentary', ...cast]
    expect(await draft()).toMatchObject({
      tags: ['Owner tag', ...fromBrief, 'Wirecard', 'fintech fraud'],
      searchTags: fromBrief,
    })
  })

  it('writes the model tags and stores no search tags without a brief', async () => {
    callLlm.mockResolvedValueOnce({ text: DESCRIPTION })
    expect(await generateDescription('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    expect(await draft()).toMatchObject({
      tags: ['Wirecard', 'wirecard scandal', 'fintech fraud'],
      searchTags: [],
    })
  })

  describe('a channel with tags, a format, a pillar and a hashtag', () => {
    const FILLER = ['a', 'b', 'c', 'd', 'e'].map((letter) => letter.repeat(30))
    /** Channel tags worth 174 characters joined: the last cannot fit in 150. */
    const CHANNEL_TAGS = ['history', 'sleep', ...FILLER]
    const ANSWER = JSON.stringify({
      body: 'How Wirecard collapsed in June 2020.',
      chapterGlosses: [],
      hashtags: ['#Wirecard', '#Fraud', '#Documentary'],
      tags: ['fintech fraud', 'HISTORY FOR SLEEP'],
    })

    async function channelProject(hashtag: string): Promise<string> {
      const { bible } = await channelForProject(db, FIXTURE_PROJECT_ID)
      const format = {
        ...bible.formats[0]!,
        keywords: ['History', 'history for sleep'],
      }
      const channel = await createChannel(db, {
        name: 'Tagged channel',
        handle: null,
        slug: `tagged-${Math.random().toString(36).slice(2, 8)}`,
        settings: DEFAULT_SETTINGS,
        bible: {
          ...bible,
          formats: [format],
          channelTags: CHANNEL_TAGS,
          channelHashtag: hashtag,
          caseCategories: bible.caseCategories.map((c) =>
            c.key === 'collapse' ? { ...c, keywords: ['empire'] } : c,
          ),
        },
      })
      const kase = await createCase(db, {
        channelId: channel.id,
        title: 'Wirecard',
        category: 'collapse',
      })
      return (await createProjectFromCase(db, { caseId: kase.id, title: 'Wirecard' })).id
    }
    const draftOf = async (projectId: string, type: 'master' | 'short' = 'master') =>
      (await getPublishRecord(db, type, projectId))?.metadata as Record<string, unknown>

    it('orders the tags, drops case-insensitive repeats, stays within 500, and records the channel tags', async () => {
      const projectId = await channelProject('')
      await ensurePublishRecord(db, 'master', projectId)
      await savePublishDraft('master', projectId, {
        title: '',
        descriptionBody: '',
        tags: 'My Tag',
      })
      await setBrief(BRIEF)
      callLlm.mockResolvedValueOnce({ text: ANSWER })
      expect(await generateDescription('master', projectId)).toEqual({ ok: true })
      const stored = await draftOf(projectId)
      const tags = stored['tags'] as string[]
      expect(tags[0]).toBe('My Tag')
      expect(tags.slice(1, 7)).toEqual(['history', 'sleep', ...FILLER.slice(0, 4)])
      expect(tags.slice(7, 9)).toEqual(['history for sleep', 'empire'])
      expect(new Set(tags.map((t) => t.toLowerCase())).size).toBe(tags.length)
      expect(tags.join(',').length).toBeLessThanOrEqual(500)
      expect(stored['channelTags']).toEqual([
        'history',
        'sleep',
        ...FILLER.slice(0, 4),
        'history for sleep',
        'empire',
      ])
      expect(stored['channelTagsDropped']).toEqual([FILLER[4]])
    })

    it('leads the hashtags with the channel hashtag and keeps three in all', async () => {
      const projectId = await channelProject('HistoryForSleep')
      callLlm.mockResolvedValueOnce({ text: ANSWER })
      expect(await generateDescription('master', projectId)).toEqual({ ok: true })
      expect((await draftOf(projectId))['hashtags']).toEqual([
        '#HistoryForSleep',
        '#Wirecard',
        '#Fraud',
      ])
    })

    it('does not repeat the channel hashtag when the model wrote it too', async () => {
      const projectId = await channelProject('Wirecard')
      callLlm.mockResolvedValueOnce({ text: ANSWER })
      expect(await generateDescription('master', projectId)).toEqual({ ok: true })
      expect((await draftOf(projectId))['hashtags']).toEqual([
        '#Wirecard',
        '#Fraud',
        '#Documentary',
      ])
    })

    it('asks a master to place the format and pillar keywords early in the body', async () => {
      const projectId = await channelProject('')
      callLlm.mockResolvedValueOnce({ text: ANSWER })
      await generateDescription('master', projectId)
      const request = callLlm.mock.calls[0]![0] as { system: string }
      expect(request.system).toContain(
        'where it reads naturally: "History", "history for sleep", "empire".',
      )
    })

    it("leaves a Short's tags, hashtags and prompt as they were", async () => {
      const projectId = await channelProject('HistoryForSleep')
      const short = await insertShort(db, {
        projectId,
        title: 'Nine days',
        segmentRef: { chapterId: '01HQ0000000000000000000CH1', fromParagraph: 0, toParagraph: 0 },
      })
      callLlm.mockResolvedValueOnce({ text: ANSWER })
      expect(await generateDescription('short', short.id)).toEqual({ ok: true })
      const stored = await draftOf(short.id, 'short')
      expect(stored['tags']).toEqual(['fintech fraud', 'HISTORY FOR SLEEP'])
      expect(stored['hashtags']).toEqual(['#Wirecard', '#Fraud', '#Documentary'])
      expect(stored['channelTags']).toEqual([])
      expect((callLlm.mock.calls[0]![0] as { system: string }).system).not.toContain(
        'One of these also appears',
      )
    })
  })

  it("writes titles and the description from the first paragraph after the format's fixed line", async () => {
    const { bible } = await channelForProject(db, FIXTURE_PROJECT_ID)
    const format = { ...bible.formats[0]!, introLine: 'Settle in.', outroLine: 'Sleep well.' }
    const channel = await createChannel(db, {
      name: 'Fixed-line channel',
      handle: null,
      slug: `fixed-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: { ...bible, formats: [format] },
    })
    const kase = await createCase(db, {
      channelId: channel.id,
      title: 'Wirecard',
      category: 'collapse',
    })
    const projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Wirecard' })).id
    const script = await createScriptVersion(db, projectId)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'Settle in.\n\nA billion euros was never there.\n\nSleep well.',
      estRuntimeSec: 12,
    })

    callLlm.mockResolvedValueOnce({ text: TITLES })
    expect(await generateTitles('master', projectId)).toEqual({ ok: true })
    const request = JSON.stringify(callLlm.mock.calls[0]![0])
    expect(request).toContain('A billion euros was never there.')
    expect(request).not.toContain('Settle in.')

    // The description's seed is the same hook.
    const { descriptionIngredients } = await import('@/lib/publish-review')
    expect((await descriptionIngredients(db, projectId)).hook).toBe(
      'A billion euros was never there.',
    )
  })

  describe('title scores (mock VidIQ)', () => {
    beforeEach(() => {
      vi.stubEnv('MOCK_PROVIDERS', '1')
    })

    it('scores the first three titles and records three ledger rows', async () => {
      await setBrief(BRIEF)
      expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      const stored = await draft()
      const options = stored['titleOptions'] as string[]
      expect(Object.keys(stored['titleScores'] as object)).toEqual(options.slice(0, 3))
      expect(stored['titleScoreNote']).toBe('')
      const rows = await db.select().from(vidiqCredits)
      expect(rows).toHaveLength(3)
      expect(rows.every((r) => r.purpose === 'title-score' && r.tool === 'vidiq_score_title')).toBe(
        true,
      )
      expect(rows.every((r) => r.credits === 5 && r.projectId === FIXTURE_PROJECT_ID)).toBe(true)
    })

    describe('a format with a title template', () => {
      /** A project on its own channel whose frozen format has a template and a lead keyword. */
      async function templatedProject(): Promise<string> {
        const { bible } = await channelForProject(db, FIXTURE_PROJECT_ID)
        const format = {
          ...bible.formats[0]!,
          keywords: ['actually happened'],
          titleTemplate: '{topic} | {formatKeyword}',
          titleRequiredSlots: ['topic', 'formatKeyword'] as ('topic' | 'formatKeyword')[],
        }
        const channel = await createChannel(db, {
          name: 'Templated channel',
          handle: null,
          slug: `templated-${Math.random().toString(36).slice(2, 8)}`,
          settings: DEFAULT_SETTINGS,
          bible: { ...bible, formats: [format] },
        })
        const kase = await createCase(db, {
          channelId: channel.id,
          title: 'Wirecard',
          category: 'collapse',
        })
        return (await createProjectFromCase(db, { caseId: kase.id, title: 'Wirecard' })).id
      }

      it('stores the slots each title lacks and scores only titles with none', async () => {
        const projectId = await templatedProject()
        await setBrief({ ...BRIEF, targetKeyword: null })
        expect(await generateTitles('master', projectId)).toEqual({ ok: true })
        const stored = (await getPublishRecord(db, 'master', projectId))?.metadata as Record<
          string,
          unknown
        >
        const options = stored['titleOptions'] as string[]
        const misses = stored['titleSlotMisses'] as Record<string, string[]>
        // Only "How Wirecard actually happened" holds the lead keyword.
        const holding = options.filter((option) => option.includes('actually happened'))
        expect(holding).toHaveLength(1)
        for (const option of options) {
          expect(misses[option]).toEqual(option === holding[0] ? undefined : ['formatKeyword'])
        }
        // The titles ahead of it miss, yet the one that holds the keyword is scored, alone.
        expect(Object.keys(stored['titleScores'] as object)).toEqual(holding)
        expect(await db.select().from(vidiqCredits)).toHaveLength(1)
      })
    })

    it('stores no misses on the default format and scores the first three as before', async () => {
      await setBrief(BRIEF)
      expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      const stored = await draft()
      expect(stored['titleSlotMisses']).toEqual({})
      expect(Object.keys(stored['titleScores'] as object)).toEqual(
        (stored['titleOptions'] as string[]).slice(0, 3),
      )
    })

    it('scores nothing without a brief, and nothing for a Short', async () => {
      await generateTitles('master', FIXTURE_PROJECT_ID)
      expect(await db.select().from(vidiqCredits)).toHaveLength(0)

      await setBrief(BRIEF)
      const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
      const chapter = await saveChapter(db, {
        scriptId: script.id,
        index: 0,
        title: 'The audit',
        contentMd: 'EY refused to sign the accounts.',
        estRuntimeSec: 12,
      })
      const short = await insertShort(db, {
        projectId: FIXTURE_PROJECT_ID,
        title: 'Nine days',
        segmentRef: { chapterId: chapter.id, fromParagraph: 0, toParagraph: 0 },
      })
      expect(await generateTitles('short', short.id)).toEqual({ ok: true })
      expect(await db.select().from(vidiqCredits)).toHaveLength(0)
      expect((await getPublishRecord(db, 'short', short.id))?.metadata).toMatchObject({
        titleScores: {},
      })
    })

    it('keeps the titles, stores no scores and says why when the cap cannot cover three', async () => {
      await setBrief(BRIEF)
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 10 } })
      expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      const stored = await draft()
      expect((stored['titleOptions'] as string[]).length).toBeGreaterThan(3)
      expect(stored['titleScores']).toEqual({})
      expect(stored['titleScoreNote']).toBe(
        "VidIQ did not score the titles: This run needs about 15 credits; 10 are left of this month's cap of 10.",
      )
      expect(await db.select().from(vidiqCredits)).toHaveLength(0)
    })

    it('Score all scores the unscored rest after one check, and refuses when none are left', async () => {
      await setBrief(BRIEF)
      await generateTitles('master', FIXTURE_PROJECT_ID)
      const options = (await draft())['titleOptions'] as string[]

      expect(await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      const stored = await draft()
      expect(Object.keys(stored['titleScores'] as object).sort()).toEqual([...options].sort())
      expect(await db.select().from(vidiqCredits)).toHaveLength(options.length)

      expect(await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: 'Every title option is already scored.',
      })
    })

    it('keeps the titles with a one-line note that fits the draft when VidIQ fails with a huge message', async () => {
      await setBrief(BRIEF)
      // Mock mode would short-circuit the key check: turn it off so the credential read really runs.
      vi.stubEnv('MOCK_PROVIDERS', '')
      credentialSeam.fail = true
      callLlm.mockResolvedValueOnce({ text: TITLES })
      credentialSeam.message = 'HTTP 502 ' + 'upstream\ntrace '.repeat(200)
      expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      const record = await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      const parsed = PublishDraftSchema.safeParse(record?.metadata)
      expect(parsed.success).toBe(true)
      if (!parsed.success) return
      expect(parsed.data.titleOptions.length).toBeGreaterThan(3)
      expect(parsed.data.titleScores).toEqual({})
      expect(parsed.data.titleScoreNote).toMatch(/^VidIQ did not score the titles: HTTP 502/)
      expect(parsed.data.titleScoreNote).not.toContain('\n')
      expect(parsed.data.titleScoreNote.length).toBeLessThanOrEqual(480)
    })

    it('keeps the titles with a note when the credential read itself fails', async () => {
      await setBrief(BRIEF)
      vi.stubEnv('MOCK_PROVIDERS', '')
      credentialSeam.fail = true
      callLlm.mockResolvedValueOnce({ text: TITLES })
      expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      const stored = await draft()
      expect((stored['titleOptions'] as string[]).length).toBeGreaterThan(3)
      expect(stored['titleScores']).toEqual({})
      expect(stored['titleScoreNote']).toBe(
        'VidIQ did not score the titles: the credential store is down',
      )
    })

    it('buys one score for titles that differ only in case', async () => {
      await setBrief(BRIEF)
      await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      const record = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!
      await updatePublishRecord(db, record.id, {
        metadata: { titleOptions: ['Same title here', 'SAME TITLE HERE', 'Other title here'] },
      })
      expect(await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      expect(await db.select().from(vidiqCredits)).toHaveLength(2)
      expect(Object.keys((await draft())['titleScores'] as object).sort()).toEqual([
        'Other title here',
        'Same title here',
      ])
      // The variant counts as scored: nothing is left to buy.
      expect(await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: 'Every title option is already scored.',
      })
    })

    it('after a failure part-way, the duplicate of a bought title is not bought again', async () => {
      await setBrief(BRIEF)
      await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      const record = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!
      await updatePublishRecord(db, record.id, {
        metadata: { titleOptions: ['Same title here', 'SAME TITLE HERE', 'Other title here'] },
      })
      // Reads: the budget check, the first purchase, then the second purchase fails.
      creditsSeam.failOn = 3
      const failed = await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)
      expect(failed).toEqual({
        ok: false,
        error: 'VidIQ scored 1 of 2 titles, then stopped: the ledger is unreachable',
      })
      expect(Object.keys((await draft())['titleScores'] as object)).toEqual(['Same title here'])
      expect(await db.select().from(vidiqCredits)).toHaveLength(1)

      creditsSeam.failOn = 0
      expect(await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      // Only the title never bought: two rows in all, the duplicate never paid for.
      expect(await db.select().from(vidiqCredits)).toHaveLength(2)
    })

    it('Score all refuses a Short, and a project with no brief, before any call', async () => {
      const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
      const chapter = await saveChapter(db, {
        scriptId: script.id,
        index: 0,
        title: 'The audit',
        contentMd: 'EY refused to sign the accounts.',
        estRuntimeSec: 12,
      })
      const short = await insertShort(db, {
        projectId: FIXTURE_PROJECT_ID,
        title: 'Nine days',
        segmentRef: { chapterId: chapter.id, fromParagraph: 0, toParagraph: 0 },
      })
      await setBrief(BRIEF)
      expect(await scoreAllTitlesAction('short', short.id)).toEqual({
        ok: false,
        error: "Only the full film's titles are scored.",
      })
      await setBrief(null)
      expect(await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: 'This project has no search brief, so its titles are not scored.',
      })
      expect(await db.select().from(vidiqCredits)).toHaveLength(0)
    })

    it('Score all refuses before any call when the rest would pass the cap', async () => {
      await setBrief(BRIEF)
      await generateTitles('master', FIXTURE_PROJECT_ID)
      const before = (await draft())['titleScores']
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 20 } })
      const result = await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('about 25 credits; 5 are left of this month')
      expect((await draft())['titleScores']).toEqual(before)
      expect(await db.select().from(vidiqCredits)).toHaveLength(3)
    })
  })
})
