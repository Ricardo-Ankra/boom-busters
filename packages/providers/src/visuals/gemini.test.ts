import { ContentPolicyError, ValidationError } from '@boom-busters/schemas'
import { describe, expect, it, vi } from 'vitest'
import { falImageGen } from './fal'
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

  it('sends each reference photo after a line naming its role, ahead of the prompt (decisions 253, 273)', async () => {
    const calls: { url: string; body: unknown }[] = []
    await geminiImageGen.generate(
      {
        prompt: 'Emad Mostaque, the person in the reference photo, at a desk',
        count: 1,
        references: [
          { name: 'Emad Mostaque', kind: 'character', mimeType: 'image/jpeg', data: 'QUJD' },
        ],
      },
      { apiKey: 'key', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
    )
    const parts = (calls[0]?.body as { contents: { parts: Record<string, unknown>[] }[] })
      .contents[0]!.parts
    expect(parts[0]).toEqual({
      text:
        'Reference image 1 of 1: Emad Mostaque. Use it for the likeness only; ' +
        'pose, clothing and framing come from the text.',
    })
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } })
    expect(parts[2]).toEqual({
      text: 'Emad Mostaque, the person in the reference photo, at a desk',
    })
  })

  it("labels a set plate as the place's design, never its framing (decision 273)", async () => {
    const calls: { url: string; body: unknown }[] = []
    await geminiImageGen.generate(
      {
        prompt: 'x',
        count: 1,
        model: 'gemini-3.1-flash-image',
        references: [
          { name: 'The boardroom', kind: 'object', mimeType: 'image/png', data: 'UExU' },
          { name: 'Emad Mostaque', kind: 'character', mimeType: 'image/jpeg', data: 'QUJD' },
        ],
      },
      { apiKey: 'key', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
    )
    const parts = (calls[0]?.body as { contents: { parts: Record<string, unknown>[] }[] })
      .contents[0]!.parts
    // People first whatever order they arrived in, each image after its label.
    expect(parts[0]).toEqual({
      text:
        'Reference image 1 of 2: Emad Mostaque. Use it for the likeness only; ' +
        'pose, clothing and framing come from the text.',
    })
    expect(parts[2]).toEqual({
      text:
        "Reference image 2 of 2: The boardroom. Use it for the place's design only " +
        '(architecture, materials, furniture, light), never its framing or camera position.',
    })
    expect(parts[3]).toEqual({ inlineData: { mimeType: 'image/png', data: 'UExU' } })
  })

  it('refuses more than three references before spending anything', async () => {
    const calls: { url: string; body: unknown }[] = []
    const four = Array.from(
      { length: geminiImageGen.referenceLimits().characters + 1 },
      (_, i) => ({
        name: `Person ${i}`,
        kind: 'character' as const,
        mimeType: 'image/jpeg' as const,
        data: 'QUJD',
      }),
    )
    await expect(
      geminiImageGen.generate(
        { prompt: 'a boardroom', count: 1, references: four },
        { apiKey: 'key', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
      ),
    ).rejects.toThrow(ValidationError)
    expect(calls).toHaveLength(0)
  })

  it('reports a 200 with prose but no image as a policy refusal (decision 252)', async () => {
    const refusal = { candidates: [{ content: { parts: [{ text: 'I cannot draw that.' }] } }] }
    const attempt = geminiImageGen.generate(
      { prompt: 'x', count: 1 },
      { apiKey: 'key', fetchImpl: fetchRecording([], refusal) },
    )
    await expect(attempt).rejects.toBeInstanceOf(ContentPolicyError)
    await expect(attempt).rejects.toThrow(/no image/)
  })

  it('reports a blocked prompt with no candidates as a policy refusal, naming the reason', async () => {
    const blocked = { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }
    const attempt = geminiImageGen.generate(
      { prompt: 'x', count: 1 },
      { apiKey: 'key', fetchImpl: fetchRecording([], blocked) },
    )
    await expect(attempt).rejects.toBeInstanceOf(ContentPolicyError)
    await expect(attempt).rejects.toThrow(/SAFETY/)
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

describe('referenceLimits', () => {
  it('reads the documented budget for each model', () => {
    expect(geminiImageGen.referenceLimits('gemini-3.1-flash-image')).toEqual({
      characters: 4,
      objects: 10,
    })
    expect(geminiImageGen.referenceLimits('gemini-3-pro-image')).toEqual({
      characters: 5,
      objects: 6,
    })
  })

  // An undocumented model gets the app's own policy, never a zero. A zero
  // refused nothing (every reference is a flat inline part, so there is no
  // object channel to close) and instead silently dropped every set plate.
  it("gives the model Google does not document the app's own policy budget", () => {
    expect(geminiImageGen.referenceLimits('gemini-2.5-flash-image')).toEqual({
      characters: 3,
      objects: 2,
    })
  })

  // The same answer fal gives for the same question, so a project's sets do
  // not depend on which generator it happens to be routed at.
  it('matches fal, which publishes no per-model figures either', () => {
    expect(geminiImageGen.referenceLimits('gemini-2.5-flash-image')).toEqual(
      falImageGen.referenceLimits(),
    )
  })

  it('defaults to the first model when none is named', () => {
    expect(geminiImageGen.referenceLimits()).toEqual(
      geminiImageGen.referenceLimits(geminiImageGen.models[0]!.id),
    )
  })
})

describe('refusing more references than the model takes', () => {
  const ref = (kind: 'character' | 'object', n: number) => ({
    name: `r${n}`,
    kind,
    mimeType: 'image/jpeg' as const,
    data: 'AAAA',
  })

  it('refuses a fifth person on the model that takes four, before spending', async () => {
    const fetchImpl = vi.fn()
    await expect(
      geminiImageGen.generate(
        {
          prompt: 'x',
          count: 1,
          model: 'gemini-3.1-flash-image',
          references: [1, 2, 3, 4, 5].map((n) => ref('character', n)),
        },
        { apiKey: 'k', fetchImpl },
      ),
    ).rejects.toThrow(/at most 4 reference photographs of people/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // 2.5 used to refuse every plate, which is what made a set silently inert on
  // it. It now takes the app's policy budget, so the refusal starts one past it.
  it('carries a set plate on the undocumented model, and refuses a third', async () => {
    const ok = vi.fn(fetchRecording([], IMAGE_REPLY))
    await geminiImageGen.generate(
      {
        prompt: 'x',
        count: 1,
        model: 'gemini-2.5-flash-image',
        references: [ref('object', 1), ref('object', 2)],
      },
      { apiKey: 'k', fetchImpl: ok },
    )
    expect(ok).toHaveBeenCalled()

    const tooMany = vi.fn()
    await expect(
      geminiImageGen.generate(
        {
          prompt: 'x',
          count: 1,
          model: 'gemini-2.5-flash-image',
          references: [1, 2, 3].map((n) => ref('object', n)),
        },
        { apiKey: 'k', fetchImpl: tooMany },
      ),
    ).rejects.toThrow(/at most 2 set plates/)
    expect(tooMany).not.toHaveBeenCalled()
  })

  it('accepts people and plates together inside both budgets', async () => {
    const fetchImpl = vi.fn(fetchRecording([], IMAGE_REPLY))
    await geminiImageGen.generate(
      {
        prompt: 'x',
        count: 1,
        model: 'gemini-3.1-flash-image',
        references: [ref('character', 1), ref('character', 2), ref('object', 3)],
      },
      { apiKey: 'k', fetchImpl },
    )
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))
    // Three labelled images and the prompt.
    expect(body.contents[0].parts).toHaveLength(7)
  })
})
