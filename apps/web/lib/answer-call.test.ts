import { describe, expect, it, vi } from 'vitest'
import type { LLMTaskRequest } from '@boom-busters/providers'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

import { completeForProject } from './answer-call'

const PROJECT = '01J0000000000000000000000P'

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
    expect(callLlm.mock.calls[0]![1]).toEqual({ projectId: PROJECT, estimateOutputTokens: 800 })
    expect(callLlm.mock.calls[1]![1]).toEqual({ projectId: PROJECT, purpose: 'retry: cut off' })
  })

  it('leaves the estimate to the budget when the task gives none', async () => {
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: 'A passage.' })
    await completeForProject(PROJECT)(request, 'answer')
    expect(callLlm).toHaveBeenCalledWith(request, { projectId: PROJECT })
  })
})
