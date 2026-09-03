import { z } from 'zod'
import { mapNetworkError, throwForResponse } from '../llm/http'
import { imageGenModel } from './types'
import type { ImageGenProvider, ImageGenRequest, ImageGenResult, StockCallOptions } from './types'

/**
 * Gemini image models — the default `still` slot generator, riding the
 * Google key that Settings → Connections already holds for the LLM adapters.
 * That is the whole reason it is the default: the fal alternative needs an
 * account the user may not have, this needs nothing new. Which model runs is
 * `modelRouting.stills` (decision 208); the list below is what the Settings
 * dropdown offers.
 *
 * Differences from fal that shape this adapter:
 *  - One image per `generateContent` call, so N variants are N parallel
 *    calls rather than one call with `num_images`.
 *  - The bytes come back INLINE as base64, not behind a URL. They are
 *    surfaced as `data:` URLs, which the caller decodes straight into
 *    storage — nothing to fetch, nothing that can expire.
 *  - Like FLUX, there is no negative-prompt parameter, so the brief's
 *    negative prompt is folded in as an "Avoid:" clause rather than dropped.
 */

/**
 * Prices are USD per image, rounded UP so the estimate errs against the
 * budget, the same direction every estimate in this app errs. Flash: image
 * output is $30/1M tokens and one image is 1290 tokens (~$0.039). Pro
 * ("Nano Banana Pro"): a 1K/2K image is ~$0.134 of output tokens.
 */
const MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', pricePerImage: 0.04 },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image', pricePerImage: 0.15 },
] as const

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}`

/** The 16:9 preset renders 1344×768, same class as fal's, scaled at compile. */
const ASPECT_RATIO = '16:9'
const WIDTH = 1344
const HEIGHT = 768

const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(
              z.object({
                inlineData: z.object({ mimeType: z.string(), data: z.string().min(1) }).optional(),
              }),
            ),
          })
          .optional(),
      }),
    )
    .min(1),
})

export const geminiImageGen: ImageGenProvider = {
  id: 'google',
  label: 'Gemini via Google',
  models: MODELS,

  async generate(request: ImageGenRequest, options: StockCallOptions): Promise<ImageGenResult> {
    const apiKey = options.apiKey
    if (!apiKey) throw new Error('Gemini image generation requires the Google API key')

    // Resolved (and refused, on an unknown id) before any call is made.
    const model = imageGenModel(geminiImageGen, request.model)

    const prompt = request.negativePrompt
      ? `${request.prompt}. Avoid: ${request.negativePrompt}.`
      : request.prompt

    const fetchImpl = options.fetchImpl ?? fetch

    const one = async (): Promise<{ url: string; width: number; height: number }> => {
      let response: Response
      try {
        response = await fetchImpl(`${endpoint(model.id)}:generateContent`, {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { imageConfig: { aspectRatio: ASPECT_RATIO } },
          }),
          ...(options.signal ? { signal: options.signal } : {}),
        })
      } catch (cause) {
        throw mapNetworkError('google', cause)
      }
      if (!response.ok) await throwForResponse('google', response)

      const parsed = ResponseSchema.parse(await response.json())
      const image = parsed.candidates
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .find((part) => part.inlineData)?.inlineData
      if (!image) {
        // A 200 with no image part means the model answered in prose —
        // usually a safety refusal. Thrown rather than skipped so the slot
        // fails loudly instead of quietly generating fewer variants.
        throw new Error(`Gemini returned no image for this prompt (model ${model.id})`)
      }

      return {
        url: `data:${image.mimeType};base64,${image.data}`,
        width: WIDTH,
        height: HEIGHT,
      }
    }

    const images = await Promise.all(Array.from({ length: request.count }, one))
    return { images, estimatedCostUsd: model.pricePerImage * images.length }
  },

  /**
   * A GET of the default model's metadata: free, and it authenticates — an
   * invalid key answers 400/403, a valid one answers 200 with the model card.
   */
  async verifyKey(apiKey, options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch
    let response: Response
    try {
      response = await fetchImpl(endpoint(MODELS[0].id), {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('google', cause)
    }
    if (!response.ok) await throwForResponse('google', response)
  },
}
