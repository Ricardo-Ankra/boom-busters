import { describe, expect, it } from 'vitest'
import { listProviderModels } from './listing'
import { mockListedModels } from './mock-listing'

/** Answers each URL from a table, and records what was asked. */
function serve(table: Record<string, unknown | ((url: string) => unknown)>, status = 200) {
  const urls: string[] = []
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input)
    urls.push(url)
    const key = Object.keys(table).find((prefix) => url.startsWith(prefix))
    if (!key) return new Response('{}', { status: 404 })
    const entry = table[key]
    const body = typeof entry === 'function' ? (entry as (url: string) => unknown)(url) : entry
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { fetchImpl, urls }
}

const FLUX = ['prompt', 'num_images', 'image_size']

interface FakeFalEndpoint {
  id: string
  /** Input schema properties; the dialect is read from these. Null: fal has lost the schema. */
  props: string[] | null
  price: { unit_price: number; unit: string } | 'none'
}

/**
 * fal as measured on 2026-10-06: plain search pages, schemas for named
 * endpoints (at most ten per page), and pricing that answers a whole batch
 * 404 when any endpoint in it has no price.
 */
function falServer(
  endpoints: FakeFalEndpoint[],
  options: { throttleFirstSchemaCall?: boolean } = {},
) {
  const urls: string[] = []
  let throttled = false
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers })
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input)
    urls.push(url)
    const params = new URL(url).searchParams
    const named = params.getAll('endpoint_id')
    if (url.startsWith('https://api.fal.ai/v1/models/pricing')) {
      const asked = endpoints.filter((e) => named.includes(e.id))
      if (asked.some((e) => e.price === 'none')) {
        return json({ error: { type: 'not_found', message: 'Endpoint(s) not found' } }, 404)
      }
      return json({
        prices: asked.map((e) => ({ endpoint_id: e.id, currency: 'USD', ...(e.price as object) })),
        has_more: false,
      })
    }
    if (params.get('expand') === 'openapi-3.0') {
      if (options.throttleFirstSchemaCall && !throttled) {
        throttled = true
        return json({ detail: 'slow down' }, 429, { 'retry-after': '2' })
      }
      const asked = endpoints.filter((e) => named.includes(e.id))
      if (asked.some((e) => e.props === null)) {
        return json({ error: { type: 'not_found', message: 'Endpoint(s) not found' } }, 404)
      }
      return json({
        models: asked.slice(0, 10).map((e) => ({
          endpoint_id: e.id,
          openapi: {
            components: {
              schemas: {
                XInput: { properties: Object.fromEntries((e.props ?? []).map((p) => [p, {}])) },
              },
            },
          },
        })),
        has_more: false,
      })
    }
    return json({
      models: endpoints.map((e) => ({
        endpoint_id: e.id,
        metadata: { display_name: `${e.id} label` },
      })),
      has_more: false,
    })
  }) as typeof fetch
  return { fetchImpl, urls }
}

