// @vitest-environment node

import { outputBudget } from '@boom-busters/providers'
import type { SetPlate } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftSetLayout } from './set-layout'
import { layoutDraftRequest } from './set-layout-prompt'

/**
 * The inventory draft's own handling of the reply (decision 275). The LLM
 * router and storage are replaced, so nothing here calls a provider; mock
 * mode is switched off only so the reply path runs at all.
 */

const llm = vi.hoisted(() => ({ callLlm: vi.fn() }))
vi.mock('@/lib/llm', () => llm)
vi.mock('@/lib/storage', () => ({
  getObjectBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }),
}))

const plate: SetPlate = {
  r2Key: 'boom-busters/sets/p/aaa.png',
  contentHash: 'aaa',
  mimeType: 'image/png',
  width: 10,
  height: 10,
  view: 'north',
  origin: 'uploaded',
}

const SIX_LINES = [
  'North wall: three tall windows.',
  'East wall: walnut credenza.',
  'South wall: glass wall.',
  'West wall: bare concrete.',
  'Centre: a long table.',
  'Light: overcast daylight.',
].join('\n')

function reply(text: string, truncated: boolean) {
  return {
    text,
    truncated,
    model: 'gemini-3.5-flash-lite',
    usage: { inputTokens: 10, outputTokens: 10 },
  }
}

describe('draftSetLayout', () => {
  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '0')
    llm.callLlm.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks for the answer plus the house thinking headroom', () => {
    const request = layoutDraftRequest({
      name: 'R',
      look: 'L',
      image: { mimeType: 'image/png', data: 'QUJD' },
    })
    expect(request.maxTokens).toBe(outputBudget(600))
  })

  it('returns the drafted inventory', async () => {
    llm.callLlm.mockResolvedValue(reply(SIX_LINES, false))
    expect(await draftSetLayout({ projectId: 'p', name: 'R', look: 'L', plate })).toBe(SIX_LINES)
  })

  it('treats a reply cut off at its budget as a failed draft', async () => {
    llm.callLlm.mockResolvedValue(reply('North wall: three tall windows.\nEast wall: wal', true))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await draftSetLayout({ projectId: 'p', name: 'R', look: 'L', plate })).toBeNull()
    } finally {
      logged.mockRestore()
    }
  })
})
