// @vitest-environment node

import {
  archiveChannel,
  bibleDrafts,
  createChannel,
  getBibleDraft,
  listBibleVersions,
  openBibleDraft,
  providerCredentials,
  recordVidiqCredits,
  requireTestDatabase,
  seed,
  setCredential,
  updateWorkspace,
  vidiqCredits,
  writeBibleDraft,
} from '@boom-busters/db'
import type * as VidiqModule from '@boom-busters/providers/vidiq'
import {
  ChannelBibleSchema,
  DEFAULT_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  EXAMPLE_SLOTS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  bibleDraftUnits,
} from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import {
  approveBibleSectionAction,
  discardBibleDraftAction,
  draftBibleAction,
  editBibleSectionAction,
  estimateBibleResearchAction,
  saveBibleAction,
  startBibleResearchAction,
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
        data: { channelId: FIRST_CHANNEL_ID },
      }),
    )
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
          data: { channelId: FIRST_CHANNEL_ID, units: bibleDraftUnits() },
        }),
      )
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
          data: { channelId: FIRST_CHANNEL_ID, units: [{ section: 'examples', slotId }] },
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
      keywordContext: 'banking collapse',
      channelTags: ['finance', 'history'],
    })
    expect(result.ok).toBe(true)

    const draft = await getBibleDraft(db, FIRST_CHANNEL_ID)
    expect(draft?.bible.keywordContext).toBe('banking collapse')
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
})
