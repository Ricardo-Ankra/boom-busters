import { describe, expect, it } from 'vitest'
import { geminiImageGen } from './gemini'

/**
 * Against a recorded response shape, like every adapter test: the JSON is
 * the REST `generateContent` reply for an image request, trimmed. Gemini
 * hands bytes back inline, so the adapter's contract is data: URLs — nothing
 * to download, nothing that can expire.
 */

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUg=='

const IMAGE_REPLY = {
  candidates: [
    {
      content: {
        parts: [
          { text: 'Here is the image.' },
          { inlineData: { mimeType: 'image/png', data: PNG_BASE64 } },
        ],
      },
    },
  ],
}

function fetchRecording(calls: { url: string; body: unknown }[], reply: unknown): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? 'null')) })
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

describe('geminiImageGen', () => {
  it('generates N variants as N calls and returns inline bytes as data: URLs', async () => {
    const calls: { url: string; body: unknown }[] = []
    const result = await geminiImageGen.generate(
      { prompt: 'A deserted trading floor at dawn', count: 2 },
      { apiKey: 'key', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toContain('gemini-2.5-flash-image:generateContent')
    expect(result.images).toHaveLength(2)
    expect(result.images[0]?.url).toBe(`data:image/png;base64,${PNG_BASE64}`)
    expect(result.estimatedCostUsd).toBeCloseTo(geminiImageGen.models[0]!.pricePerImage * 2)
  })

  it('calls the routed model, at its own price (decision 208)', async () => {
    const calls: { url: string; body: unknown }[] = []
    const result = await geminiImageGen.generate(
      { prompt: 'A deserted trading floor at dawn', count: 1, model: 'gemini-3-pro-image' },
      { apiKey: 'key', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
    )

    expect(calls[0]?.url).toContain('gemini-3-pro-image:generateContent')
    expect(result.estimatedCostUsd).toBeCloseTo(
      geminiImageGen.models.find((model) => model.id === 'gemini-3-pro-image')!.pricePerImage,
    )
  })

  it('offers only Gemini-family ids the key actually serves (decision 211)', () => {
    // ListModels for this API serves NO imagen-* model — the ids 404 on
    // :predict. Pinned so an id cannot join without that check being redone.
    expect(geminiImageGen.models.map((model) => model.id)).toEqual([
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
    ])
  })

  it('refuses a model it does not list before any call is made', async () => {
    const calls: { url: string; body: unknown }[] = []
    await expect(
      geminiImageGen.generate(
        { prompt: 'A deserted trading floor at dawn', count: 1, model: 'imagen-nope' },
        { apiKey: 'key', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
      ),
    ).rejects.toThrow(/modelRouting\.stills/)
    // Refused before the purchase, not after it.
    expect(calls).toHaveLength(0)
  })

  it('asks for 16:9 and folds the negative prompt in, since the API has none', async () => {
    const calls: { url: string; body: unknown }[] = []
    await geminiImageGen.generate(
      { prompt: 'An empty office', negativePrompt: 'text, watermarks', count: 1 },
      { apiKey: 'key', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
    )

    const body = calls[0]?.body as {
      contents: { parts: { text: string }[] }[]
      generationConfig: { imageConfig: { aspectRatio: string } }
    }
    expect(body.contents[0]?.parts[0]?.text).toBe('An empty office. Avoid: text, watermarks.')
    expect(body.generationConfig.imageConfig.aspectRatio).toBe('16:9')
  })

  it('fails loudly when a 200 carries prose but no image — a quiet refusal', async () => {
    const refusal = { candidates: [{ content: { parts: [{ text: 'I cannot draw that.' }] } }] }
    await expect(
      geminiImageGen.generate(
        { prompt: 'x', count: 1 },
        { apiKey: 'key', fetchImpl: fetchRecording([], refusal) },
      ),
    ).rejects.toThrow(/no image/)
  })

  it('verifies the key against the model card without buying anything', async () => {
    const calls: { url: string; body: unknown }[] = []
    await geminiImageGen.verifyKey('key', {
      fetchImpl: fetchRecording(calls, { name: 'models/gemini-2.5-flash-image' }),
    })
    expect(calls[0]?.url).toMatch(/models\/gemini-2\.5-flash-image$/)

    const rejecting = (async () => new Response('{}', { status: 400 })) as typeof fetch
    await expect(geminiImageGen.verifyKey('bad', { fetchImpl: rejecting })).rejects.toThrow()
  })
})
