import 'server-only'

import {
  listCatalogueModels,
  listCatalogueRefresh,
  llmCredentials,
  recordCatalogueFailure,
  replaceCatalogue,
  visualCredentials,
} from '@boom-busters/db'
import type { CatalogueModelRow } from '@boom-busters/db'
import {
  CATALOGUE_PROVIDERS,
  buildModelOptions,
  effectiveImageModels,
  imageGenAdapterWith,
  listProviderModels,
  liveImageGenWith,
  mockListedModels,
  mockProvidersEnabled,
  resolveImageModel,
} from '@boom-busters/providers'
import type {
  CatalogueProvider,
  FalDialect,
  ImageGenModel,
  ImageGenProvider,
  ListedModel,
  ModelOptions,
} from '@boom-busters/providers'
import { STILL_PROVIDERS } from '@boom-busters/schemas'
import type { Settings, StillProvider } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * The live model lists, server side (decision 288): refreshing the cache,
 * the Models tab's options, and image adapters that know the live models.
 */

const REFRESH_TIMEOUT_MS = 10_000

export interface RefreshOutcome {
  provider: CatalogueProvider
  ok: boolean
  /** No key, so nothing was asked and nothing changed. */
  skipped: boolean
  error: string | null
}

function toListed(row: CatalogueModelRow): ListedModel {
  return {
    provider: row.provider as CatalogueProvider,
    id: row.modelId,
    label: row.label,
    kind: row.kind,
    preview: row.preview,
    contextTokens: row.contextTokens,
    maxOutputTokens: row.maxOutputTokens,
    dialect: (row.dialect as FalDialect | null) ?? null,
    pricePerImage: row.pricePerImage,
  }
}

async function providerKeys(): Promise<Partial<Record<CatalogueProvider, string>>> {
  const [llm, visual] = await Promise.all([
    llmCredentials(db, env.SECRETS_ENCRYPTION_KEY),
    visualCredentials(db, env.SECRETS_ENCRYPTION_KEY),
  ])
  return {
    ...(llm.anthropic ? { anthropic: llm.anthropic } : {}),
    ...(llm.openai ? { openai: llm.openai } : {}),
    ...((llm.google ?? visual.google) ? { google: llm.google ?? visual.google } : {}),
    ...(visual.fal ? { fal: visual.fal } : {}),
  }
}

/** Ask every provider with a key, in parallel; a failure is recorded, never thrown. */
export async function refreshModelCatalogue(): Promise<RefreshOutcome[]> {
  const mocked = mockProvidersEnabled()
  const keys = mocked ? {} : await providerKeys()

  return Promise.all(
    CATALOGUE_PROVIDERS.map(async (provider): Promise<RefreshOutcome> => {
      const key = keys[provider]
      if (!mocked && !key) return { provider, ok: false, skipped: true, error: null }
      const at = new Date()
      try {
        const listed = mocked
          ? mockListedModels(provider)
          : await listProviderModels(provider, key!, {
              signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
            })
        await replaceCatalogue(
          db,
          provider,
          listed.map((model) => ({
            modelId: model.id,
            kind: model.kind,
            label: model.label,
            preview: model.preview,
            contextTokens: model.contextTokens,
            maxOutputTokens: model.maxOutputTokens,
            dialect: model.dialect,
            pricePerImage: model.pricePerImage,
          })),
          at,
        )
        return { provider, ok: true, skipped: false, error: null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Recording the failure must not itself fail the refresh: a DB write
        // that throws here must not take down the other providers' results.
        try {
          await recordCatalogueFailure(db, provider, message, at)
        } catch {
          // Deliberately swallowed — see above.
        }
        return { provider, ok: false, skipped: false, error: message }
      }
    }),
  )
}

export async function loadModelOptions(settings: Settings): Promise<ModelOptions> {
  const mocked = mockProvidersEnabled()
  const [rows, refresh, keys] = await Promise.all([
    listCatalogueModels(db),
    listCatalogueRefresh(db),
    mocked ? Promise.resolve({}) : providerKeys(),
  ])
  return buildModelOptions({
    listed: rows.map(toListed),
    refresh: refresh.map((row) => ({
      provider: row.provider as CatalogueProvider,
      lastAttemptAt: row.lastAttemptAt.toISOString(),
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      lastError: row.lastError,
    })),
    keys: Object.fromEntries(
      CATALOGUE_PROVIDERS.map((p) => [p, Boolean((keys as Record<string, string>)[p])]),
    ) as Record<CatalogueProvider, boolean>,
    prices: settings.modelPrices,
    mock: mocked,
  })
}

/**
 * The effective list plus every image route Settings names on this
 * provider that settings alone can price (its family, or the owner's
 * price). A live-only model a later refresh stops returning leaves the
 * cache, and without this it would leave the adapter too, so every price
 * read on the project page would throw on it. Spec section 9: a saved model
 * the provider stops listing is labelled, not removed, and a run still
 * tries it. A fal id cannot resolve without its cached dialect, so fal
 * gains nothing here.
 */
function withRoutedModels(
  provider: StillProvider,
  models: ImageGenModel[],
  settings: Settings,
): ImageGenModel[] {
  const routing = settings.modelRouting
  for (const route of [routing.stills, routing.stillsLikeness, routing.setSheet]) {
    if (!route || route.provider !== provider) continue
    if (models.some((model) => model.id === route.model)) continue
    const resolved = resolveImageModel(provider, route.model, settings.modelPrices)?.model
    if (resolved && !models.some((model) => model.id === resolved.id)) models.push(resolved)
  }
  return models
}

/**
 * Live image adapters over each provider's effective list (catalogue
 * repriced by the owner, plus choosable cached models, plus the routed
 * models settings can price). Prices, limits, labels and reference routes
 * read from these, so a still routed at a live model is priced and checked
 * like any other.
 */
export async function stillCatalogue(
  settings: Settings,
): Promise<Record<StillProvider, ImageGenProvider>> {
  const listed = (await listCatalogueModels(db)).map(toListed)
  return Object.fromEntries(
    STILL_PROVIDERS.map((provider) => [
      provider,
      liveImageGenWith(
        provider,
        withRoutedModels(
          provider,
          effectiveImageModels(provider, settings.modelPrices, listed),
          settings,
        ),
      ),
    ]),
  ) as Record<StillProvider, ImageGenProvider>
}

/** The adapter that will actually generate: the mock in mock mode, else live, over the same list. */
export async function stillGenerator(
  provider: StillProvider,
  settings: Settings,
): Promise<ImageGenProvider> {
  const catalogue = await stillCatalogue(settings)
  return imageGenAdapterWith(provider, catalogue[provider].models)
}

export interface StillModelOption {
  provider: StillProvider
  id: string
  label: string
}

/** The board's per-slot Image model choices (decision 264), from the same lists. */
export function stillModelOptions(
  catalogue: Record<StillProvider, ImageGenProvider>,
): StillModelOption[] {
  return STILL_PROVIDERS.flatMap((provider) =>
    catalogue[provider].models.map((model) => ({ provider, id: model.id, label: model.label })),
  )
}
