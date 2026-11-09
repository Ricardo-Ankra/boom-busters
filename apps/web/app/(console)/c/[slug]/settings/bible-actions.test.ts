// @vitest-environment node

import {
  archiveChannel,
  bibleDrafts,
  channelSearchSpace,
  createChannel,
  getBibleDraft,
  keywordMeasurements,
  listBibleVersions,
  openBibleDraft,
  providerCredentials,
  recordKeywordMeasurement,
  recordVidiqCredits,
  requireTestDatabase,
  saveBibleVersion,
  saveSearchSpace,
  seed,
  setCredential,
  updateWorkspace,
  vidiqCredits,
  writeBibleDraft,
} from '@boom-busters/db'
import type * as VidiqModule from '@boom-busters/providers/vidiq'
import {
  BIBLE_SECTIONS,
  ChannelBibleSchema,
  DEFAULT_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  EXAMPLE_SLOTS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  bibleDraftUnits,
  defaultFormat,
} from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import {
  analyseSearchSpaceAction,
  approveBibleSectionAction,
  copyBibleFromChannelAction,
  discardBibleDraftAction,
  draftBibleAction,
  editBibleSectionAction,
  estimateBibleResearchAction,
  measureKeywordsAction,
  previewStagePromptAction,
  restoreBibleVersionAction,
  saveBibleAction,
  startBibleResearchAction,
  viewBibleVersionAction,
} from './bible-actions'

