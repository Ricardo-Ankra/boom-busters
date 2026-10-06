import { RateLimitError } from '@boom-busters/schemas'
import { z } from 'zod'
import { mapNetworkError, throwForResponse } from '../llm/http'
import { falDialect } from './fal-dialect'
import { getJson, MAX_PAGES, unreadableList, type ListOptions } from './http'
import type { ListedModel } from './types'

/**
 * What fal serves for text-to-image (decision 288), shaped by what fal does,
 * measured against the live API on 2026-10-06:
 *
 * - The search returns 100 endpoints a page, but only ten once their OpenAPI
 *   schemas are expanded: 203 endpoints took 21 pages and 23 s, so the first
 *   version of this never finished inside its budget in production. The
 *   search now walks plain pages (three), and schemas are asked for by name,
 *   ten endpoints a request, a few requests in flight.
 * - Prices come per endpoint in fal's own units. Only "images" in USD is a
 *   price per image; megapixels, compute seconds, units and credits leave the
 *   endpoint for the owner to price by hand.
 * - A request naming any endpoint fal cannot find (a schema it has lost,
 *   a price it never had) is answered 404 as a whole, so such a request is
 *   halved until that endpoint stands alone, and the endpoint is listed
 *   without a dialect or a price rather than failing the refresh.
 * - More than a few requests at once draw a 429, which is waited out.
 */

const SEARCH = 'https://api.fal.ai/v1/models'
const PRICING = 'https://api.fal.ai/v1/models/pricing'
/** fal's page size once schemas are expanded. */
const SCHEMA_GROUP = 10
/** Requests in flight for schemas; five drew 429s in testing. */
const SCHEMA_IN_FLIGHT = 3
const PRICING_BATCH = 50
/** fal's names for a price per generated image. */
const PER_IMAGE_UNITS = new Set(['image', 'images'])
const RETRIES_ON_429 = 3

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A request repeated past a 429, up to a few times, honouring Retry-After. */
async function patiently<T>(options: ListOptions, request: () => Promise<T>): Promise<T> {
  const wait = options.sleepImpl ?? sleep
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request()
    } catch (error) {
      if (!(error instanceof RateLimitError) || attempt >= RETRIES_ON_429) throw error
      await wait(error.retryAfterMs ?? 1000 * 2 ** attempt)
    }
  }
}

const named = (ids: readonly string[]) =>
  ids.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join('&')

/**
 * One fal request. Null when fal answers 404 "Endpoint(s) not found", which
 * it does for a whole request naming any one endpoint it cannot find.
 */
async function falGet(
  url: string,
  headers: Record<string, string>,
  options: ListOptions,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    throw mapNetworkError('fal', cause)
  }
  if (response.status === 404) return null
  if (!response.ok) await throwForResponse('fal', response)
  try {
    return (await response.json()) as unknown
  } catch (cause) {
    throw unreadableList('fal', cause)
  }
}

/**
 * Ask about a group of named endpoints. When fal answers 404 because one of
 * them is unknown to it, halve the group until that endpoint stands alone,
 * and skip it: one stale endpoint must not fail the refresh.
 */
async function byHalves<T>(
  group: readonly string[],
  ask: (ids: readonly string[]) => Promise<T | null>,
  use: (page: T) => void,
): Promise<void> {
  const page = await ask(group)
  if (page !== null) {
    use(page)
    return
  }
  if (group.length === 1) return
  const half = Math.ceil(group.length / 2)
  await byHalves(group.slice(0, half), ask, use)
  await byHalves(group.slice(half), ask, use)
}

function parsed<T>(schema: z.ZodType<T>, body: unknown): T | null {
  if (body === null) return null
  const result = schema.safeParse(body)
  if (!result.success) throw unreadableList('fal', result.error)
  return result.data
}

async function perImagePrices(
  ids: readonly string[],
  headers: Record<string, string>,
  options: ListOptions,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  const ask = (group: readonly string[]) =>
    patiently(options, async () =>
      parsed(PricingSchema, await falGet(`${PRICING}?${named(group)}`, headers, options)),
    )
  for (let start = 0; start < ids.length; start += PRICING_BATCH) {
    await byHalves(ids.slice(start, start + PRICING_BATCH), ask, (page) => {
      for (const price of page.prices) {
        if (PER_IMAGE_UNITS.has(price.unit) && price.currency === 'USD') {
          prices.set(price.endpoint_id, price.unit_price)
        }
      }
    })
  }
  return prices
}

async function schemasByEndpoint(
  ids: readonly string[],
  headers: Record<string, string>,
  options: ListOptions,
): Promise<Map<string, unknown>> {
  const groups: string[][] = []
  for (let start = 0; start < ids.length; start += SCHEMA_GROUP) {
    groups.push(ids.slice(start, start + SCHEMA_GROUP))
  }
  const schemas = new Map<string, unknown>()
  const ask = (group: readonly string[]) =>
    patiently(options, async () =>
      parsed(
        SearchSchema,
        await falGet(`${SEARCH}?${named(group)}&expand=openapi-3.0`, headers, options),
      ),
    )
  for (let at = 0; at < groups.length; at += SCHEMA_IN_FLIGHT) {
    await Promise.all(
      groups.slice(at, at + SCHEMA_IN_FLIGHT).map((group) =>
        byHalves(group, ask, (page) => {
          for (const model of page.models) schemas.set(model.endpoint_id, model.openapi)
        }),
      ),
    )
  }
  return schemas
}

export async function listFalModels(apiKey: string, options: ListOptions): Promise<ListedModel[]> {
  const headers = { Authorization: `Key ${apiKey}` }

  const found: z.infer<typeof SearchSchema>['models'] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      `${SEARCH}?category=text-to-image&status=active` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const parsed = await patiently(options, async () =>
      SearchSchema.parse(await getJson('fal', url, headers, options)),
    )
    found.push(...parsed.models)
    if (!parsed.has_more || !parsed.next_cursor) break
    cursor = parsed.next_cursor
  }

  const ids = found.map((model) => model.endpoint_id)
  const schemas = await schemasByEndpoint(ids, headers, options)
  const dialects = new Map(ids.map((id) => [id, falDialect(schemas.get(id))]))
  // Only an endpoint this app can send a request to is worth pricing. A
  // pricing failure other than "no price" still fails the whole refresh:
  // half a list is worse than yesterday's.
  const sendable = ids.filter((id) => dialects.get(id) !== null)
  const prices = await perImagePrices(sendable, headers, options)

  return found.map((model) => ({
    provider: 'fal',
    id: model.endpoint_id,
    label: model.metadata?.display_name ?? model.endpoint_id,
    kind: 'image',
    preview: false,
    contextTokens: null,
    maxOutputTokens: null,
    dialect: dialects.get(model.endpoint_id) ?? null,
    pricePerImage: prices.get(model.endpoint_id) ?? null,
  }))
}
