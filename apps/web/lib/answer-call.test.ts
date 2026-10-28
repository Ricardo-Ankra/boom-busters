import { describe, expect, it, vi } from 'vitest'
import type { LLMTaskRequest } from '@boom-busters/providers'
import type * as Db from '@boom-busters/db'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

// The wrappers resolve the project's channel before they call the model; this
// file has no database, so the lookup answers with a fixed channel.
vi.mock('@boom-busters/db', async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  channelForProject: async () => ({
    channelId: '01J00000000000000000000CH1',
    slug: 'first',
    settings: {},
    bible: {},
  }),
}))

import { completeForProject } from './answer-call'

const PROJECT = '01J0000000000000000000000P'
const CHANNEL = '01J00000000000000000000CH1'

const request: LLMTaskRequest = {
  task: 'scripting',
  system: 'system',
  messages: [{ role: 'user', content: 'Write chapter two.' }],
  maxTokens: 1000,
}

describe('completeForProject (decisions 292, 293)', () => {
  it('estimates the first call as the task says, and a labelled retry at its full budget', async () => {
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: 'A chapter.' })
    const complete = completeForProject(PROJECT, { estimateOutputTokens: 800 })
    await complete(request, 'answer')
    await complete({ ...request, maxTokens: 2000 }, 'retry: cut off')
    expect(callLlm.mock.calls[0]![1]).toEqual({
      projectId: PROJECT,
      channelId: CHANNEL,
      estimateOutputTokens: 800,
    })
    expect(callLlm.mock.calls[1]![1]).toEqual({
      projectId: PROJECT,
      channelId: CHANNEL,
      purpose: 'retry: cut off',
    })
  })

  it('leaves the estimate to the budget when the task gives none', async () => {
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: 'A passage.' })
    await completeForProject(PROJECT)(request, 'answer')
    expect(callLlm).toHaveBeenCalledWith(request, { projectId: PROJECT, channelId: CHANNEL })
  })
})
