// @vitest-environment node

import {
  createCase,
  createChannel,
  createProjectFromCase,
  requireTestDatabase,
  seed,
  setCredential,
  truncateRunMirror,
  updateChannelSettings,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { forgetRunRows } from '../middleware/run-mirror'
import { voiceRunner } from './voice-runner'

/**
 * The voice runner's pre-flight reads the narrator from the settings of the
 * channel the project belongs to, not from the first channel's: the voice
 * check is the first thing `load-script` does, so which channel it reads
 * decides whether the run goes on or stops with the voice refusal.
 */

vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
  takeStorage: () => 'regenerated' as const,
}))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

async function projectOnNewChannel(voiceId: string) {
  const channel = await createChannel(db, {
    name: 'Voice channel B',
    handle: null,
    slug: `voice-${Math.random().toString(36).slice(2, 8)}`,
    settings: {
      ...DEFAULT_SETTINGS,
      tts: { ...DEFAULT_SETTINGS.tts, provider: 'elevenlabs', voiceId },
    },
    bible: EMPTY_BIBLE,
  })
  const kase = await createCase(db, { channelId: channel.id, title: 'B', category: 'con' })
  return createProjectFromCase(db, { caseId: kase.id, title: 'On B' })
}

async function runFor(projectId: string): Promise<string> {
  const engine = new InngestTestEngine({ function: voiceRunner })
  const { error } = await engine.execute({
    events: [{ name: 'gate/script.approved', data: { projectId } }],
  })
  return String((error as { message?: string } | undefined)?.message ?? '')
}

describeDb('voice-runner load-script', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await setCredential(db, 'elevenlabs', 'xi-test-key-0000', env.SECRETS_ENCRYPTION_KEY)
  })

  it("stops on the project channel's missing voice, though the first channel has one", async () => {
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      tts: { provider: 'elevenlabs', voiceId: 'voice-a' },
    })
    const project = await projectOnNewChannel('')

    expect(await runFor(project.id)).toContain('No narration voice has been chosen')
  })

  it("goes past the voice check on the project channel's voice, though the first channel has none", async () => {
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      tts: { provider: 'elevenlabs', voiceId: '' },
    })
    const project = await projectOnNewChannel('voice-b')

    const message = await runFor(project.id)
    expect(message).not.toContain('No narration voice')
    expect(message).toContain('no script')
  })
})
