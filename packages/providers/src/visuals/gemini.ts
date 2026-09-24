import { ContentPolicyError, ValidationError } from '@boom-busters/schemas'
import { z } from 'zod'
import { mapNetworkError, throwForResponse } from '../llm/http'
import { imageGenModel, imageGenPrice } from './types'
import type {
  ImageGenProvider,
  ImageGenRequest,
  ImageGenResult,
  ImageReference,
  ImageSize,
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
 * Per size, from Google's pricing page (2026-09-24): 3.1 Flash $0.067 at 1K,
 * $0.101 at 2K, $0.151 at 4K; 3 Pro $0.134 at 1K or 2K, $0.24 at 4K; each
 * rounded up.
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
  {
    id: 'gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    pricePerImage: 0.07,
    pricesBySize: { '1K': 0.07, '2K': 0.11, '4K': 0.16 },
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    pricePerImage: 0.15,
    pricesBySize: { '1K': 0.15, '2K': 0.15, '4K': 0.24 },
  },
] as const

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}`

/** The 16:9 preset renders 1344×768, same class as fal's, scaled at compile. */
const ASPECT_RATIO = '16:9'

/** Models that take `imageConfig.imageSize`; 2.5 Flash has one size and would be refused. */
const SIZED_MODELS = new Set(['gemini-3.1-flash-image', 'gemini-3-pro-image'])
/**
 * Models that take `thinkingConfig`. The API errors when it is set on a model
 * without thinking, and 3 Pro always reasons without being asked (decision 275).
 */
const THINKING_MODELS = new Set(['gemini-3.1-flash-image'])

/** Pixel size reported for each output size at 16:9; the bytes are what they are. */
const DIMENSIONS: Record<ImageSize, { width: number; height: number }> = {
  '1K': { width: 1344, height: 768 },
  '2K': { width: 2688, height: 1536 },
  '4K': { width: 5376, height: 3072 },
}

/**
 * What a Gemini model with no published reference table is allowed to carry:
 * the app's own policy caps, mirroring `falImageGen.referenceLimits`. Kept as
 * one constant so the table row and the lookup fallback cannot drift apart.
 */
const UNDOCUMENTED_LIMITS: ReferenceLimits = { characters: 3, objects: 2 }

/**
 * What each model takes. The Gemini 3 rows are Google's own published figures
 * (documentation read 2026-09-19, re-checked 2026-09-23); they differ because
 * the models genuinely differ, and they are worth respecting.
 *
 * There is no such table for 2.5, and the row below is NOT a reading of one.
 * It is this adapter's fallback, which is the app's own policy cap — the same
 * answer `falImageGen.referenceLimits` gives, for the same reason: fal
 * publishes no per-model figures either.
 *
 * It used to be `objects: 0`, preserving the budget from before set plates
 * existed. That was wrong twice over. The API has no object channel to be
 * zero — every reference travels as an `inlineData` part in one flat list, and
 * "character" and "object" are this app's own bookkeeping — so a zero refused
 * nothing and disabled a feature instead: `referenceBudgets` clamped the pool
 * to nothing, `referencePlates` returned none, the set resolved to null, and a
 * still routed here was generated with no plate AND a prompt that never named
 * the room. Silently, on every shot, for every project on 2.5. And the reason
 * given for the caution — that guessing upward spends money — was simply
 * false: `pricePerImage` bills the image GENERATED, so what a call carries in
 * changes nothing about what it costs.
 *
 * Undocumented now means "the app decides", never "the feature is off".
 */
const REFERENCE_LIMITS: Record<string, ReferenceLimits> = {
  'gemini-2.5-flash-image': UNDOCUMENTED_LIMITS,
  'gemini-3.1-flash-image': { characters: 4, objects: 10 },
  'gemini-3-pro-image': { characters: 5, objects: 6 },
}

/**
 * The line sent immediately before each reference image, saying what it is
 * FOR (decision 273). Unlabelled, the images arrived as one flat list and
 * the model treated a room's photograph as the picture to edit: every still
 * of a set kept the plate's exact framing, and the person was pasted onto
 * it at the wrong scale. A face is for likeness; a place is for its
 * furniture, materials and light (decision 275). A plate's label no longer
 * says "never its framing": the contact sheet asks for the north plate's view,
 * and every still prompt already says the photograph is new from the camera
 * it names, so the negative wording only contradicted the sheet.
 */
export function referenceLabel(
  reference: Pick<ImageReference, 'name' | 'kind' | 'facing'>,
  position: number,
  total: number,
): string {
  const role =
    reference.kind === 'character'
      ? 'use it for the likeness only; pose, clothing and framing come from the text'
      : "use it for the room's furniture, materials and light"
  const facing =
    reference.facing === undefined
      ? ''
      : reference.facing === 'detail'
        ? ', a close detail'
        : `, facing ${reference.facing}`
  return `Reference image ${position} of ${total}: ${reference.name}${facing}. ${role[0]!.toUpperCase()}${role.slice(1)}.`
}

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
                thought: z.boolean().optional(),
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
    const ordered = [...characters, ...objects]

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
            // the room, then what to do with them. Each image is preceded by
            // a line saying what it is for (decision 273).
            contents: [
              {
                parts: [
                  ...ordered.flatMap((reference, at) => [
                    { text: referenceLabel(reference, at + 1, ordered.length) },
                    {
                      inlineData: { mimeType: reference.mimeType, data: reference.data ?? '' },
                    },
                  ]),
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              imageConfig: {
                aspectRatio: ASPECT_RATIO,
                ...(request.size && SIZED_MODELS.has(model.id) ? { imageSize: request.size } : {}),
              },
              ...(THINKING_MODELS.has(model.id)
                ? { thinkingConfig: { thinkingLevel: 'HIGH' } }
                : {}),
            },
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
        .filter((part) => part.inlineData && part.thought !== true)
        .at(-1)?.inlineData
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

      const size = request.size && SIZED_MODELS.has(model.id) ? request.size : '1K'
      return {
        url: `data:${image.mimeType};base64,${image.data}`,
        ...DIMENSIONS[size],
      }
    }

    const images = await Promise.all(Array.from({ length: request.count }, one))
    return {
      images,
      estimatedCostUsd: imageGenPrice(geminiImageGen, images.length, model.id, request.size),
    }
  },

  referenceLimits(modelId?: string): ReferenceLimits {
    const model = imageGenModel(geminiImageGen, modelId)
    return REFERENCE_LIMITS[model.id] ?? UNDOCUMENTED_LIMITS
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
