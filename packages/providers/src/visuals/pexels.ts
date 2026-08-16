import { z } from 'zod'
import type { SlotCandidate } from '@boom-busters/schemas'
import { mapNetworkError, throwForResponse } from '../llm/http'
import type { StockCallOptions, StockProvider, StockQuery } from './types'

/**
 * Pexels (https://www.pexels.com/api/): photos and videos, one keyed call
 * each, both free — the API costs nothing, which is why stock search carries
 * no price constant. Everything on Pexels is under the one Pexels License
 * (free commercial use, no attribution required — recorded anyway, because an
 * asset with its provenance attached survives an audit).
 */

const PEXELS = 'https://api.pexels.com'

const PhotoSchema = z.object({
  id: z.number(),
  width: z.number(),
  height: z.number(),
  url: z.string(),
  alt: z.string().nullish(),
  photographer: z.string().nullish(),
  src: z.object({ large2x: z.string(), medium: z.string() }),
})

const VideoFileSchema = z.object({
  link: z.string(),
  quality: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
})

const VideoSchema = z.object({
  id: z.number(),
  width: z.number(),
  height: z.number(),
  url: z.string(),
  duration: z.number(),
  image: z.string(),
  user: z.object({ name: z.string().nullish() }).nullish(),
  video_files: z.array(VideoFileSchema),
})

const PhotoResponseSchema = z.object({ photos: z.array(PhotoSchema) })
const VideoResponseSchema = z.object({ videos: z.array(VideoSchema) })

/**
 * The file the timeline would actually use: the largest HD-or-under variant.
 * 4K originals are rejected on purpose — the render is 1080p, and a 400 MB
 * source clip is bandwidth spent making the export slower.
 */
function bestVideoFile(files: z.infer<typeof VideoFileSchema>[]) {
  const usable = files.filter((file) => (file.width ?? 0) <= 1920 && file.link)
  usable.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return usable[0]
}

async function call(path: string, apiKey: string, options: StockCallOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${PEXELS}${path}`, {
      headers: { Authorization: apiKey },
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    throw mapNetworkError('pexels', cause)
  }
  if (!response.ok) await throwForResponse('pexels', response)
  return response.json()
}

export const pexelsStock: StockProvider = {
  id: 'pexels',
  requiresKey: true,

  async search(query: StockQuery, options: StockCallOptions): Promise<SlotCandidate[]> {
    const apiKey = options.apiKey
    if (!apiKey) throw new Error('pexels requires an API key')

    // Photos and clips both, half each: a Ken Burns brief wants a photo, a
    // "slow push-in" brief wants a clip, and the scoring pass — not the
    // fetch — decides which candidates actually fit.
    const photoCount = Math.ceil(query.count / 2)
    const videoCount = Math.max(1, Math.floor(query.count / 2))
    const term = encodeURIComponent(query.query)

    const [photosRaw, videosRaw] = await Promise.all([
      call(`/v1/search?query=${term}&per_page=${photoCount}`, apiKey, options),
      call(`/videos/search?query=${term}&per_page=${videoCount}`, apiKey, options),
    ])

    const photos = PhotoResponseSchema.parse(photosRaw).photos.map((photo): SlotCandidate => ({
      id: String(photo.id),
      provider: 'pexels',
      kind: 'image',
      sourceUrl: photo.src.large2x,
      pageUrl: photo.url,
      thumbUrl: photo.src.medium,
      width: photo.width,
      height: photo.height,
      licence: 'Pexels License',
      ...(photo.photographer
        ? { attributionText: `Photo by ${photo.photographer} on Pexels` }
        : {}),
      ...(photo.alt ? { summary: photo.alt } : {}),
    }))

    const videos = VideoResponseSchema.parse(videosRaw).videos.flatMap((video): SlotCandidate[] => {
      const file = bestVideoFile(video.video_files)
      if (!file) return []
      return [
        {
          id: String(video.id),
          provider: 'pexels',
          kind: 'video',
          sourceUrl: file.link,
          pageUrl: video.url,
          thumbUrl: video.image,
          width: file.width ?? video.width,
          height: file.height ?? video.height,
          durationMs: Math.round(video.duration * 1000),
          licence: 'Pexels License',
          ...(video.user?.name ? { attributionText: `Video by ${video.user.name} on Pexels` } : {}),
        },
      ]
    })

    return [...videos, ...photos]
  },

  async verifyKey(apiKey, options = {}) {
    await call('/v1/search?query=a&per_page=1', apiKey, options)
  },
}
