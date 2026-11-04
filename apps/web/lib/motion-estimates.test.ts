import { DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { identityDraftEstimateUsd, readingEstimateUsd } from './motion-estimates'

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
})