/**
 * The research actions against the test database, with the session, the cache,
 * Inngest and the VidIQ client replaced (a client opens a network connection).
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const inngestMock = vi.hoisted(() => ({ send: vi.fn(async () => ({ ids: ['x'] })) }))
vi.mock('@/inngest/client', () => ({ inngest: { send: inngestMock.send } }))

const vidiq = vi.hoisted(() => ({
  balance: vi.fn(async () => ({ totalCredits: 1443, renewableResetsAt: null })),
  close: vi.fn(async () => {}),
  useReal: false,
}))
vi.mock('@boom-busters/providers/vidiq', async (importOriginal) => {
  const original = await importOriginal<typeof VidiqModule>()
  return {
    ...original,
    vidiqClientFor: (key: string | undefined) => {
      if (vidiq.useReal) return original.vidiqClientFor(key)
      return key ? { balance: vidiq.balance, close: vidiq.close } : null
    },
  }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

const INPUTS = {
  description: 'Stories of brands that collapsed',
  audience: '',
  admiredChannels: ['@alpha', '@beta'],
  videos: ['https://youtu.be/dQw4w9WgXcQ'],
  avoid: '',
}
// Two channels, one lookup, the outliers and four transcripts.
const ESTIMATE = 40

describeDb('the bible research actions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vidiq.useReal = false
    vidiq.balance.mockResolvedValue({ totalCredits: 1443, renewableResetsAt: null })
    await seed(db)
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
    await db.delete(bibleDrafts)
    await db.delete(vidiqCredits)
    await db.delete(providerCredentials)
    await setCredential(db, 'vidiq', 'vidiq-test-key', env.SECRETS_ENCRYPTION_KEY)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('estimates the run against the balance and the cap, spending nothing', async () => {
    const result = await estimateBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)
    expect(result).toEqual({ ok: true, estimate: ESTIMATE, balance: 1443, capLeft: 1000 })
    expect(inngestMock.send).not.toHaveBeenCalled()
    expect(vidiq.close).toHaveBeenCalledTimes(1)
  })

  it('asks for a key when there is none', async () => {
    await db.delete(providerCredentials)
    expect(await estimateBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)).toEqual({
      ok: false,
      error: 'Add a VidIQ key in Settings, Connections',
    })
  })

  it('runs under mock providers with no stored key, on the fixture balance', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    vidiq.useReal = true
    await db.delete(providerCredentials)
    const result = await estimateBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)
    expect(result).toEqual({ ok: true, estimate: ESTIMATE, balance: 1443, capLeft: 1000 })
    expect(vidiq.balance).not.toHaveBeenCalled()
  })

  it('asks for a key with the real client when mocks are off and none is stored', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    vidiq.useReal = true
    await db.delete(providerCredentials)
    expect(await estimateBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)).toEqual({
      ok: false,
      error: 'Add a VidIQ key in Settings, Connections',
    })
  })

  it('names the input that is not a YouTube channel', async () => {
    const result = await estimateBibleResearchAction(FIRST_CHANNEL_ID, {
      ...INPUTS,
      admiredChannels: ['not a channel'],
    })
    expect(result).toEqual({ ok: false, error: 'Not a YouTube channel: not a channel' })
  })

  it('says so when VidIQ does not answer the balance call', async () => {
    vidiq.balance.mockRejectedValueOnce(new Error('connection reset'))
    expect(await estimateBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)).toEqual({
      ok: false,
      error: 'VidIQ did not answer: connection reset',
    })
    expect(vidiq.close).toHaveBeenCalledTimes(1)
  })

  it('refuses an estimate above what is left of the monthly cap', async () => {
    await recordVidiqCredits(db, {
      channelId: FIRST_CHANNEL_ID,
      purpose: 'bible-research',
      tool: 'vidiq_outliers',
      args: {},
      credits: 990,
    })
    expect(await estimateBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)).toEqual({
      ok: false,
      error: `This run needs about ${ESTIMATE} credits; 10 are left of this month's cap of 1000.`,
      capped: true,
    })
  })

  it('refuses an estimate above the VidIQ balance', async () => {
    vidiq.balance.mockResolvedValueOnce({ totalCredits: 12, renewableResetsAt: null })
    expect(await estimateBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)).toEqual({
      ok: false,
      error: `This run needs about ${ESTIMATE} credits; the VidIQ balance is 12.`,
    })
  })

  it('refuses to start while a job runs, and sends nothing', async () => {
    await openBibleDraft(db, FIRST_CHANNEL_ID)
    await writeBibleDraft(
      db,
      FIRST_CHANNEL_ID,
      (draft) => ({
        ...draft,
        job: {
          kind: 'draft',
          state: 'running',
          current: null,
          error: null,
          startedAt: new Date().toISOString(),
        },
      }),
      { allowWhileRunning: true },
    )
    const result = await startBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)
    expect(result.ok).toBe(false)
    expect(inngestMock.send).not.toHaveBeenCalled()
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))?.inputs).toBeNull()
  })

  it('does not start when the checks fail', async () => {
    await db.delete(providerCredentials)
    expect(await startBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)).toEqual({
      ok: false,
      error: 'Add a VidIQ key in Settings, Connections',
    })
    expect(inngestMock.send).not.toHaveBeenCalled()
  })

  it('saves the inputs, marks the research running and sends the run', async () => {
    expect(await startBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)).toEqual({ ok: true })
    const draft = await getBibleDraft(db, FIRST_CHANNEL_ID)
    expect(draft?.inputs).toEqual(INPUTS)
    expect(draft?.job).toMatchObject({ kind: 'research', state: 'running' })
    expect(inngestMock.send).toHaveBeenCalledTimes(1)
    expect(inngestMock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'bible/research.requested',
        data: { channelId: FIRST_CHANNEL_ID, jobStartedAt: expect.any(String) },
      }),
    )
    // The run is told which job it owns.
    const sent = (
      inngestMock.send.mock.calls as unknown as [{ data: { jobStartedAt: string } }][]
    )[0]![0]
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))?.job?.startedAt).toBe(sent.data.jobStartedAt)
  })

  it('leaves no draft behind when a check refuses the research', async () => {
    await db.delete(providerCredentials)
    await startBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)
    expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()

    await setCredential(db, 'vidiq', 'vidiq-test-key', env.SECRETS_ENCRYPTION_KEY)
    vidiq.balance.mockResolvedValueOnce({ totalCredits: 3, renewableResetsAt: null })
    expect((await startBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)).ok).toBe(false)
    await startBibleResearchAction(FIRST_CHANNEL_ID, { ...INPUTS, description: '' })
    expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()
    expect(inngestMock.send).not.toHaveBeenCalled()
  })

  it('frees the draft when the run cannot be sent', async () => {
    inngestMock.send.mockRejectedValueOnce(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await startBibleResearchAction(FIRST_CHANNEL_ID, INPUTS)
    expect(result.ok).toBe(false)
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))?.job).toMatchObject({ state: 'failed' })
  })

  describe('draftBibleAction', () => {
    it('asks for a description first when there are no inputs', async () => {
      expect(await draftBibleAction(FIRST_CHANNEL_ID, {})).toEqual({
        ok: false,
        error: 'Describe the channel first',
      })
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('saves the inputs, marks the draft running and sends every section', async () => {
      expect(await draftBibleAction(FIRST_CHANNEL_ID, { inputs: INPUTS })).toEqual({ ok: true })
      const draft = await getBibleDraft(db, FIRST_CHANNEL_ID)
      expect(draft?.inputs).toEqual(INPUTS)
      expect(draft?.job).toMatchObject({ kind: 'draft', state: 'running', error: null })
      expect(inngestMock.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'bible/draft.requested',
          data: {
            channelId: FIRST_CHANNEL_ID,
            units: bibleDraftUnits(),
            jobStartedAt: expect.any(String),
          },
        }),
      )
    })

    it('stores the requested units and steer on the job, for Try again', async () => {
      await draftBibleAction(FIRST_CHANNEL_ID, { inputs: INPUTS })
      await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({ ...draft, job: null }), {
        allowWhileRunning: true,
      })
      await draftBibleAction(FIRST_CHANNEL_ID, { sections: ['voice'], steer: 'more clinical' })
      const job = (await getBibleDraft(db, FIRST_CHANNEL_ID))?.job
      expect(job).toMatchObject({ units: [{ section: 'voice' }], steer: 'more clinical' })
      expect(job?.heartbeatAt).toBe(job?.startedAt)
    })

    it('leaves no draft behind when a check refuses the draft', async () => {
      await draftBibleAction(FIRST_CHANNEL_ID, {})
      await draftBibleAction(FIRST_CHANNEL_ID, { inputs: { ...INPUTS, description: '' } })
      await draftBibleAction(FIRST_CHANNEL_ID, { inputs: INPUTS, sections: [] })
      await draftBibleAction(FIRST_CHANNEL_ID, { inputs: INPUTS, slotId: 'nope-nope' })
      expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('redrafts one section with a steer, on the inputs already saved', async () => {
      await draftBibleAction(FIRST_CHANNEL_ID, { inputs: INPUTS })
      await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({ ...draft, job: null }), {
        allowWhileRunning: true,
      })
      inngestMock.send.mockClear()
      expect(
        await draftBibleAction(FIRST_CHANNEL_ID, { sections: ['voice'], steer: 'more clinical' }),
      ).toEqual({ ok: true })
      expect(inngestMock.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            channelId: FIRST_CHANNEL_ID,
            units: [{ section: 'voice' }],
            steer: 'more clinical',
            jobStartedAt: expect.any(String),
          },
        }),
      )
    })

    it('drafts one slot, and refuses an unknown one', async () => {
      await draftBibleAction(FIRST_CHANNEL_ID, { inputs: INPUTS })
      await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({ ...draft, job: null }), {
        allowWhileRunning: true,
      })
      inngestMock.send.mockClear()
      const slotId = EXAMPLE_SLOTS[0]!.id
      expect(await draftBibleAction(FIRST_CHANNEL_ID, { slotId: 'nope-nope' })).toEqual({
        ok: false,
        error: 'Unknown example',
      })
      expect(await draftBibleAction(FIRST_CHANNEL_ID, { slotId })).toEqual({ ok: true })
      expect(inngestMock.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            channelId: FIRST_CHANNEL_ID,
            units: [{ section: 'examples', slotId }],
            jobStartedAt: expect.any(String),
          },
        }),
      )
    })

    it('refuses while a job runs, and sends nothing', async () => {
      await draftBibleAction(FIRST_CHANNEL_ID, { inputs: INPUTS })
      inngestMock.send.mockClear()
      const result = await draftBibleAction(FIRST_CHANNEL_ID, { sections: ['voice'] })
      expect(result.ok).toBe(false)
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('frees the draft when the run cannot be sent', async () => {
      inngestMock.send.mockRejectedValueOnce(new Error('down'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await draftBibleAction(FIRST_CHANNEL_ID, { inputs: INPUTS })
      expect(result.ok).toBe(false)
      expect((await getBibleDraft(db, FIRST_CHANNEL_ID))?.job).toMatchObject({
        kind: 'draft',
        state: 'failed',
      })
    })
  })
})

describeDb('the bible edit, approve, save and discard actions', () => {
  const SLOT_ID = EXAMPLE_SLOTS[0]!.id
  // Eight or more words a research quote and an example can share.
  const RUN = 'the quiet collapse of a bank that nobody thought could fall'
  const DIGEST = {
    patterns: [
      {
        kind: 'hook' as const,
        pattern: 'Opens on a cold fact',
        quote: RUN,
        sources: [{ videoId: 'v1', channel: 'Alpha', title: 'The Fall', own: false }],
      },
    ],
    videos: [],
  }

  async function openWithResearch() {
    await openBibleDraft(db, FIRST_CHANNEL_ID)
    await writeBibleDraft(db, FIRST_CHANNEL_ID, (current) => ({ ...current, research: DIGEST }))
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    await db.delete(bibleDrafts)
  })

  it('edits a section, opens the draft, approves it and takes only that section', async () => {
    expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()
    const result = await editBibleSectionAction(FIRST_CHANNEL_ID, 'search', {
      channelHashtag: 'BankingCollapse',
      channelTags: ['finance', 'history'],
    })
    expect(result.ok).toBe(true)

    const draft = await getBibleDraft(db, FIRST_CHANNEL_ID)
    expect(draft?.bible.channelHashtag).toBe('BankingCollapse')
    expect(draft?.bible.channelTags).toEqual(['finance', 'history'])
    expect(draft?.statuses.search).toBe('approved')
    // A field of the section the patch left out keeps its value.
    expect(draft?.bible.language).toBe(FIRST_CHANNEL_BIBLE.language)
    expect(draft?.bible.subject).toBe(FIRST_CHANNEL_BIBLE.subject)
  })

  it('refuses a key outside the section and a value the schema refuses', async () => {
    expect(await editBibleSectionAction(FIRST_CHANNEL_ID, 'search', { subject: 'x' })).toEqual({
      ok: false,
      error: 'subject is not part of this section',
    })
    const bad = await editBibleSectionAction(FIRST_CHANNEL_ID, 'search', { country: 'USA' })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('country')
    expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()
  })

  it('refuses every change while a job runs', async () => {
    await openBibleDraft(db, FIRST_CHANNEL_ID)
    await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({
      ...draft,
      job: {
        kind: 'draft',
        state: 'running',
        current: null,
        error: null,
        startedAt: new Date().toISOString(),
      },
    }))
    const wait = { ok: false, error: 'Wait for the draft to finish' }
    expect(await editBibleSectionAction(FIRST_CHANNEL_ID, 'search', { language: 'fr' })).toEqual(
      wait,
    )
    expect(await approveBibleSectionAction(FIRST_CHANNEL_ID, 'search')).toEqual(wait)
    expect(await saveBibleAction(FIRST_CHANNEL_ID, '')).toEqual(wait)
    expect(await discardBibleDraftAction(FIRST_CHANNEL_ID)).toEqual(wait)
  })

  it('keeps the flag on an example that still overlaps and clears it once it is reworded', async () => {
    await openWithResearch()
    const flagged = await editBibleSectionAction(FIRST_CHANNEL_ID, 'examples', {
      examples: { [SLOT_ID]: `He wrote about ${RUN} in 1907.` },
    })
    expect(flagged.ok).toBe(true)
    expect(Object.keys((await getBibleDraft(db, FIRST_CHANNEL_ID))!.tooClose)).toEqual([
      `examples.${SLOT_ID}`,
    ])

    // Typing over the same words does not pass.
    await editBibleSectionAction(FIRST_CHANNEL_ID, 'examples', {
      examples: { [SLOT_ID]: `He wrote about ${RUN} in 1912.` },
    })
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.tooClose[`examples.${SLOT_ID}`]).toEqual({
      source: 'Alpha: The Fall',
      run: 'the quiet collapse of a bank that nobody',
    })

    await editBibleSectionAction(FIRST_CHANNEL_ID, 'examples', {
      examples: { [SLOT_ID]: 'A short line of its own.' },
    })
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.tooClose).toEqual({})
  })

  it('refuses to approve a section with a flagged field', async () => {
    await openWithResearch()
    await editBibleSectionAction(FIRST_CHANNEL_ID, 'examples', {
      examples: { [SLOT_ID]: `He wrote about ${RUN} in 1907.` },
    })
    await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({
      ...draft,
      statuses: { ...draft.statuses, examples: 'drafted' },
    }))
    const result = await approveBibleSectionAction(FIRST_CHANNEL_ID, 'examples')
    expect(result.ok).toBe(false)
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.statuses.examples).toBe('drafted')
  })

  it('approves Examples when the only stored flag is on a retired slot', async () => {
    await openBibleDraft(db, FIRST_CHANNEL_ID)
    await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({
      ...draft,
      statuses: { ...draft.statuses, examples: 'drafted' },
      tooClose: { 'examples.graphics-worked-beat': { source: 'Alpha: The Fall', run: 'a b c' } },
    }))
    expect((await approveBibleSectionAction(FIRST_CHANNEL_ID, 'examples')).ok).toBe(true)
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.statuses.examples).toBe('approved')
  })

  it('approves a drafted section', async () => {
    await openBibleDraft(db, FIRST_CHANNEL_ID)
    await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({
      ...draft,
      statuses: { ...draft.statuses, voice: 'drafted' },
    }))
    expect((await approveBibleSectionAction(FIRST_CHANNEL_ID, 'voice')).ok).toBe(true)
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.statuses.voice).toBe('approved')
  })

  it('names what blocks a save, and saves a new version once approved', async () => {
    await openBibleDraft(db, FIRST_CHANNEL_ID)
    await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({
      ...draft,
      statuses: { ...draft.statuses, voice: 'drafted' },
    }))
    expect(await saveBibleAction(FIRST_CHANNEL_ID, '')).toEqual({
      ok: false,
      error: 'The draft cannot be saved yet',
      blockers: ['Voice is drafted, not approved'],
    })

    await approveBibleSectionAction(FIRST_CHANNEL_ID, 'voice')
    const before = (await listBibleVersions(db, FIRST_CHANNEL_ID)).length
    expect(await saveBibleAction(FIRST_CHANNEL_ID, '  Tightened the voice  ')).toEqual({ ok: true })
    const versions = await listBibleVersions(db, FIRST_CHANNEL_ID)
    expect(versions).toHaveLength(before + 1)
    expect(versions.at(-1)?.note).toBe('Tightened the voice')
    expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()
  })

  it('defaults the note to how the draft was made', async () => {
    await editBibleSectionAction(FIRST_CHANNEL_ID, 'search', { language: 'en' })
    await saveBibleAction(FIRST_CHANNEL_ID, '')
    expect((await listBibleVersions(db, FIRST_CHANNEL_ID)).at(-1)?.note).toBe(
      'Edited in the Bible tab',
    )

    await openWithResearch()
    await saveBibleAction(FIRST_CHANNEL_ID, '')
    expect((await listBibleVersions(db, FIRST_CHANNEL_ID)).at(-1)?.note).toBe('Drafted with AI')
  })

  it('has nothing to save or discard without a draft, and discards one that exists', async () => {
    expect((await saveBibleAction(FIRST_CHANNEL_ID, '')).ok).toBe(false)
    expect((await discardBibleDraftAction(FIRST_CHANNEL_ID)).ok).toBe(false)

    await editBibleSectionAction(FIRST_CHANNEL_ID, 'search', { language: 'fr' })
    expect(await discardBibleDraftAction(FIRST_CHANNEL_ID)).toEqual({ ok: true })
    expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()
  })

  it('leaves no draft behind when the first edit is invalid', async () => {
    const bad = await editBibleSectionAction(FIRST_CHANNEL_ID, 'search', { country: 'USA' })
    expect(bad.ok).toBe(false)
    expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()
  })

  it('saves a YouTube category id and refuses one that is not a number', async () => {
    expect(
      (await editBibleSectionAction(FIRST_CHANNEL_ID, 'publishing', { youtubeCategoryId: '27' }))
        .ok,
    ).toBe(true)
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.bible.youtubeCategoryId).toBe('27')

    const bad = await editBibleSectionAction(FIRST_CHANNEL_ID, 'publishing', {
      youtubeCategoryId: 'abc',
    })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('youtubeCategoryId')
    expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.bible.youtubeCategoryId).toBe('27')
  })

  it('refuses an edit on an archived channel', async () => {
    const channel = await createChannel(db, {
      name: 'Old',
      handle: null,
      slug: `old-${Date.now()}`,
      settings: DEFAULT_SETTINGS,
      bible: ChannelBibleSchema.parse({}),
    })
    await archiveChannel(db, channel.id)
    const result = await editBibleSectionAction(channel.id, 'search', { language: 'fr' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/archived/i)
    expect(await getBibleDraft(db, channel.id)).toBeNull()
  })

  describe('measureKeywordsAction', () => {
    const DAY = 24 * 60 * 60 * 1000

    /** The draft's formats carry the first keyword list; the first pillar gets the second. */
    const keywordDraft = async (formatKeywords: string[], pillarKeywords: string[]) => {
      await openBibleDraft(db, FIRST_CHANNEL_ID)
      await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({
        ...draft,
        bible: {
          ...draft.bible,
          formats: draft.bible.formats.map((format, i) =>
            i === 0 ? { ...format, keywords: formatKeywords } : format,
          ),
          caseCategories: draft.bible.caseCategories.map((category, i) =>
            i === 0 ? { ...category, keywords: pillarKeywords } : category,
          ),
        },
      }))
    }

    beforeEach(async () => {
      await db.delete(keywordMeasurements)
    })

    it('sends the keywords not measured in 30 days and returns 5 credits each', async () => {
      await keywordDraft(['alpha', 'beta'], ['Gamma', 'ALPHA'])
      await recordKeywordMeasurement(db, {
        channelId: FIRST_CHANNEL_ID,
        keyword: 'beta',
        volume: 1,
        competition: 1,
        overall: 1,
        estimatedMonthlySearch: 1,
        credits: 5,
        measuredAt: new Date(Date.now() - 10 * DAY),
      })
      expect(await measureKeywordsAction(FIRST_CHANNEL_ID)).toEqual({ ok: true, credits: 10 })
      expect(inngestMock.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'channel/keywords.measure',
          data: { channelId: FIRST_CHANNEL_ID, keywords: ['alpha', 'Gamma'] },
        }),
      )
    })

    it('refuses over the cap with the cap numbers and sends nothing', async () => {
      await keywordDraft(['alpha', 'beta'], [])
      await recordVidiqCredits(db, {
        channelId: FIRST_CHANNEL_ID,
        purpose: 'bible-research',
        tool: 'vidiq_outliers',
        args: {},
        credits: 995,
      })
      expect(await measureKeywordsAction(FIRST_CHANNEL_ID)).toEqual({
        ok: false,
        error: "This run needs about 10 credits; 5 are left of this month's cap of 1000.",
        capped: true,
      })
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('says so plainly, and sends nothing, when every keyword was measured lately', async () => {
      await keywordDraft(['alpha'], [])
      await recordKeywordMeasurement(db, {
        channelId: FIRST_CHANNEL_ID,
        keyword: 'Alpha',
        volume: null,
        competition: null,
        overall: null,
        estimatedMonthlySearch: null,
        credits: 5,
        measuredAt: new Date(Date.now() - 2 * DAY),
      })
      expect(await measureKeywordsAction(FIRST_CHANNEL_ID)).toEqual({
        ok: false,
        error: 'Every keyword was measured in the last 30 days',
      })
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('measures the current version when there is no draft', async () => {
      expect(await getBibleDraft(db, FIRST_CHANNEL_ID)).toBeNull()
      // The seeded bible has no keywords yet, so there is nothing to measure.
      expect((await measureKeywordsAction(FIRST_CHANNEL_ID)).ok).toBe(false)
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('refuses an archived channel and an unknown one', async () => {
      const channel = await createChannel(db, {
        name: 'Old',
        handle: null,
        slug: `old-measure-${Date.now()}`,
        settings: DEFAULT_SETTINGS,
        bible: ChannelBibleSchema.parse({}),
      })
      await archiveChannel(db, channel.id)
      const result = await measureKeywordsAction(channel.id)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toMatch(/archived/i)
      expect(await measureKeywordsAction('not-an-id')).toEqual({
        ok: false,
        error: 'Unknown channel',
      })
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('says so when Inngest cannot be reached', async () => {
      await keywordDraft(['alpha'], [])
      inngestMock.send.mockRejectedValueOnce(new Error('down'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await measureKeywordsAction(FIRST_CHANNEL_ID)
      expect(result.ok).toBe(false)
    })
  })

  describe('analyseSearchSpaceAction', () => {
    const DAY = 24 * 60 * 60 * 1000

    const formatDraft = async (keywords: string[]) => {
      await openBibleDraft(db, FIRST_CHANNEL_ID)
      await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({
        ...draft,
        bible: {
          ...draft.bible,
          formats: draft.bible.formats.map((format, i) =>
            i === 0 ? { ...format, keywords } : format,
          ),
        },
      }))
      return (await getBibleDraft(db, FIRST_CHANNEL_ID))!.bible.formats[0]!.key
    }

    beforeEach(async () => {
      await db.delete(channelSearchSpace)
      await db.delete(vidiqCredits)
    })

    it('sends the format keywords not analysed in 30 days and returns 10 credits each', async () => {
      const key = await formatDraft(['alpha', 'beta', 'Alpha'])
      await saveSearchSpace(db, {
        channelId: FIRST_CHANNEL_ID,
        keyword: 'beta',
        measuredAt: new Date(Date.now() - 10 * DAY),
        outliers: [],
        titlePatterns: [],
        durations: null,
        credits: 10,
      })
      expect(await analyseSearchSpaceAction(FIRST_CHANNEL_ID, key)).toEqual({
        ok: true,
        credits: 10,
      })
      expect(inngestMock.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'channel/search_space.analyse',
          data: { channelId: FIRST_CHANNEL_ID, keywords: ['alpha'] },
        }),
      )
    })

    it('refuses over the cap with the cap numbers and sends nothing', async () => {
      const key = await formatDraft(['alpha', 'beta'])
      await recordVidiqCredits(db, {
        channelId: FIRST_CHANNEL_ID,
        purpose: 'bible-research',
        tool: 'vidiq_outliers',
        args: {},
        credits: 985,
      })
      expect(await analyseSearchSpaceAction(FIRST_CHANNEL_ID, key)).toEqual({
        ok: false,
        error: "This run needs about 20 credits; 15 are left of this month's cap of 1000.",
        capped: true,
      })
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('says so plainly when every keyword was analysed lately', async () => {
      const key = await formatDraft(['alpha'])
      await saveSearchSpace(db, {
        channelId: FIRST_CHANNEL_ID,
        keyword: 'Alpha',
        measuredAt: new Date(Date.now() - 2 * DAY),
        outliers: [],
        titlePatterns: [],
        durations: null,
        credits: 10,
      })
      expect(await analyseSearchSpaceAction(FIRST_CHANNEL_ID, key)).toEqual({
        ok: false,
        error: 'Every keyword of this format was analysed in the last 30 days',
      })
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('refuses a format with no keywords, an unknown format, an unknown channel', async () => {
      const key = await formatDraft([])
      expect((await analyseSearchSpaceAction(FIRST_CHANNEL_ID, key)).ok).toBe(false)
      expect(await analyseSearchSpaceAction(FIRST_CHANNEL_ID, 'no-such-format')).toEqual({
        ok: false,
        error: 'Unknown format',
      })
      expect(await analyseSearchSpaceAction('not-an-id', key)).toEqual({
        ok: false,
        error: 'Unknown channel',
      })
      expect(inngestMock.send).not.toHaveBeenCalled()
    })

    it('refuses an archived channel', async () => {
      const channel = await createChannel(db, {
        name: 'Old',
        handle: null,
        slug: `old-space-${Date.now()}`,
        settings: DEFAULT_SETTINGS,
        bible: ChannelBibleSchema.parse({}),
      })
      await archiveChannel(db, channel.id)
      const result = await analyseSearchSpaceAction(channel.id, 'main')
      expect(result.ok === false && result.error).toMatch(/archived/i)
    })

    it('says so when Inngest cannot be reached', async () => {
      const key = await formatDraft(['alpha'])
      inngestMock.send.mockRejectedValueOnce(new Error('down'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect((await analyseSearchSpaceAction(FIRST_CHANNEL_ID, key)).ok).toBe(false)
    })
  })

  describe('history and the prompt preview', () => {
    it('restores an earlier version as the next one', async () => {
      const [first] = await listBibleVersions(db, FIRST_CHANNEL_ID)
      const result = await restoreBibleVersionAction(FIRST_CHANNEL_ID, first!.id)
      expect(result).toEqual({ ok: true })
      const versions = await listBibleVersions(db, FIRST_CHANNEL_ID)
      const last = versions[versions.length - 1]!
      expect(last.version).toBe(versions.length)
      expect(last.note).toBe(`Restored version ${first!.version}`)
    })

    it('asks to save or discard the draft first while one is open', async () => {
      const [first] = await listBibleVersions(db, FIRST_CHANNEL_ID)
      const before = (await listBibleVersions(db, FIRST_CHANNEL_ID)).length
      await openBibleDraft(db, FIRST_CHANNEL_ID)
      const result = await restoreBibleVersionAction(FIRST_CHANNEL_ID, first!.id)
      expect(result).toEqual({ ok: false, error: 'Save or discard the draft first' })
      expect((await listBibleVersions(db, FIRST_CHANNEL_ID)).length).toBe(before)
    })

    it("refuses another channel's version on restore and on view", async () => {
      const other = await createChannel(db, {
        name: 'Other',
        handle: null,
        slug: `other-${Date.now()}`,
        settings: DEFAULT_SETTINGS,
        bible: ChannelBibleSchema.parse({}),
      })
      const [theirs] = await listBibleVersions(db, other.id)
      const viewed = await viewBibleVersionAction(FIRST_CHANNEL_ID, theirs!.id)
      expect(viewed.ok).toBe(false)
      const restored = await restoreBibleVersionAction(FIRST_CHANNEL_ID, theirs!.id)
      expect(restored.ok).toBe(false)
    })

    it('shows a version of its own channel', async () => {
      const [first] = await listBibleVersions(db, FIRST_CHANNEL_ID)
      const viewed = await viewBibleVersionAction(FIRST_CHANNEL_ID, first!.id)
      expect(viewed.ok).toBe(true)
      if (viewed.ok) expect(viewed.bible.subject).toBe(FIRST_CHANNEL_BIBLE.subject)
    })

    it('composes the stage prompt for a valid bible', async () => {
      const result = await previewStagePromptAction(FIRST_CHANNEL_ID, 'script', FIRST_CHANNEL_BIBLE)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.text.length).toBeGreaterThan(0)
    })

    it('returns the schema message for an invalid bible', async () => {
      const result = await previewStagePromptAction(FIRST_CHANNEL_ID, 'script', {
        ...FIRST_CHANNEL_BIBLE,
        youtubeCategoryId: 'abc',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('youtubeCategoryId')
    })

    it('refuses an unknown stage', async () => {
      const result = await previewStagePromptAction(FIRST_CHANNEL_ID, 'nope', FIRST_CHANNEL_BIBLE)
      expect(result).toEqual({ ok: false, error: 'Unknown stage' })
    })
  })
})

describeDb('copying the bible from another channel', () => {
  const SLOT_ID = EXAMPLE_SLOTS[0]!.id
  const RUN = 'the quiet collapse of a bank that nobody thought could fall'

  async function makeChannel(name: string) {
    return createChannel(db, {
      name,
      handle: null,
      slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      settings: DEFAULT_SETTINGS,
      bible: ChannelBibleSchema.parse({}),
    })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    await db.delete(bibleDrafts)
  })

  it('overwrites only the ticked sections, marks them drafted and returns the note', async () => {
    const target = await makeChannel('Target')
    await editBibleSectionAction(target.id, 'search', { language: 'fr' })
    await editBibleSectionAction(target.id, 'publishing', { youtubeCategoryId: '27' })

    const result = await copyBibleFromChannelAction(target.id, FIRST_CHANNEL_ID, [
      'identity',
      'search',
    ])
    expect(result.ok).toBe(true)
    const latest = (await listBibleVersions(db, FIRST_CHANNEL_ID)).at(-1)!
    expect(result.note).toBe(`Copied from Boom & Busters version ${latest.version}`)

    const draft = (await getBibleDraft(db, target.id))!
    for (const key of [...BIBLE_SECTIONS.identity, ...BIBLE_SECTIONS.search]) {
      expect(draft.bible[key]).toEqual(FIRST_CHANNEL_BIBLE[key])
    }
    expect(draft.statuses.identity).toBe('drafted')
    expect(draft.statuses.search).toBe('drafted')
    // An unticked section keeps the draft's edit and its status.
    expect(draft.bible.youtubeCategoryId).toBe('27')
    expect(draft.statuses.publishing).toBe('approved')
    expect(result.draft).toEqual(draft)
  })

  it('copies formats, the channel hashtag and the footer', async () => {
    const source = await makeChannel('Source')
    await saveBibleVersion(
      db,
      source.id,
      {
        ...ChannelBibleSchema.parse({}),
        formats: [{ ...defaultFormat('Sleep'), keywords: ['sleep'] }],
        channelHashtag: 'SleepWell',
        channelFooter: 'Sweet dreams.',
      },
      'v2',
    )
    const target = await makeChannel('Target')

    const result = await copyBibleFromChannelAction(target.id, source.id, [
      'formats',
      'search',
      'publishing',
    ])
    expect(result.ok).toBe(true)
    const draft = (await getBibleDraft(db, target.id))!
    expect(draft.bible.formats).toEqual([{ ...defaultFormat('Sleep'), keywords: ['sleep'] }])
    expect(draft.bible.channelHashtag).toBe('SleepWell')
    expect(draft.bible.channelFooter).toBe('Sweet dreams.')
    expect(draft.statuses.formats).toBe('drafted')
  })

  it('copies the source research profile', async () => {
    const source = await makeChannel('Source')
    await saveBibleVersion(
      db,
      source.id,
      { ...ChannelBibleSchema.parse({}), researchProfile: 'science' },
      'v2',
    )
    const target = await makeChannel('Target')

    const result = await copyBibleFromChannelAction(target.id, source.id, ['identity'])
    expect(result.ok).toBe(true)
    expect((await getBibleDraft(db, target.id))!.bible.researchProfile).toBe('science')
  })

  it('copies the source current version, not an older one', async () => {
    const source = await makeChannel('Source')
    await saveBibleVersion(db, source.id, { ...ChannelBibleSchema.parse({}), language: 'de' }, 'v2')
    await saveBibleVersion(db, source.id, { ...ChannelBibleSchema.parse({}), language: 'es' }, 'v3')
    const target = await makeChannel('Target')

    const result = await copyBibleFromChannelAction(target.id, source.id, ['search'])
    expect(result.note).toBe('Copied from Source version 3')
    expect((await getBibleDraft(db, target.id))!.bible.language).toBe('es')
    // Nothing was saved as a version.
    expect((await listBibleVersions(db, target.id)).length).toBe(1)
  })

  it('copies from an archived source', async () => {
    const source = await makeChannel('Old source')
    await archiveChannel(db, source.id)
    const target = await makeChannel('Target')
    const result = await copyBibleFromChannelAction(target.id, source.id, ['voice'])
    expect(result.ok).toBe(true)
    expect(result.note).toBe('Copied from Old source version 1')
  })

  it('refuses without leaving a draft behind', async () => {
    const target = await makeChannel('Target')
    const archived = await makeChannel('Archived target')
    await archiveChannel(db, archived.id)

    expect(await copyBibleFromChannelAction(target.id, target.id, ['voice'])).toEqual({
      ok: false,
      error: 'Choose another channel',
    })
    expect(await copyBibleFromChannelAction(target.id, FIRST_CHANNEL_ID, [])).toEqual({
      ok: false,
      error: 'Tick at least one section',
    })
    expect(await copyBibleFromChannelAction(target.id, FIRST_CHANNEL_ID, 'voice')).toEqual({
      ok: false,
      error: 'Tick at least one section',
    })
    expect(await copyBibleFromChannelAction(target.id, FIRST_CHANNEL_ID, ['nope'])).toEqual({
      ok: false,
      error: 'Unknown section',
    })
    expect(
      await copyBibleFromChannelAction(target.id, '01ARZ3NDEKTSV4RRFFQ69G5FAV', ['voice']),
    ).toEqual({ ok: false, error: 'Unknown channel' })
    expect(await copyBibleFromChannelAction('nope', FIRST_CHANNEL_ID, ['voice'])).toEqual({
      ok: false,
      error: 'Unknown channel',
    })
    const refused = await copyBibleFromChannelAction(archived.id, FIRST_CHANNEL_ID, ['voice'])
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/archived/i)

    expect(await getBibleDraft(db, target.id)).toBeNull()
    expect(await getBibleDraft(db, archived.id)).toBeNull()
  })

  it('refuses while a job runs and leaves the draft as it was', async () => {
    const target = await makeChannel('Target')
    await openBibleDraft(db, target.id)
    await writeBibleDraft(db, target.id, (draft) => ({
      ...draft,
      job: {
        kind: 'draft',
        state: 'running',
        current: null,
        error: null,
        startedAt: new Date().toISOString(),
      },
    }))
    expect(await copyBibleFromChannelAction(target.id, FIRST_CHANNEL_ID, ['voice'])).toEqual({
      ok: false,
      error: 'Wait for the draft to finish',
    })
    expect((await getBibleDraft(db, target.id))!.statuses.voice).toBe('approved')
  })

  it('clears the errors of a copied section and keeps the others', async () => {
    const target = await makeChannel('Target')
    await openBibleDraft(db, target.id)
    await writeBibleDraft(db, target.id, (draft) => ({
      ...draft,
      errors: { voice: 'it failed', search: 'it failed too' },
    }))
    await copyBibleFromChannelAction(target.id, FIRST_CHANNEL_ID, ['voice'])
    const errors = (await getBibleDraft(db, target.id))!.errors
    expect(Object.keys(errors)).toEqual(['search'])
  })

  it('neither flags nor keeps a retired slot key on an Examples edit', async () => {
    const copied = FIRST_CHANNEL_BIBLE.examples['direction-worked-example']!.split(/\s+/)
      .slice(0, 12)
      .join(' ')
    const second = await makeChannel('Second')
    await saveBibleVersion(
      db,
      second.id,
      {
        ...ChannelBibleSchema.parse({}),
        examples: { [SLOT_ID]: 'A line of its own.', 'graphics-worked-beat': copied },
      },
      'holds a retired key',
    )
    const result = await editBibleSectionAction(second.id, 'examples', {
      examples: { [SLOT_ID]: 'Another line of its own.' },
    })
    expect(result.ok).toBe(true)
    const draft = result.draft!
    expect(
      Object.keys(draft.tooClose).filter((k) => k.startsWith('examples.graphics-worked')),
    ).toEqual([])
    expect(draft.bible.examples).not.toHaveProperty('graphics-worked-beat')
  })

  it('recomputes the overlap flags of a copied examples section', async () => {
    const source = await makeChannel('Source')
    await saveBibleVersion(
      db,
      source.id,
      {
        ...ChannelBibleSchema.parse({}),
        examples: { [SLOT_ID]: `He wrote about ${RUN} in 1907.` },
      },
      'with a close example',
    )
    const target = await makeChannel('Target')
    await openBibleDraft(db, target.id)
    await writeBibleDraft(db, target.id, (draft) => ({
      ...draft,
      research: {
        patterns: [
          {
            kind: 'hook' as const,
            pattern: 'Opens on a cold fact',
            quote: RUN,
            sources: [{ videoId: 'v1', channel: 'Alpha', title: 'The Fall', own: false }],
          },
        ],
        videos: [],
      },
      tooClose: { [`examples.${SLOT_ID}`]: { source: 'Old', run: 'old run' } },
    }))

    await copyBibleFromChannelAction(target.id, source.id, ['examples'])
    expect((await getBibleDraft(db, target.id))!.tooClose[`examples.${SLOT_ID}`]).toEqual({
      source: 'Alpha: The Fall',
      run: 'the quiet collapse of a bank that nobody',
    })

    // Copying a clean examples map clears the flag again.
    const clean = await makeChannel('Clean')
    await copyBibleFromChannelAction(target.id, clean.id, ['examples'])
    expect((await getBibleDraft(db, target.id))!.tooClose).toEqual({})
  })
})
