import { z } from 'zod'
import { falDialect } from './fal-dialect'
import { getJson, MAX_PAGES, type ListOptions } from './http'
import type { ListedModel } from './types'

const SearchSchema = z.object({
  models: z.array(
    z.object({
      endpoint_id: z.string(),
      metadata: z.object({ display_name: z.string().optional() }).partial().optional(),
      openapi: z.unknown().optional(),
    }),
  ),
  next_cursor: z.string().nullish(),
  has_more: z.boolean().optional(),
})

const PricingSchema = z.object({
  prices: z.array(
    z.object({
      endpoint_id: z.string(),
      unit_price: z.number(),
      unit: z.string(),
      currency: z.string(),
    }),
  ),
})

const PRICING_BATCH = 50

export async function listFalModels(apiKey: string, options: ListOptions): Promise<ListedModel[]> {
  const headers = { Authorization: `Key ${apiKey}` }
  const found: z.infer<typeof SearchSchema>['models'] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      'https://api.fal.ai/v1/models?category=text-to-image&status=active&expand=openapi-3.0' +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const parsed = SearchSchema.parse(await getJson('fal', url, headers, options))
    found.push(...parsed.models)
    if (!parsed.has_more || !parsed.next_cursor) break
    cursor = parsed.next_cursor
  }

  // A pricing failure fails the whole refresh: half a list, every model
  // "needs a price", is worse than yesterday's list.
  const prices = new Map<string, number>()
  for (let start = 0; start < found.length; start += PRICING_BATCH) {
    const ids = found.slice(start, start + PRICING_BATCH).map((model) => model.endpoint_id)
    const url = `https://api.fal.ai/v1/models/pricing?endpoint_id=${ids.map(encodeURIComponent).join(',')}`
    const parsed = PricingSchema.parse(await getJson('fal', url, headers, options))
    for (const price of parsed.prices) {
      // Only a USD price per image is a price per image; FLUX.2 bills per
      // megapixel, and guessing the conversion would misprice every still.
      if (price.unit === 'image' && price.currency === 'USD')
        prices.set(price.endpoint_id, price.unit_price)
    }
  }

  return found.map((model) => ({
    provider: 'fal',
    id: model.endpoint_id,
    label: model.metadata?.display_name ?? model.endpoint_id,
    kind: 'image',
    preview: false,
    contextTokens: null,
    maxOutputTokens: null,
    dialect: falDialect(model.openapi),
    pricePerImage: prices.get(model.endpoint_id) ?? null,
  }))
}
