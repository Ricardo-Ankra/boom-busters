import { z } from 'zod'
import { mapNetworkError, throwForResponse } from '../llm/http'
import type { ImageGenProvider, ImageGenRequest, ImageGenResult, StockCallOptions } from './types'

/**
 * fal.ai running FLUX.1 [dev] — the `still` slot generator.
 *
 * The synchronous endpoint (`fal.run`) rather than the queue: a two-image
 * generation returns in seconds, comfortably inside one Inngest step, and the
 * queue's submit/poll dance is machinery this call does not need.
 *
 * FLUX has no negative-prompt input — it is guidance-distilled, so the
 * SD-style parameter simply does not exist on the API. The brief's negative
 * prompt is folded into the prompt as an "Avoid:" clause instead, which FLUX
 * does honour; folded rather than dropped, because the brief writer said
 * something and silently ignoring it is the thing spec principle 6 forbids.
 */

const FAL_ENDPOINT = 'https://fal.run/fal-ai/flux/dev'

/**
 * USD per image. fal prices FLUX.1 [dev] at $0.025/megapixel and the 16:9
 * size is ~1.03 MP; rounded UP so the estimate errs against the budget, the
 * same direction every estimate in this app errs.
 */
const PRICE_PER_IMAGE_USD = 0.03

const ResponseSchema = z.object({
  images: z.array(
    z.object({
      url: z.string(),
      width: z.number().nullish(),
      height: z.number().nullish(),
    }),
  ),
})

/** The render is 1920×1080; fal's preset generates 1344×768, scaled at compile. */
const IMAGE_SIZE = 'landscape_16_9'

export const falImageGen: ImageGenProvider = {
  id: 'fal',
  pricePerImage: PRICE_PER_IMAGE_USD,

  async generate(request: ImageGenRequest, options: StockCallOptions): Promise<ImageGenResult> {
    const apiKey = options.apiKey
    if (!apiKey) throw new Error('fal requires an API key')

    const prompt = request.negativePrompt
      ? `${request.prompt}. Avoid: ${request.negativePrompt}.`
      : request.prompt

    const fetchImpl = options.fetchImpl ?? fetch
    let response: Response
    try {
      response = await fetchImpl(FAL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          image_size: IMAGE_SIZE,
          num_images: request.count,
          enable_safety_checker: true,
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('fal', cause)
    }
    if (!response.ok) await throwForResponse('fal', response)

    const parsed = ResponseSchema.parse(await response.json())

    return {
      images: parsed.images.map((image) => ({
        url: image.url,
        width: image.width ?? 1344,
        height: image.height ?? 768,
      })),
      estimatedCostUsd: PRICE_PER_IMAGE_USD * parsed.images.length,
    }
  },

  /**
   * fal has no free "who am I" endpoint, so this leans on the run endpoint's
   * auth check: a GET is the wrong method, and fal validates the key BEFORE
   * the method — an invalid key answers 401, a valid one answers 405. Only
   * auth failures are treated as failures; everything else proves the key
   * was accepted without buying an image.
   */
  async verifyKey(apiKey, options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch
    let response: Response
    try {
      response = await fetchImpl(FAL_ENDPOINT, {
        method: 'GET',
        headers: { Authorization: `Key ${apiKey}` },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('fal', cause)
    }
    if (response.status === 401 || response.status === 403) {
      await throwForResponse('fal', response)
    }
  },
}
