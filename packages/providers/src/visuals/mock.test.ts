import { SlotCandidateSchema } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { createMockStock, mockImageGen } from './mock'
import { imageGenAdapter, stockAdapters, LIVE_STOCK_ADAPTERS } from './registry'
import { falImageGen } from './fal'
import { geminiImageGen } from './gemini'
import type { StockQuery } from './types'

const QUERY: StockQuery = {
  query: 'empty office dusk',
  brief: 'Deserted open-plan office.',
  rejectionCriteria: [],
  count: 4,
}

describe('createMockStock', () => {
  it('returns valid, deterministic, visibly fake candidates', async () => {
    const mock = createMockStock('pexels')
    const first = await mock.search(QUERY, {})
    const second = await mock.search(QUERY, {})

    expect(first).toHaveLength(4)
    expect(first).toEqual(second)
    for (const candidate of first) {
      expect(() => SlotCandidateSchema.parse(candidate)).not.toThrow()
      expect(candidate.licence).toContain('[mock]')
    }
  })

  it('renders thumbnails as self-contained data URLs', async () => {
    const [candidate] = await createMockStock('pixabay').search(QUERY, {})
    expect(candidate?.thumbUrl).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('emits only images for wikimedia — Commons has no stock video', async () => {
    const candidates = await createMockStock('wikimedia').search(QUERY, {})
    expect(candidates.every((candidate) => candidate.kind === 'image')).toBe(true)
  })
})

describe('mockImageGen', () => {
  it('prices at the LIVE fal price, so budget maths stay honest in mock mode', async () => {
    const result = await mockImageGen.generate({ prompt: 'trading floor', count: 2 }, {})
    expect(result.estimatedCostUsd).toBeCloseTo(falImageGen.models[0]!.pricePerImage * 2)
    expect(result.images.every((image) => image.url.startsWith('data:image/svg+xml'))).toBe(true)
  })
})

describe('the registry switch', () => {
  it('serves mocks only when MOCK_PROVIDERS=1, never by default', async () => {
    expect(stockAdapters({})).toBe(LIVE_STOCK_ADAPTERS)
    expect(imageGenAdapter('fal', {})).toBe(falImageGen)

    const mocked = stockAdapters({ MOCK_PROVIDERS: '1' })
    const [candidate] = await mocked.pexels.search(QUERY, {})
    expect(candidate?.licence).toContain('[mock]')
    expect(imageGenAdapter('fal', { MOCK_PROVIDERS: '1' })).toBe(mockImageGen)
    expect(imageGenAdapter('google', { MOCK_PROVIDERS: '1' })).toBe(mockImageGen)
  })

  it('serves Gemini when asked for the google generator', () => {
    expect(imageGenAdapter('google', {})).toBe(geminiImageGen)
  })
})
