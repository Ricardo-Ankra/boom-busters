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

describe('listProviderModels (decision 287)', () => {
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

  it('reads fal dialects and joins image prices, ignoring per-megapixel ones', async () => {
    const schema = (props: string[]) => ({
      components: {
        schemas: { XInput: { properties: Object.fromEntries(props.map((p) => [p, {}])) } },
      },
    })
    const { fetchImpl, urls } = serve({
      'https://api.fal.ai/v1/models/pricing': {
        prices: [
          { endpoint_id: 'fal-ai/new-flux', unit_price: 0.02, unit: 'image', currency: 'USD' },
          {
            endpoint_id: 'fal-ai/megapixel',
            unit_price: 0.012,
            unit: 'megapixel',
            currency: 'USD',
          },
        ],
        has_more: false,
      },
      'https://api.fal.ai/v1/models': {
        models: [
          {
            endpoint_id: 'fal-ai/new-flux',
            metadata: { display_name: 'New FLUX' },
            openapi: schema(['prompt', 'num_images', 'image_size']),
          },
          {
            endpoint_id: 'fal-ai/megapixel',
            metadata: { display_name: 'Megapixel' },
            openapi: schema(['prompt', 'num_images', 'image_size']),
          },
          {
            endpoint_id: 'fal-ai/single',
            metadata: { display_name: 'Single' },
            openapi: schema(['prompt', 'image_size']),
          },
        ],
        has_more: false,
      },
    })
    const models = await listProviderModels('fal', 'k', { fetchImpl })
    expect(urls[0]).toContain('category=text-to-image')
    expect(urls[0]).toContain('expand=openapi-3.0')
    expect(models.map((m) => [m.id, m.dialect, m.pricePerImage])).toEqual([
      ['fal-ai/new-flux', 'flux', 0.02],
      ['fal-ai/megapixel', 'flux', null],
      ['fal-ai/single', null, null],
    ])
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
