import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mergeSettings, normaliseSettings } from './settings-merge'

describe('mergeSettings', () => {
  it('leaves everything untouched for an empty patch', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS)
  })

  it('applies a single nested field without disturbing its siblings', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { budgets: { monthlyCeilingUsd: 42 } })

    expect(next.budgets.monthlyCeilingUsd).toBe(42)
    expect(next.modelRouting).toEqual(DEFAULT_SETTINGS.modelRouting)
  })

  it('keeps an approved overage a ceiling change did not mention', () => {
    // The overage is the one budget field the app writes for itself (at a
    // budget gate), so a settings save must not quietly erase it.
    const withOverage = mergeSettings(DEFAULT_SETTINGS, {
      budgets: { approvedOverage: { month: '2026-08', usd: 10 } },
    })
    const next = mergeSettings(withOverage, { budgets: { monthlyCeilingUsd: 42 } })

    expect(next.budgets.approvedOverage).toMatchObject({ month: '2026-08', usd: 10 })

    // And null clears it explicitly.
    const cleared = mergeSettings(next, { budgets: { approvedOverage: null } })
    expect(cleared.budgets.approvedOverage).toBeUndefined()
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
    mergeSettings(DEFAULT_SETTINGS, { budgets: { monthlyCeilingUsd: 1 } })
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

  it('gives a pre-decision-208 row the default stills route', () => {
    // The live settings row was written before `modelRouting.stills` existed.
    // It must come forward as routed-at-Gemini, not refuse to parse.
    const stored = structuredClone(DEFAULT_SETTINGS) as {
      modelRouting: Record<string, unknown>
    }
    delete stored.modelRouting['stills']

    expect(normaliseSettings(stored).modelRouting.stills).toEqual(
      DEFAULT_SETTINGS.modelRouting.stills,
    )
  })

  it('upgrades the short model names M1 and M2 wrote', () => {
    // The row in the live database still says `opus`. Left alone it parses
    // fine and then fails at the router's pre-flight, mid-run, as "anthropic
    // does not offer opus" — a long way from the cause.
    const stored = structuredClone(DEFAULT_SETTINGS)
    stored.modelRouting.research = { provider: 'anthropic', model: 'opus' }
    stored.modelRouting.scripting = { provider: 'anthropic', model: 'sonnet' }

    const normalised = normaliseSettings(stored)

    expect(normalised.modelRouting.research.model).toBe('claude-opus-5')
    expect(normalised.modelRouting.scripting.model).toBe('claude-sonnet-5')
  })

  it('upgrades model names even in a row that is otherwise incomplete', () => {
    const stored = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>
    delete stored['features']
    ;(stored['modelRouting'] as Record<string, unknown>)['research'] = {
      provider: 'anthropic',
      model: 'opus',
    }

    expect(normaliseSettings(stored).modelRouting.research.model).toBe('claude-opus-5')
  })

  it('leaves a model it does not recognise for pre-flight to reject', () => {
    const stored = structuredClone(DEFAULT_SETTINGS)
    stored.modelRouting.research = { provider: 'anthropic', model: 'claude-something-new' }

    expect(normaliseSettings(stored).modelRouting.research.model).toBe('claude-something-new')
  })

  it('still throws when a stored value is corrupt beyond repair', () => {
    const stored = structuredClone(DEFAULT_SETTINGS)
    stored.brandKit.colors.accent = 'not-a-colour'
    expect(() => normaliseSettings(stored)).toThrow()
  })
})
