import {
  DEFAULT_SETTINGS,
  LLM_TASKS,
  SettingsSchema,
  canonicalModelId,
} from '@boom-busters/schemas'
import type { ModelRouting, Settings, SettingsPatch } from '@boom-busters/schemas'

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
 * Rewrite the short model names M1 and M2 stored (`opus`, `sonnet`, `haiku`)
 * into the wire ids the M3 adapters answer to.
 *
 * `SettingsSchema` accepts any non-empty string as a model, so a stale name
 * parses cleanly and only fails later, at the router's pre-flight, as "the
 * provider does not offer this model" — halfway into a run and nowhere near
 * the cause. Fixing it on read means the upgrade happens once, silently, at
 * the boundary where the old value enters the app.
 */
function canonicaliseRouting(routing: ModelRouting): ModelRouting {
  const migrated = { ...routing }
  for (const task of LLM_TASKS) {
    const route = migrated[task]
    migrated[task] = { ...route, model: canonicalModelId(route.provider, route.model) }
  }
  return migrated
}

/**
 * Bring a stored row forward to the current schema. A settings row written by
 * an older deploy may be missing a section added since; filling from defaults
 * beats refusing to boot.
 */
export function normaliseSettings(stored: unknown): Settings {
  const parsed = SettingsSchema.safeParse(stored)
  if (parsed.success) {
    return { ...parsed.data, modelRouting: canonicaliseRouting(parsed.data.modelRouting) }
  }

  const partial = (stored ?? {}) as Partial<Settings>
  const merged = SettingsSchema.parse({
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

  return { ...merged, modelRouting: canonicaliseRouting(merged.modelRouting) }
}
