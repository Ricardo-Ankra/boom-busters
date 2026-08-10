import { DEFAULT_SETTINGS, SettingsSchema } from '@boom-busters/schemas'
import type { Settings, SettingsPatch } from '@boom-busters/schemas'

/**
 * Apply a patch to the settings row.
 *
 * The merge is two levels deep and no deeper, which matches the shape of
 * `SettingsPatchSchema`: each top-level section is optional, and any section
 * present in the patch supplies complete sub-objects. Going deeper would let
 * a half-written Brand Kit colour set through; stopping here means every
 * merge result is a complete, valid `Settings`.
 *
 * The result is re-validated before it is returned, so a patch can never
 * write a settings row that `SettingsSchema` would reject.
 */
export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const merged: Settings = {
    ...current,
    // Arrays are replaced wholesale, not concatenated.
    fallbackChain: patch.fallbackChain ?? current.fallbackChain,
    modelRouting: { ...current.modelRouting, ...patch.modelRouting },
    tts: { ...current.tts, ...patch.tts },
    budgets: {
      ...current.budgets,
      ...patch.budgets,
      perProviderMonthlyUSD: {
        ...current.budgets.perProviderMonthlyUSD,
        ...patch.budgets?.perProviderMonthlyUSD,
      },
      approvedOverages: {
        ...current.budgets.approvedOverages,
        ...patch.budgets?.approvedOverages,
      },
    },
    render: { ...current.render, ...patch.render },
    publish: { ...current.publish, ...patch.publish },
    brandKit: { ...current.brandKit, ...patch.brandKit },
    features: { ...current.features, ...patch.features },
  }

  return SettingsSchema.parse(merged)
}

/**
 * Bring a stored row forward to the current schema. A settings row written by
 * an older deploy may be missing a section added since; filling from defaults
 * beats refusing to boot.
 */
export function normaliseSettings(stored: unknown): Settings {
  const parsed = SettingsSchema.safeParse(stored)
  if (parsed.success) return parsed.data

  const partial = (stored ?? {}) as Partial<Settings>
  return SettingsSchema.parse({
    ...DEFAULT_SETTINGS,
    ...partial,
    modelRouting: { ...DEFAULT_SETTINGS.modelRouting, ...partial.modelRouting },
    tts: { ...DEFAULT_SETTINGS.tts, ...partial.tts },
    budgets: {
      ...DEFAULT_SETTINGS.budgets,
      ...partial.budgets,
      perProviderMonthlyUSD: {
        ...DEFAULT_SETTINGS.budgets.perProviderMonthlyUSD,
        ...partial.budgets?.perProviderMonthlyUSD,
      },
      approvedOverages: {
        ...DEFAULT_SETTINGS.budgets.approvedOverages,
        ...partial.budgets?.approvedOverages,
      },
    },
    render: { ...DEFAULT_SETTINGS.render, ...partial.render },
    publish: { ...DEFAULT_SETTINGS.publish, ...partial.publish },
    brandKit: { ...DEFAULT_SETTINGS.brandKit, ...partial.brandKit },
    features: { ...DEFAULT_SETTINGS.features, ...partial.features },
  })
}
