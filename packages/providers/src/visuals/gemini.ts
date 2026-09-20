import { ContentPolicyError, ValidationError } from '@boom-busters/schemas'
import { z } from 'zod'
import { mapNetworkError, throwForResponse } from '../llm/http'
import { imageGenModel } from './types'
import type {
  ImageGenProvider,
  ImageGenRequest,
  ImageGenResult,
  ReferenceLimits,
  StockCallOptions,
} from './types'

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
 * budget, the same direction every estimate in this app errs. 2.5 Flash:
 * image output is $30/1M tokens and one image is 1290 tokens (~$0.039).
 * 3.1 Flash: ~$0.067 for a 1K image. Pro ("Nano Banana Pro"): a 1K/2K image
 * is ~$0.134 of output tokens.
 *
 * The Imagen models were briefly offered here (decision 209) and are gone
 * (decision 211): the key's own `ListModels` serves NO `imagen-*` model —
 * every image model on this API is Gemini-family via `generateContent`, and
 * the `:predict` call answered 404. Imagen now lives behind Vertex AI's
 * separate auth world, which this app does not speak. Retired ids stored in
 * settings fold forward via `LEGACY_STILL_MODEL_IDS`. gemini-3.1-flash-lite-
 * image is served too but is absent here until it has a price worth
 * trusting — an unpriced model would walk through every budget cap.
 */
const MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', pricePerImage: 0.04 },
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', pricePerImage: 0.07 },
  { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image', pricePerImage: 0.15 },
] as const

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}`

/** The 16:9 preset renders 1344×768, same class as fal's, scaled at compile. */
const ASPECT_RATIO = '16:9'

/**
 * What each model takes, from Google's own documentation, read 2026-09-19.
 * The 2.5 row is not documented; it keeps exactly the budget this adapter
 * enforced before the two pools existed, because guessing a limit upward
 * spends money to discover it.
 */
const REFERENCE_LIMITS: Record<string, ReferenceLimits> = {
  'gemini-2.5-flash-image': { characters: 3, objects: 0 },
  'gemini-3.1-flash-image': { characters: 4, objects: 10 },
  'gemini-3-pro-image': { characters: 5, objects: 6 },
}

const WIDTH = 1344
const HEIGHT = 768

const ResponseSchema = z.object({
  // Optional, not min(1): a blocked prompt comes back with no candidates at
  // all and a `promptFeedback.blockReason`, and that is a refusal to report,
  // not a malformed reply to crash on (decision 252).
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
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
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

    const references = request.references ?? []
    if (references.some((reference) => !reference.data)) {
      throw new ValidationError(
        'Gemini takes reference photos inline; a reference without bytes cannot be sent.',
        { field: 'references' },
      )
    }
    const limits = geminiImageGen.referenceLimits(request.model)
    const characters = references.filter((reference) => reference.kind === 'character')
    const objects = references.filter((reference) => reference.kind === 'object')
    if (characters.length > limits.characters) {
      throw new ValidationError(
        `${model.label} takes at most ${limits.characters} reference photographs of people in ` +
          `one still; this brief shows ${characters.length}. Plan the group anonymously or ` +
          `split the shot.`,
        { field: 'references' },
      )
    }
    if (objects.length > limits.objects) {
      throw new ValidationError(
        limits.objects === 0
          ? `${model.label} takes no set plates. Route this slot at a Gemini 3 model, or drop ` +
              `the set from the brief.`
          : `${model.label} takes at most ${limits.objects} set plates in one still; this brief ` +
              `carries ${objects.length}.`,
        { field: 'references' },
      )
    }

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
            // Characters first, then objects, then the words about them
            // (decision 253, amended 264): the model reads the faces, then
            // the room, then what to do with them.
            contents: [
              {
                parts: [
                  ...[...characters, ...objects].map((reference) => ({
                    inlineData: { mimeType: reference.mimeType, data: reference.data ?? '' },
                  })),
                  { text: prompt },
                ],
              },
            ],
            generationConfig: { imageConfig: { aspectRatio: ASPECT_RATIO } },
          }),
          ...(options.signal ? { signal: options.signal } : {}),
        })
      } catch (cause) {
        throw mapNetworkError('google', cause)
      }
      if (!response.ok) await throwForResponse('google', response)

      const parsed = ResponseSchema.parse(await response.json())
      const image = (parsed.candidates ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .find((part) => part.inlineData)?.inlineData
      if (!image) {
        // A 200 with no image part is the model answering in prose, or a
        // blocked prompt: a policy refusal either way, and a human's problem
        // (decision 252), never a retry. Thrown rather than skipped so the
        // slot fails loudly instead of quietly generating fewer variants.
        const reason = parsed.promptFeedback?.blockReason
          ? `blocked the prompt (${parsed.promptFeedback.blockReason})`
          : 'returned no image for this prompt'
        throw new ContentPolicyError('google', `${reason} (model ${model.id})`)
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

  referenceLimits(modelId?: string): ReferenceLimits {
    const model = imageGenModel(geminiImageGen, modelId)
    return REFERENCE_LIMITS[model.id] ?? { characters: 3, objects: 0 }
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
