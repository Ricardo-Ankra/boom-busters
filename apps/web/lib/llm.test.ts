// @vitest-environment node

import { listLedger } from '@boom-busters/cost'
import {
  createChannel,
  requireTestDatabase,
  seed,
  setCredential,
  updateChannelSettings,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_ID, newId } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { callLlm } from './llm'

/**
 * `callLlm` routes by the channel it is told about: the same task goes to a
 * different model on each channel, and the ledger row carries that channel.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

const request = {
  task: 'scripting' as const,
  system: 'Write.',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  maxTokens: 50,
}

describeDb('callLlm routes by channel', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await setCredential(db, 'anthropic', 'sk-ant-api03-test-key-0000', env.SECRETS_ENCRYPTION_KEY)
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      budgets: { monthlyCeilingUsd: 100 },
      modelRouting: { scripting: { provider: 'anthropic', model: 'claude-sonnet-5' } },
    })
  })

  it('follows channel B scripting route, not the first channel', async () => {
    const slug = `llm-${newId().slice(-8).toLowerCase()}`
    const b = await createChannel(db, {
      name: 'Channel B',
      handle: null,
      slug,
      settings: {
        ...DEFAULT_SETTINGS,
        modelRouting: {
          ...DEFAULT_SETTINGS.modelRouting,
          scripting: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
        },
      },
      bible: EMPTY_BIBLE,
    })

    await callLlm(request, { channelId: FIRST_CHANNEL_ID })
    await callLlm(request, { channelId: b.id })

    const [forB] = await listLedger(db, { channelId: b.id, limit: 1 })
    const [forA] = await listLedger(db, { channelId: FIRST_CHANNEL_ID, limit: 1 })
    expect(forB?.meta['model']).toBe('claude-haiku-4-5-20251001')
    expect(forA?.meta['model']).toBe('claude-sonnet-5')
  })
})