describe('listProviderModels (decision 288)', () => {
  it('pages Anthropic by last_id and keeps the token limits', async () => {
    const { fetchImpl, urls } = serve({
      'https://api.anthropic.com/v1/models': (url: string) =>
        url.includes('after_id=claude-opus-5-5')
          ? {
              data: [{ id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }],
              has_more: false,
              last_id: 'claude-haiku-4-5-20251001',
            }
          : {
              data: [
                {
                  id: 'claude-opus-5-5',
                  display_name: 'Claude Opus 5.5',
                  max_input_tokens: 1_000_000,
                  max_tokens: 128_000,
                },
              ],
              has_more: true,
              last_id: 'claude-opus-5-5',
            },
    })
    const models = await listProviderModels('anthropic', 'k', { fetchImpl })
    expect(urls).toHaveLength(2)
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5-20251001'])
    expect(models[0]).toMatchObject({
      label: 'Claude Opus 5.5',
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      kind: 'llm',
    })
  })

  it('keeps OpenAI chat models only, and drops a dated snapshot of a listed alias', async () => {
    const { fetchImpl } = serve({
      'https://api.openai.com/v1/models': {
        data: [
          { id: 'gpt-5.5' },
          { id: 'gpt-5.5-2026-08-01' },
          { id: 'gpt-5.4-2026-01-01' },
          { id: 'o5' },
          { id: 'text-embedding-4' },
          { id: 'gpt-5-realtime' },
          { id: 'gpt-image-2' },
          { id: 'whisper-2' },
        ],
      },
    })
    const ids = (await listProviderModels('openai', 'k', { fetchImpl })).map((m) => m.id)
    expect(ids).toEqual(['gpt-5.5', 'gpt-5.4-2026-01-01', 'o5'])
  })

  it('splits Google by kind, flags previews, pages, and drops legacy ids', async () => {
    const { fetchImpl } = serve({
      'https://generativelanguage.googleapis.com/v1beta/models': (url: string) =>
        url.includes('pageToken=p2')
          ? {
              models: [
                {
                  name: 'models/gemini-9-pro-image',
                  displayName: 'Gemini 9 Pro Image',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }
          : {
              models: [
                {
                  name: 'models/gemini-9-flash',
                  displayName: 'Gemini 9 Flash',
                  inputTokenLimit: 1_048_576,
                  outputTokenLimit: 65_536,
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-9-pro-preview',
                  displayName: 'Gemini 9 Pro Preview',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-2.5-pro',
                  displayName: 'Gemini 2.5 Pro',
                  supportedGenerationMethods: ['generateContent'],
                },
                { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
                {
                  name: 'models/gemini-9-flash-tts',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
              nextPageToken: 'p2',
            },
    })
    const models = await listProviderModels('google', 'k', { fetchImpl })
    expect(models.map((m) => [m.id, m.kind, m.preview])).toEqual([
      ['gemini-9-flash', 'llm', false],
      ['gemini-9-pro-preview', 'llm', true],
      ['gemini-9-pro-image', 'image', false],
    ])
  })

  it('reads fal dialects from named-endpoint schemas and joins per-image prices', async () => {
    const { fetchImpl, urls } = falServer([
      { id: 'fal-ai/new-flux', props: FLUX, price: { unit_price: 0.02, unit: 'images' } },
      { id: 'fal-ai/megapixel', props: FLUX, price: { unit_price: 0.012, unit: 'megapixels' } },
      {
        id: 'fal-ai/single',
        props: ['prompt', 'image_size'],
        price: { unit_price: 0.05, unit: 'images' },
      },
    ])
    const models = await listProviderModels('fal', 'k', { fetchImpl })

    // The search walks plain pages of 100; schemas come per named endpoint,
    // because expanding them caps a page at ten (23 s for 203 endpoints).
    expect(urls[0]).toContain('category=text-to-image')
    expect(urls[0]).not.toContain('expand=')
    // Pricing is asked only for endpoints this app can send a request to.
    const pricing = urls.filter((url) => url.includes('/pricing'))
    expect(pricing.join(' ')).not.toContain('single')
    expect(models.map((m) => [m.id, m.label, m.dialect, m.pricePerImage])).toEqual([
      ['fal-ai/new-flux', 'fal-ai/new-flux label', 'flux', 0.02],
      ['fal-ai/megapixel', 'fal-ai/megapixel label', 'flux', null],
      ['fal-ai/single', 'fal-ai/single label', null, null],
    ])
  })

  it('asks for schemas ten named endpoints at a time', async () => {
    const endpoints = Array.from({ length: 23 }, (_, i) => ({
      id: `fal-ai/model-${i}`,
      props: FLUX,
      price: { unit_price: 0.01, unit: 'images' },
    }))
    const { fetchImpl, urls } = falServer(endpoints)
    const models = await listProviderModels('fal', 'k', { fetchImpl })

    const schemaCalls = urls.filter((url) => url.includes('expand=openapi-3.0'))
    expect(schemaCalls).toHaveLength(3)
    for (const url of schemaCalls) {
      expect(new URL(url).searchParams.getAll('endpoint_id').length).toBeLessThanOrEqual(10)
    }
    expect(models.filter((m) => m.dialect === 'flux')).toHaveLength(23)
  })

  it('splits a pricing batch fal answers 404 until the unpriced endpoint is found', async () => {
    // fal answers a whole batch "Endpoint(s) not found" when any one endpoint
    // in it has no price: one stale endpoint must not fail the refresh.
    const { fetchImpl } = falServer([
      { id: 'fal-ai/a', props: FLUX, price: { unit_price: 0.03, unit: 'images' } },
      { id: 'fal-ai/stale', props: FLUX, price: 'none' },
      { id: 'fal-ai/c', props: FLUX, price: { unit_price: 0.05, unit: 'images' } },
    ])
    const models = await listProviderModels('fal', 'k', { fetchImpl })
    expect(models.map((m) => [m.id, m.pricePerImage])).toEqual([
      ['fal-ai/a', 0.03],
      ['fal-ai/stale', null],
      ['fal-ai/c', 0.05],
    ])
  })

  it('skips an endpoint whose schema fal cannot find, keeping the rest of its group', async () => {
    // Seen live on 2026-10-06: a schema request naming one lost endpoint is
    // answered 404 as a whole, which failed the whole fal refresh.
    const { fetchImpl } = falServer([
      { id: 'fal-ai/a', props: FLUX, price: { unit_price: 0.03, unit: 'images' } },
      { id: 'fal-ai/lost', props: null, price: 'none' },
      { id: 'fal-ai/c', props: FLUX, price: { unit_price: 0.05, unit: 'images' } },
    ])
    const models = await listProviderModels('fal', 'k', { fetchImpl })
    expect(models.map((m) => [m.id, m.dialect, m.pricePerImage])).toEqual([
      ['fal-ai/a', 'flux', 0.03],
      ['fal-ai/lost', null, null],
      ['fal-ai/c', 'flux', 0.05],
    ])
  })

  it('waits out a 429 from fal and asks again', async () => {
    const waits: number[] = []
    const { fetchImpl } = falServer(
      [{ id: 'fal-ai/a', props: FLUX, price: { unit_price: 0.03, unit: 'images' } }],
      { throttleFirstSchemaCall: true },
    )
    const models = await listProviderModels('fal', 'k', {
      fetchImpl,
      sleepImpl: async (ms) => {
        waits.push(ms)
      },
    })
    expect(waits).toEqual([2000])
    expect(models[0]?.dialect).toBe('flux')
  })

  it('fails the whole fal refresh when its pricing call fails', async () => {
    const search = {
      models: [
        {
          endpoint_id: 'fal-ai/new-flux',
          openapi: {
            components: {
              schemas: { XInput: { properties: { prompt: {}, num_images: {}, image_size: {} } } },
            },
          },
        },
      ],
      has_more: false,
    }
    const fetchImpl = (async (input: string | URL) =>
      String(input).includes('/pricing')
        ? new Response('{"detail":"down"}', { status: 503 })
        : new Response(JSON.stringify(search), { status: 200 })) as typeof fetch
    await expect(listProviderModels('fal', 'k', { fetchImpl })).rejects.toThrow()
  })

  it('counts an empty list as a failure, so a bad filter cannot wipe a dropdown', async () => {
    const { fetchImpl } = serve({
      'https://api.openai.com/v1/models': { data: [{ id: 'whisper-2' }] },
    })
    await expect(listProviderModels('openai', 'k', { fetchImpl })).rejects.toThrow(
      /openai listed no models this app can use/,
    )
  })

  it('maps a rejected key to the shared error taxonomy', async () => {
    const { fetchImpl } = serve(
      { 'https://api.anthropic.com/v1/models': { error: { message: 'bad key' } } },
      401,
    )
    await expect(listProviderModels('anthropic', 'bad', { fetchImpl })).rejects.toThrow()
  })

  it('reports a malformed 200 body as a readable error, not a raw ZodError', async () => {
    const { fetchImpl } = serve({
      'https://api.anthropic.com/v1/models': { unexpected: true },
    })
    await expect(listProviderModels('anthropic', 'k', { fetchImpl })).rejects.toThrow(
      /anthropic returned a model list this app could not read/,
    )
  })

  it('reports a 200 that is not JSON as the same readable error, keeping the cause', async () => {
    const fetchImpl = (async () => new Response('not json', { status: 200 })) as typeof fetch
    const failure = await listProviderModels('anthropic', 'k', { fetchImpl }).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(
      'anthropic returned a model list this app could not read',
    )
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })
})

describe('mockListedModels', () => {
  it('holds the catalogue and the live-only fixtures, with no network', () => {
    expect(mockListedModels('anthropic').map((m) => m.id)).toEqual(
      expect.arrayContaining(['claude-opus-5', 'claude-opus-mock-9', 'claude-mock-unpriced']),
    )
    expect(
      mockListedModels('google').some((m) => m.id === 'gemini-9-flash-image' && m.kind === 'image'),
    ).toBe(true)
    expect(mockListedModels('fal').find((m) => m.id === 'fal-ai/mock-flux')).toMatchObject({
      dialect: 'flux',
      pricePerImage: 0.02,
    })
  })
})
