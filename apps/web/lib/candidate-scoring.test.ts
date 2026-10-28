// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SlotCandidate, StockBrief } from '@boom-busters/schemas'
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

import { scoreSlotCandidates } from './visual-assets'

const brief: StockBrief = {
  type: 'stock',
  coversText: 'The money was gone.',
  description: 'An empty office.',
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'empty office',
  rejectionCriteria: [],
}
const candidate = (id: string): SlotCandidate => ({
  id,
  provider: 'pexels',
  kind: 'image',
  sourceUrl: `https://images.example/${id}.jpg`,
  licence: 'Pexels licence',
})

afterEach(() => {
  vi.unstubAllEnvs()
  callLlm.mockReset()
})

describe('scoreSlotCandidates (decision 292)', () => {
  it('asks once more with the reason, then keeps the candidates unranked in the provider order', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockResolvedValue({ text: 'no json here' })

    const ranked = await scoreSlotCandidates(
      brief,
      [candidate('a'), candidate('b'), candidate('c')],
      '01J0000000000000000000000P',
    )

    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    expect(ranked.map((one) => one.id)).toEqual(['a', 'b', 'c'])
    expect(ranked.every((one) => one.score === undefined)).toBe(true)
  })
})
