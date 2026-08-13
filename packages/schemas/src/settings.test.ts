import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  LLM_TASKS,
  SettingsPatchSchema,
  SettingsSchema,
  effectiveCeilingUsd,
  firstRunBlockers,
  canonicalModelId,
  monthKey,
  resolveBrandKit,
} from './settings'

describe('SettingsSchema', () => {
  it('accepts the shipped defaults', () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('routes every task named in the spec', () => {
    for (const task of LLM_TASKS) {
      expect(DEFAULT_SETTINGS.modelRouting[task]).toBeDefined()
    }
  })

  it('ships one spending ceiling, not a matrix', () => {
    expect(DEFAULT_SETTINGS.budgets.monthlyCeilingUsd).toBeGreaterThan(0)
  })

  it('rejects an unknown LLM provider in the routing matrix', () => {
    const bad = {
      ...DEFAULT_SETTINGS,
      modelRouting: {
        ...DEFAULT_SETTINGS.modelRouting,
        research: { provider: 'elevenlabs', model: 'opus' },
      },
    }
    expect(SettingsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a malformed brand colour', () => {
    const bad = structuredClone(DEFAULT_SETTINGS)
    bad.brandKit.colors.accent = 'orange'
    expect(SettingsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a chart palette with fewer than three series', () => {
    const bad = structuredClone(DEFAULT_SETTINGS)
    bad.brandKit.colors.chartSeries = ['#ffffff', '#000000']
    expect(SettingsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a schedule slot that is not 24h UTC HH:MM', () => {
    const bad = structuredClone(DEFAULT_SETTINGS)
    bad.publish.defaultScheduleSlots = [{ kind: 'longform', weekday: 5, timeUtc: '3pm' }]
    expect(SettingsSchema.safeParse(bad).success).toBe(false)

    const alsoBad = structuredClone(DEFAULT_SETTINGS)
    alsoBad.publish.defaultScheduleSlots = [{ kind: 'longform', weekday: 5, timeUtc: '24:00' }]
    expect(SettingsSchema.safeParse(alsoBad).success).toBe(false)
  })

  it('rejects a render concurrency outside the broker cap', () => {
    const bad = structuredClone(DEFAULT_SETTINGS)
    bad.render.concurrency = 0
    expect(SettingsSchema.safeParse(bad).success).toBe(false)
  })

  it('defaults hero slots off — no video adapter exists at launch', () => {
    expect(DEFAULT_SETTINGS.features.heroSlots).toBe(false)
  })

  it('defaults apiAuditPassed false so publish shows the manual checklist', () => {
    expect(DEFAULT_SETTINGS.publish.apiAuditPassed).toBe(false)
  })
})

describe('SettingsPatchSchema', () => {
  it('accepts a partial nested patch', () => {
    const patch = SettingsPatchSchema.parse({ budgets: { monthlyCeilingUsd: 25 } })
    expect(patch.budgets?.monthlyCeilingUsd).toBe(25)
  })

  it('still validates the values inside a partial patch', () => {
    expect(SettingsPatchSchema.safeParse({ render: { concurrency: 99 } }).success).toBe(false)
  })
})

describe('resolveBrandKit', () => {
  it('projects the narration voice into the Brand Kit snapshot', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.tts = {
      provider: 'elevenlabs',
      voiceId: 'v-123',
      stylePrompt: 'measured',
      pacing: 0.95,
      phonemeHints: [{ term: 'Wirecard', hint: '/ˈvaɪɐkart/' }],
    }

    const kit = resolveBrandKit(settings)

    expect(kit.voice).toEqual(settings.tts)
    expect(kit.colors).toEqual(settings.brandKit.colors)
  })
})

describe('canonicalModelId', () => {
  it('brings the short names M1 and M2 stored up to the adapters wire ids', () => {
    expect(canonicalModelId('anthropic', 'opus')).toBe('claude-opus-5')
    expect(canonicalModelId('anthropic', 'sonnet')).toBe('claude-sonnet-5')
    expect(canonicalModelId('anthropic', 'haiku')).toBe('claude-haiku-4-5-20251001')
  })

  it('leaves a current id alone', () => {
    expect(canonicalModelId('anthropic', 'claude-opus-5')).toBe('claude-opus-5')
    // Was `gemini-3-pro` here, which encoded the same wrong assumption the
    // adapter did: a test asserting a made-up id is current cannot notice that
    // it never was.
    expect(canonicalModelId('google', 'gemini-3.6-flash')).toBe('gemini-3.6-flash')
  })

  it('carries the Gemini ids that were never real, or have been retired', () => {
    expect(canonicalModelId('google', 'gemini-3-pro')).toBe('gemini-pro-latest')
    expect(canonicalModelId('google', 'gemini-3-flash')).toBe('gemini-3.6-flash')
    // Listed by `GET /models`, then 404 on use: "no longer available to new users".
    expect(canonicalModelId('google', 'gemini-2.5-pro')).toBe('gemini-pro-latest')
    expect(canonicalModelId('google', 'gemini-2.5-flash')).toBe('gemini-3.6-flash')
  })

  it('leaves an unknown id alone rather than guessing', () => {
    // The router's pre-flight is what rejects it, with a message naming the
    // task and pointing at Settings. Silently substituting a model here would
    // spend money on something the human did not choose.
    expect(canonicalModelId('anthropic', 'some-future-model')).toBe('some-future-model')
  })

  it('still lets an unlisted model be stored', () => {
    expect(
      SettingsSchema.safeParse({
        ...DEFAULT_SETTINGS,
        modelRouting: {
          ...DEFAULT_SETTINGS.modelRouting,
          research: { provider: 'anthropic', model: 'some-future-model' },
        },
      }).success,
    ).toBe(true)
  })

  it('ships defaults that are current ids, not legacy ones', () => {
    for (const route of Object.values(DEFAULT_SETTINGS.modelRouting)) {
      expect(canonicalModelId(route.provider, route.model)).toBe(route.model)
    }
  })
})

describe('firstRunBlockers', () => {
  it('blocks a fresh install on voice and music beds', () => {
    expect(firstRunBlockers(DEFAULT_SETTINGS, 0)).toEqual(['narration-voice', 'music-beds'])
  })

  it('clears once the voice is chosen and three beds exist', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.tts.voiceId = 'Charon'
    expect(firstRunBlockers(settings, 3)).toEqual([])
  })
})

describe('effectiveCeilingUsd', () => {
  const march = new Date('2026-03-15T00:00:00.000Z')

  it('is the configured ceiling when no overage was approved', () => {
    expect(effectiveCeilingUsd({ monthlyCeilingUsd: 100 }, march)).toBe(100)
  })

  it('adds an overage approved for that same month', () => {
    expect(
      effectiveCeilingUsd(
        { monthlyCeilingUsd: 100, approvedOverage: { month: '2026-03', usd: 12 } },
        march,
      ),
    ).toBe(112)
  })

  it('expires the overage at the month boundary — March generosity is not April policy', () => {
    expect(
      effectiveCeilingUsd(
        { monthlyCeilingUsd: 100, approvedOverage: { month: '2026-03', usd: 12 } },
        new Date('2026-04-01T00:00:00.000Z'),
      ),
    ).toBe(100)
  })

  it('survives a settings row written before the ceiling existed', () => {
    // The production row carries the old shape: a per-provider matrix and a
    // kill switch. Zod strips what it does not know and catches the missing
    // ceiling at 100 — a parse failure here would take the whole app down.
    const parsed = SettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      budgets: { perProviderMonthlyUSD: { anthropic: 30 }, killSwitch: true },
    })
    expect(parsed.budgets.monthlyCeilingUsd).toBe(100)
    expect('killSwitch' in parsed.budgets).toBe(false)
  })
})

describe('monthKey', () => {
  it('is UTC and zero-padded', () => {
    expect(monthKey(new Date('2026-01-05T00:00:00.000Z'))).toBe('2026-01')
    expect(monthKey(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-12')
  })

  it('does not drift across a local-time boundary', () => {
    // 23:30 UTC on the last day of March is still March everywhere the
    // ledger cares about, whatever the server's local timezone says.
    expect(monthKey(new Date('2026-03-31T23:30:00.000Z'))).toBe('2026-03')
  })
})
