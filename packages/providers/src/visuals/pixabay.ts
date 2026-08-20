import { z } from 'zod'
import type { SlotCandidate } from '@boom-busters/schemas'
import { mapNetworkError, throwForResponse } from '../llm/http'
import type { StockCallOptions, StockProvider, StockQuery, StockRefetch } from './types'

/**
 * Pixabay (https://pixabay.com/api/docs/): images and videos, keyed but free,
 * everything under the Pixabay Content License. Two quirks worth naming: the
 * key rides in the query string rather than a header, and `per_page` has a
 * floor of 3 — asking for fewer is a 400, so counts are clamped up.
 */

const PIXABAY = 'https://pixabay.com/api'

const ImageHitSchema = z.object({
  id: z.number(),
  pageURL: z.string(),
  tags: z.string().nullish(),
  previewURL: z.string(),
  webformatURL: z.string(),
  largeImageURL: z.string(),
  imageWidth: z.number(),
  imageHeight: z.number(),
})

const VideoVariantSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
  thumbnail: z.string().nullish(),
})

const VideoHitSchema = z.object({
  id: z.number(),
  pageURL: z.string(),
  tags: z.string().nullish(),
  duration: z.number(),
  videos: z.object({
    large: VideoVariantSchema.nullish(),
    medium: VideoVariantSchema.nullish(),
    small: VideoVariantSchema.nullish(),
    tiny: VideoVariantSchema.nullish(),
  }),
})

type VideoVariant = z.infer<typeof VideoVariantSchema>

/** Largest variant at or under HD — the render's source (same rule as Pexels). */
function bestVariant(hit: z.infer<typeof VideoHitSchema>): VideoVariant | undefined {
  return [hit.videos.large, hit.videos.medium, hit.videos.small]
    .filter((variant): variant is VideoVariant => Boolean(variant?.url))
    .filter((variant) => variant.width <= 1920)
    .sort((a, b) => b.width - a.width)[0]
}

/**
 * Smallest variant still ≥426 px wide — the browser preview's proxy, kept
 * cheap enough for machines whose video decode runs in software.
 */
function previewVariant(hit: z.infer<typeof VideoHitSchema>): VideoVariant | undefined {
  return [hit.videos.large, hit.videos.medium, hit.videos.small, hit.videos.tiny]
    .filter((variant): variant is VideoVariant => Boolean(variant?.url))
    .filter((variant) => variant.width >= 426)
    .sort((a, b) => a.width - b.width)[0]
}

const ImageResponseSchema = z.object({ hits: z.array(ImageHitSchema) })
const VideoResponseSchema = z.object({ hits: z.array(VideoHitSchema) })

async function call(path: string, options: StockCallOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${PIXABAY}${path}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    throw mapNetworkError('pixabay', cause)
  }
  if (!response.ok) await throwForResponse('pixabay', response)
  return response.json()
}

/**
 * Like `call`, but for id lookups, where Pixabay answers an unknown id with
 * a 400 (`[ERROR 400] "id" is invalid`) rather than a 404 — so on this path
 * a 400 means "the asset is gone", not "the request was malformed".
 */
async function callOrGone(path: string, options: StockCallOptions): Promise<unknown | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${PIXABAY}${path}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    throw mapNetworkError('pixabay', cause)
  }
  if (response.status === 400 || response.status === 404) return null
  if (!response.ok) await throwForResponse('pixabay', response)
  return response.json()
}

/** `per_page` floor — see module comment. */
function perPage(n: number): number {
  return Math.max(3, n)
}

export const pixabayStock: StockProvider = {
  id: 'pixabay',
  requiresKey: true,

  async search(query: StockQuery, options: StockCallOptions): Promise<SlotCandidate[]> {
    const apiKey = options.apiKey
    if (!apiKey) throw new Error('pixabay requires an API key')

    const photoCount = Math.ceil(query.count / 2)
    const videoCount = Math.max(1, Math.floor(query.count / 2))
    const term = encodeURIComponent(query.query)
    const auth = `key=${encodeURIComponent(apiKey)}`

    const [imagesRaw, videosRaw] = await Promise.all([
      call(
        `/?${auth}&q=${term}&image_type=photo&safesearch=true&per_page=${perPage(photoCount)}`,
        options,
      ),
      call(`/videos/?${auth}&q=${term}&safesearch=true&per_page=${perPage(videoCount)}`, options),
    ])

    const images = ImageResponseSchema.parse(imagesRaw)
      .hits.slice(0, photoCount)
      .map((hit): SlotCandidate => ({
        id: String(hit.id),
        provider: 'pixabay',
        kind: 'image',
        sourceUrl: hit.largeImageURL,
        pageUrl: hit.pageURL,
        thumbUrl: hit.webformatURL,
        width: hit.imageWidth,
        height: hit.imageHeight,
        licence: 'Pixabay Content License',
        ...(hit.tags ? { summary: hit.tags } : {}),
      }))

    const videos = VideoResponseSchema.parse(videosRaw)
      .hits.slice(0, videoCount)
      .flatMap((hit): SlotCandidate[] => {
        const file = bestVariant(hit)
        if (!file) return []
        const preview = previewVariant(hit)
        return [
          {
            id: String(hit.id),
            provider: 'pixabay',
            kind: 'video',
            sourceUrl: file.url,
            ...(preview && preview.url !== file.url ? { previewSourceUrl: preview.url } : {}),
            pageUrl: hit.pageURL,
            ...(file.thumbnail ? { thumbUrl: file.thumbnail } : {}),
            width: file.width,
            height: file.height,
            durationMs: Math.round(hit.duration * 1000),
            licence: 'Pixabay Content License',
            ...(hit.tags ? { summary: hit.tags } : {}),
          },
        ]
      })

    return [...videos, ...images]
  },

  async refetch(input, options): Promise<StockRefetch | null> {
    const apiKey = options.apiKey
    if (!apiKey) throw new Error('pixabay requires an API key')
    const auth = `key=${encodeURIComponent(apiKey)}`
    const id = encodeURIComponent(input.id)

    if (input.kind === 'image') {
      const raw = await callOrGone(`/?${auth}&id=${id}`, options)
      if (raw === null) return null
      const hit = ImageResponseSchema.parse(raw).hits[0]
      if (!hit) return null
      return { sourceUrl: hit.largeImageURL, width: hit.imageWidth, height: hit.imageHeight }
    }

    const raw = await callOrGone(`/videos/?${auth}&id=${id}`, options)
    if (raw === null) return null
    const hit = VideoResponseSchema.parse(raw).hits[0]
    if (!hit) return null
    const file = bestVariant(hit)
    if (!file) return null
    const preview = previewVariant(hit)
    return {
      sourceUrl: file.url,
      ...(preview && preview.url !== file.url ? { previewSourceUrl: preview.url } : {}),
      width: file.width,
      height: file.height,
      durationMs: Math.round(hit.duration * 1000),
    }
  },

  async verifyKey(apiKey, options = {}) {
    await call(`/?key=${encodeURIComponent(apiKey)}&q=a&per_page=3`, options)
  },
}
