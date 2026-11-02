// @vitest-environment node

import {
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
const credentialSeam = vi.hoisted(() => ({ fail: false, message: 'the credential store is down' }))
vi.mock('@boom-busters/db', async (importOriginal) => {
  const original = await importOriginal<typeof DbModule>()
  return {
    ...original,
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
      credentialSeam.fail = true
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
      credentialSeam.fail = true
      expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      const stored = await draft()
      expect((stored['titleOptions'] as string[]).length).toBeGreaterThan(3)
      expect(stored['titleScores']).toEqual({})
      expect(stored['titleScoreNote']).toBe(
        'VidIQ did not score the titles: the credential store is down',
      )
    })

    it('buys one score for titles that differ only in case, and gives the copy the same score', async () => {
      await setBrief(BRIEF)
      await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      const record = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!
      await updatePublishRecord(db, record.id, {
        metadata: { titleOptions: ['Same title here', 'SAME TITLE HERE', 'Other title here'] },
      })
      expect(await scoreAllTitlesAction('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      expect(await db.select().from(vidiqCredits)).toHaveLength(2)
      const scores = (await draft())['titleScores'] as Record<string, number | null>
      expect(Object.keys(scores).sort()).toEqual(
        ['Other title here', 'SAME TITLE HERE', 'Same title here'].sort(),
      )
      expect(scores['SAME TITLE HERE']).toBe(scores['Same title here'])
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
