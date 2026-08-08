import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mergeSettings, normaliseSettings } from './settings-merge'

describe('mergeSettings', () => {
  it('leaves everything untouched for an empty patch', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS)
  })

  it('applies a single nested field without disturbing its siblings', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { budgets: { killSwitch: true } })

    expect(next.budgets.killSwitch).toBe(true)
    expect(next.budgets.perProviderMonthlyUSD).toEqual(
      DEFAULT_SETTINGS.budgets.perProviderMonthlyUSD,
    )
    expect(next.modelRouting).toEqual(DEFAULT_SETTINGS.modelRouting)
  })

  it('merges per-provider budgets rather than replacing the map', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, {
      budgets: { perProviderMonthlyUSD: { elevenlabs: 22 } },
    })

    expect(next.budgets.perProviderMonthlyUSD.elevenlabs).toBe(22)
    expect(next.budgets.perProviderMonthlyUSD.anthropic).toBe(
      DEFAULT_SETTINGS.budgets.perProviderMonthlyUSD.anthropic,
    )
  })

  it('reroutes one task and leaves the other five alone', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, {
      modelRouting: { scripting: { provider: 'google', model: 'gemini-3-pro' } },
    })

    expect(next.modelRouting.scripting).toEqual({ provider: 'google', model: 'gemini-3-pro' })
    expect(next.modelRouting.research).toEqual(DEFAULT_SETTINGS.modelRouting.research)
  })

  it('replaces arrays wholesale instead of concatenating', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { fallbackChain: ['google'] })
    expect(next.fallbackChain).toEqual(['google'])

    const cleared = mergeSettings(next, { fallbackChain: [] })
    expect(cleared.fallbackChain).toEqual([])
  })

  it('rejects a patch that would produce an invalid settings row', () => {
    expect(() => mergeSettings(DEFAULT_SETTINGS, { render: { timeoutMinutes: 999 } })).toThrow()
  })

  it('does not mutate the input', () => {
    const before = structuredClone(DEFAULT_SETTINGS)
    mergeSettings(DEFAULT_SETTINGS, { budgets: { killSwitch: true } })
    expect(DEFAULT_SETTINGS).toEqual(before)
  })
})

describe('normaliseSettings', () => {
  it('passes a complete row through unchanged', () => {
    expect(normaliseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('fills a section added since the row was written', () => {
    const stored = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>
    delete stored['features']

    const normalised = normaliseSettings(stored)

    expect(normalised.features).toEqual(DEFAULT_SETTINGS.features)
    expect(normalised.modelRouting).toEqual(DEFAULT_SETTINGS.modelRouting)
  })

  it('fills a field added inside an existing section', () => {
    const stored = structuredClone(DEFAULT_SETTINGS) as {
      publish: Record<string, unknown>
    }
    delete stored.publish['dailyUploadBudget']

    expect(normaliseSettings(stored).publish.dailyUploadBudget).toBe(
      DEFAULT_SETTINGS.publish.dailyUploadBudget,
    )
  })

  it('recovers a completely empty row', () => {
    expect(normaliseSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normaliseSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('still throws when a stored value is corrupt beyond repair', () => {
    const stored = structuredClone(DEFAULT_SETTINGS)
    stored.brandKit.colors.accent = 'not-a-colour'
    expect(() => normaliseSettings(stored)).toThrow()
  })
})
