// @vitest-environment node

import {
  bibleDrafts,
  getBibleDraft,
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
import { DEFAULT_WORKSPACE_SETTINGS, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { estimateBibleResearchAction, startBibleResearchAction } from './bible-actions'

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
})
