// @vitest-environment node

import {
  archiveChannel,
  createCase,
  createChannel,
  listCases,
  requireTestDatabase,
  seed,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { addCase, startProjectFromCase, suggestCases } from '../cases/actions'
import { saveSettings } from './actions'
import { updateChannelAction } from './channel-actions'
import {
  addLogoFromUrlAction,
  createLogoUploadAction,
  finaliseLogoAction,
  removeLogoAction,
  renameLogoAction,
  setChannelMarkAction,
} from './logo-actions'
import { addPronunciation, checkPronunciation, generateAuditions } from './voice-actions'

/**
 * An archived channel is read-only (Ruling 16): every action that changes a
 * channel refuses before it reads anything else, in the same words.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: vi.fn() }) }))
const send = vi.hoisted(() => vi.fn())
vi.mock('@/inngest/client', () => ({ inngest: { send } }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => true,
  logoKey: () => 'k',
  presignPut: async () => 'https://r2.example/put',
  putObject: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
  auditionKey: () => 'a',
}))
vi.mock('@/lib/remote-image', () => ({ fetchRemoteLogo: vi.fn() }))
const synthesise = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tts', () => ({ synthesise }))

const describeDb = requireTestDatabase() ? describe : describe.skip
const ARCHIVED = { ok: false, error: 'This channel is archived' }
const HASH = 'c'.repeat(64)
const SOME_ID = '01BB0000000000000000000077'

describeDb('an archived channel is read-only', () => {
  let channelId: string
  let caseId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    const channel = await createChannel(db, {
      name: 'Archived',
      handle: null,
      slug: `arch-${Math.random().toString(36).slice(2, 9)}`,
      settings: DEFAULT_SETTINGS,
      bible: FIRST_CHANNEL_BIBLE,
    })
    channelId = channel.id
    const kase = await createCase(db, {
      channelId,
      title: 'Wirecard',
      category: 'con',
      status: 'shortlisted',
    })
    caseId = kase.id
    await archiveChannel(db, channelId)
  })

  const calls: [string, () => Promise<unknown>][] = [
    [
      'addCase',
      () =>
        addCase(channelId, {
          title: 'Enron',
          category: 'collapse',
          subject: 'Enron',
          priorityScore: 5,
        }),
    ],
    ['suggestCases', () => suggestCases(channelId, { count: 3 })],
    ['startProjectFromCase', () => startProjectFromCase(caseId)],
    ['updateChannelAction', () => updateChannelAction(channelId, { name: 'Renamed' })],
    ['saveSettings', () => saveSettings(channelId, { tts: { voiceId: 'v' } })],
    [
      'createLogoUploadAction',
      () =>
        createLogoUploadAction(channelId, {
          fileType: 'image/png',
          fileSize: 10,
          contentHash: HASH,
        }),
    ],
    [
      'finaliseLogoAction',
      () =>
        finaliseLogoAction(channelId, {
          key: `boom-busters/logos/${HASH}.png`,
          contentHash: HASH,
          title: 'Acme',
          width: 1,
          height: 1,
        }),
    ],
    [
      'addLogoFromUrlAction',
      () => addLogoFromUrlAction(channelId, { url: 'https://example.com/a.png', title: 'Acme' }),
    ],
    ['renameLogoAction', () => renameLogoAction(channelId, { id: SOME_ID, title: 'Acme' })],
    ['removeLogoAction', () => removeLogoAction(channelId, SOME_ID)],
    ['setChannelMarkAction', () => setChannelMarkAction(channelId, null)],
    [
      'generateAuditions',
      () => generateAuditions(channelId, 'A sample.', [{ provider: 'elevenlabs', voiceId: 'v' }]),
    ],
    ['addPronunciation', () => addPronunciation(channelId, 'Wirecard', 'VEER-card')],
    ['checkPronunciation', () => checkPronunciation(channelId, 'Wirecard', 'VEER-card')],
  ]

  it.each(calls)('%s refuses and changes nothing', async (_name, call) => {
    expect(await call()).toEqual(ARCHIVED)
    expect(callLlm).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(synthesise).not.toHaveBeenCalled()
    expect((await listCases(db, channelId, { sort: 'priority' })).map((c) => c.title)).toEqual([
      'Wirecard',
    ])
  })
})
