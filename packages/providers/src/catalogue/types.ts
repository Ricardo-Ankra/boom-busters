import type { FalDialect } from '../visuals/types'

/**
 * What a provider's own list endpoint says it serves (decision 287).
 *
 * Google is one provider here although it has two kinds of model, because
 * one key and one `GET /v1beta/models` serve both its LLMs and its image
 * models.
 */
export const CATALOGUE_PROVIDERS = ['anthropic', 'openai', 'google', 'fal'] as const
export type CatalogueProvider = (typeof CATALOGUE_PROVIDERS)[number]

export type ModelKind = 'llm' | 'image'

export interface ListedModel {
  provider: CatalogueProvider
  id: string
  label: string
  kind: ModelKind
  /** Google `-preview` and `-exp` ids: listed, grouped and warned about. */
  preview: boolean
  contextTokens: number | null
  maxOutputTokens: number | null
  /** fal only; null on fal means the endpoint fits no dialect this app can send. */
  dialect: FalDialect | null
  /** fal only: the provider's own USD price per image, when it publishes one. */
  pricePerImage: number | null
}

/** Where a resolved price came from, in the order they are tried. */
export type PriceSource = 'override' | 'catalogue' | 'provider' | 'family'
