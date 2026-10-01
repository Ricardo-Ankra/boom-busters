import { canonicalModelId, canonicalStillModelId } from '@boom-busters/schemas'
import type { ListOptions } from './http'
import { listAnthropicModels } from './list-anthropic'
import { listFalModels } from './list-fal'
import { listGoogleModels } from './list-google'
import { listOpenAiModels } from './list-openai'
import type { CatalogueProvider, ListedModel } from './types'

export type { ListOptions } from './http'

const LISTERS: Record<
  CatalogueProvider,
  (apiKey: string, options: ListOptions) => Promise<ListedModel[]>
> = {
  anthropic: listAnthropicModels,
  openai: listOpenAiModels,
  google: listGoogleModels,
  fal: listFalModels,
}

/**
 * What a provider serves now (decision 287), minus ids the legacy maps fold
 * forward: those are known to be dead or renamed (`gemini-2.5-pro` is listed
 * and then refused), and offering them would undo the fold.
 *
 * An empty result throws. A filter gone wrong must not wipe a dropdown; the
 * caller keeps the last good list.
 */
export async function listProviderModels(
  provider: CatalogueProvider,
  apiKey: string,
  options: ListOptions = {},
): Promise<ListedModel[]> {
  const listed = await LISTERS[provider](apiKey, options)
  const current = listed.filter((model) =>
    model.kind === 'image'
      ? canonicalStillModelId(model.id) === model.id
      : provider === 'fal' || canonicalModelId(provider, model.id) === model.id,
  )
  if (current.length === 0) throw new Error(`${provider} listed no models this app can use`)
  return current
}
