import { DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  derivationEstimateTable,
  derivationEstimateUsd,
  identityDraftEstimateUsd,
  readingEstimateUsd,
} from './motion-estimates'

describe('motion estimates (spec 2026-11-04, sections 7.2 and 8.4)', () => {
  it('prices a reading and a draft on the graphics route', () => {
    expect(readingEstimateUsd(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS)).toBeGreaterThan(0)
    expect(
      identityDraftEstimateUsd(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS, 8),
    ).toBeGreaterThan(identityDraftEstimateUsd(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS, 0))
  })

  it('follows the graphics route, not another task', () => {
    const cheaper = {
      ...DEFAULT_SETTINGS,
      modelRouting: {
        ...DEFAULT_SETTINGS.modelRouting,
        graphics: { provider: 'anthropic' as const, model: 'claude-haiku-4-5-20251001' },
      },
    }
    expect(readingEstimateUsd(cheaper, DEFAULT_WORKSPACE_SETTINGS)).toBeLessThan(
      readingEstimateUsd(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS),
    )
  })

  it("a derivation's estimate grows with techniques and rounds on the two routes", () => {
    const table = derivationEstimateTable(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS)
    expect(table.perTechniqueFixed).toBeGreaterThan(0)
    expect(table.perRound).toBeGreaterThan(0)
    expect(table.perPairwise).toBeGreaterThan(0)
    const one = derivationEstimateUsd(table, { techniques: 1, rounds: 1 })
    const two = derivationEstimateUsd(table, { techniques: 2, rounds: 1 })
    const deeper = derivationEstimateUsd(table, { techniques: 1, rounds: 3 })
    expect(two).toBeCloseTo(one * 2, 6)
    expect(deeper).toBeCloseTo(
      table.perTechniqueFixed + 3 * table.perRound + 2 * table.perPairwise,
      6,
    )
    // The critic's route prices the rounds: a cheaper critic lowers a round, not the fixed part.
    const cheaperCritic = {
      ...DEFAULT_SETTINGS,
      modelRouting: {
        ...DEFAULT_SETTINGS.modelRouting,
        critic: { provider: 'anthropic' as const, model: 'claude-haiku-4-5-20251001' },
      },
    }
    const cheaper = derivationEstimateTable(cheaperCritic, DEFAULT_WORKSPACE_SETTINGS)
    expect(cheaper.perRound).toBeLessThan(table.perRound)
    expect(cheaper.perTechniqueFixed).toBe(table.perTechniqueFixed)
  })

  it('one round asks no pairwise', () => {
    const table = derivationEstimateTable(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS)
    expect(derivationEstimateUsd(table, { techniques: 1, rounds: 1 })).toBeCloseTo(
      table.perTechniqueFixed + table.perRound,
      6,
    )
  })
})
