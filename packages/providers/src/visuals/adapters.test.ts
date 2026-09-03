import { RateLimitError, TransientProviderError, ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { falImageGen } from './fal'
import { pexelsStock } from './pexels'
import { pixabayStock } from './pixabay'
import { wikimediaStock } from './wikimedia'
import type { StockQuery } from './types'

/**
 * Adapters against recorded fixtures (spec section 13): the JSON below is
 * trimmed from real API responses, so a vendor changing shape breaks here
 * rather than mid-pipeline.
 */

const QUERY: StockQuery = {
  query: 'empty office dusk',
  brief: 'Deserted open-plan office at dusk.',
  rejectionCriteria: ['no watermarks'],
  count: 4,
}

function fetchReturning(bodyByUrl: (url: string) => unknown): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    return new Response(JSON.stringify(bodyByUrl(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

function fetchFailing(status: number, body = ''): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch
}

// ---------------------------------------------------------------------------
// Pexels
// ---------------------------------------------------------------------------

const PEXELS_PHOTOS = {
  photos: [
    {
      id: 1181605,
      width: 5184,
      height: 3456,
      url: 'https://www.pexels.com/photo/office-1181605/',
      alt: 'Empty office with rows of desks at dusk',
      photographer: 'Christina Morillo',
      src: {
        large2x: 'https://images.pexels.com/photos/1181605/office.jpeg?w=1920',
        medium: 'https://images.pexels.com/photos/1181605/office.jpeg?w=350',
      },
    },
  ],
}

const PEXELS_VIDEOS = {
  videos: [
    {
      id: 3129957,
      width: 3840,
      height: 2160,
      url: 'https://www.pexels.com/video/office-3129957/',
      duration: 12,
      image: 'https://images.pexels.com/videos/3129957/office.jpeg',
      user: { name: 'Pressmaster' },
      video_files: [
        { link: 'https://player.pexels.com/4k.mp4', quality: 'uhd', width: 3840, height: 2160 },
        { link: 'https://player.pexels.com/hd.mp4', quality: 'hd', width: 1920, height: 1080 },
        { link: 'https://player.pexels.com/sd.mp4', quality: 'sd', width: 960, height: 540 },
      ],
    },
  ],
}

describe('pexelsStock', () => {
  it('maps photos and videos into candidates, HD file preferred over 4K', async () => {
    const candidates = await pexelsStock.search(QUERY, {
      apiKey: 'key',
      fetchImpl: fetchReturning((url) =>
        url.includes('/videos/') ? PEXELS_VIDEOS : PEXELS_PHOTOS,
      ),
    })

    expect(candidates).toHaveLength(2)

    const video = candidates.find((candidate) => candidate.kind === 'video')
    expect(video?.sourceUrl).toBe('https://player.pexels.com/hd.mp4')
    // The smallest variant ≥426px wide rides along as the preview proxy.
    expect(video?.previewSourceUrl).toBe('https://player.pexels.com/sd.mp4')
    expect(video?.durationMs).toBe(12000)
    expect(video?.licence).toBe('Pexels License')

    const photo = candidates.find((candidate) => candidate.kind === 'image')
    expect(photo?.summary).toContain('Empty office')
    expect(photo?.attributionText).toContain('Christina Morillo')
  })

  it('maps a 429 to RateLimitError and a 500 to TransientProviderError', async () => {
    await expect(
      pexelsStock.search(QUERY, { apiKey: 'key', fetchImpl: fetchFailing(429) }),
    ).rejects.toBeInstanceOf(RateLimitError)
    await expect(
      pexelsStock.search(QUERY, { apiKey: 'key', fetchImpl: fetchFailing(500) }),
    ).rejects.toBeInstanceOf(TransientProviderError)
  })

  it('names Settings → Connections on a rejected key', async () => {
    await expect(
      pexelsStock.search(QUERY, { apiKey: 'bad', fetchImpl: fetchFailing(401) }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refetches a photo and a video by id, and answers null when gone', async () => {
    const photo = await pexelsStock.refetch!(
      { id: '1181605', kind: 'image' },
      {
        apiKey: 'key',
        fetchImpl: fetchReturning((url) => {
          expect(url).toContain('/v1/photos/1181605')
          return PEXELS_PHOTOS.photos[0]!
        }),
      },
    )
    expect(photo?.sourceUrl).toBe('https://images.pexels.com/photos/1181605/office.jpeg?w=1920')

    const video = await pexelsStock.refetch!(
      { id: '3129957', kind: 'video' },
      {
        apiKey: 'key',
        fetchImpl: fetchReturning((url) => {
          expect(url).toContain('/videos/videos/3129957')
          return PEXELS_VIDEOS.videos[0]!
        }),
      },
    )
    expect(video?.sourceUrl).toBe('https://player.pexels.com/hd.mp4')
    expect(video?.durationMs).toBe(12000)

    await expect(
      pexelsStock.refetch!(
        { id: '404404', kind: 'image' },
        { apiKey: 'key', fetchImpl: fetchFailing(404) },
      ),
    ).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pixabay
// ---------------------------------------------------------------------------

const PIXABAY_IMAGES = {
  hits: [
    {
      id: 2557396,
      pageURL: 'https://pixabay.com/photos/office-2557396/',
      tags: 'office, empty, dusk',
      previewURL: 'https://cdn.pixabay.com/photo/office_150.jpg',
      webformatURL: 'https://cdn.pixabay.com/photo/office_640.jpg',
      largeImageURL: 'https://pixabay.com/get/office_1280.jpg',
      imageWidth: 4752,
      imageHeight: 3168,
    },
  ],
}

const PIXABAY_VIDEOS = {
  hits: [
    {
      id: 31377,
      pageURL: 'https://pixabay.com/videos/office-31377/',
      tags: 'office, timelapse',
      duration: 16,
      videos: {
        large: {
          url: 'https://cdn.pixabay.com/video/large.mp4',
          width: 1920,
          height: 1080,
          thumbnail: 'https://cdn.pixabay.com/video/large.jpg',
        },
        medium: {
          url: 'https://cdn.pixabay.com/video/medium.mp4',
          width: 1280,
          height: 720,
          thumbnail: 'https://cdn.pixabay.com/video/medium.jpg',
        },
        small: null,
      },
    },
  ],
}

describe('pixabayStock', () => {
  it('maps hits into candidates with the Pixabay licence', async () => {
    const candidates = await pixabayStock.search(QUERY, {
      apiKey: 'key',
      fetchImpl: fetchReturning((url) =>
        url.includes('/videos/') ? PIXABAY_VIDEOS : PIXABAY_IMAGES,
      ),
    })

    expect(candidates).toHaveLength(2)
    expect(candidates.every((candidate) => candidate.licence === 'Pixabay Content License')).toBe(
      true,
    )

    const video = candidates.find((candidate) => candidate.kind === 'video')
    expect(video?.sourceUrl).toBe('https://cdn.pixabay.com/video/large.mp4')
    expect(video?.previewSourceUrl).toBe('https://cdn.pixabay.com/video/medium.mp4')
    expect(video?.durationMs).toBe(16000)
  })

  it('keeps per_page at Pixabay’s floor of 3', async () => {
    const urls: string[] = []
    await pixabayStock.search(
      { ...QUERY, count: 2 },
      {
        apiKey: 'key',
        fetchImpl: fetchReturning((url) => {
          urls.push(url)
          return url.includes('/videos/') ? PIXABAY_VIDEOS : PIXABAY_IMAGES
        }),
      },
    )
    expect(urls.every((url) => /per_page=3/.test(url))).toBe(true)
  })

  it('refetches by id — the fresh signed URL Pixabay mints for a permanent id', async () => {
    const image = await pixabayStock.refetch!(
      { id: '2557396', kind: 'image' },
      {
        apiKey: 'key',
        fetchImpl: fetchReturning((url) => {
          expect(url).toContain('id=2557396')
          return PIXABAY_IMAGES
        }),
      },
    )
    expect(image?.sourceUrl).toBe('https://pixabay.com/get/office_1280.jpg')

    const video = await pixabayStock.refetch!(
      { id: '31377', kind: 'video' },
      { apiKey: 'key', fetchImpl: fetchReturning(() => PIXABAY_VIDEOS) },
    )
    expect(video?.sourceUrl).toBe('https://cdn.pixabay.com/video/large.mp4')
  })

  it('treats an id-lookup 400 as "gone" — Pixabay has no 404 for unknown ids', async () => {
    await expect(
      pixabayStock.refetch!(
        { id: '999999999', kind: 'image' },
        { apiKey: 'key', fetchImpl: fetchFailing(400, '[ERROR 400] "id" is invalid.') },
      ),
    ).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Wikimedia Commons
// ---------------------------------------------------------------------------

const COMMONS_RESPONSE = {
  query: {
    pages: [
      {
        pageid: 82814494,
        title: 'File:Wirecard headquarters Aschheim 2019.jpg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/wikipedia/commons/wirecard-hq.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Wirecard_hq.jpg',
            thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/wirecard-hq-640.jpg',
            width: 5472,
            height: 3648,
            extmetadata: {
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              Artist: { value: '<a href="https://example.com">Leo Molatore</a>' },
              ImageDescription: { value: 'Wirecard <b>headquarters</b> in Aschheim' },
            },
          },
        ],
      },
      {
        pageid: 99,
        title: 'File:No imageinfo.jpg',
        imageinfo: null,
      },
    ],
  },
}

describe('wikimediaStock', () => {
  it('reports exactly the licence Commons states, with HTML stripped from credits', async () => {
    const candidates = await wikimediaStock.search(QUERY, {
      fetchImpl: fetchReturning(() => COMMONS_RESPONSE),
    })

    expect(candidates).toHaveLength(1)
    const [candidate] = candidates
    expect(candidate?.licence).toBe('CC BY-SA 4.0')
    expect(candidate?.attributionText).toBe('Leo Molatore')
    expect(candidate?.summary).toContain('Wirecard headquarters in Aschheim')
    expect(candidate?.summary).not.toContain('<b>')
  })

  it('says "verify at source" rather than guessing a missing licence', async () => {
    const stripped = {
      query: {
        pages: [
          {
            pageid: 1,
            title: 'File:Mystery.jpg',
            imageinfo: [{ url: 'https://upload.wikimedia.org/mystery.jpg' }],
          },
        ],
      },
    }
    const candidates = await wikimediaStock.search(QUERY, {
      fetchImpl: fetchReturning(() => stripped),
    })
    expect(candidates[0]?.licence).toBe('Unknown — verify at source')
  })
})

// ---------------------------------------------------------------------------
// fal FLUX
// ---------------------------------------------------------------------------

describe('falImageGen', () => {
  it('folds the negative prompt into the prompt — FLUX has no negative input', async () => {
    let sentBody: Record<string, unknown> = {}
    const result = await falImageGen.generate(
      { prompt: '1995 trading floor', negativePrompt: 'modern screens', count: 2 },
      {
        apiKey: 'key',
        fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
          sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
          return new Response(
            JSON.stringify({
              images: [
                { url: 'https://fal.media/files/a.png', width: 1344, height: 768 },
                { url: 'https://fal.media/files/b.png', width: 1344, height: 768 },
              ],
            }),
            { status: 200 },
          )
        }) as typeof fetch,
      },
    )

    expect(sentBody['prompt']).toBe('1995 trading floor. Avoid: modern screens.')
    expect(sentBody['num_images']).toBe(2)
    expect(result.images).toHaveLength(2)
    expect(result.estimatedCostUsd).toBeCloseTo(falImageGen.models[0]!.pricePerImage * 2)
  })

  it('runs the routed FLUX variant at its own endpoint and price (decision 208)', async () => {
    let calledUrl = ''
    const result = await falImageGen.generate(
      { prompt: '1995 trading floor', count: 1, model: 'fal-ai/flux/schnell' },
      {
        apiKey: 'key',
        fetchImpl: (async (url: string | URL | Request) => {
          calledUrl = String(url)
          return new Response(
            JSON.stringify({ images: [{ url: 'https://fal.media/files/a.png' }] }),
            { status: 200 },
          )
        }) as typeof fetch,
      },
    )

    expect(calledUrl).toBe('https://fal.run/fal-ai/flux/schnell')
    expect(result.estimatedCostUsd).toBeCloseTo(
      falImageGen.models.find((model) => model.id === 'fal-ai/flux/schnell')!.pricePerImage,
    )
  })

  it('refuses a model it does not list before any call is made', async () => {
    await expect(
      falImageGen.generate(
        { prompt: '1995 trading floor', count: 1, model: 'fal-ai/some-other-thing' },
        {
          apiKey: 'key',
          fetchImpl: (async () => {
            throw new Error('must not be called')
          }) as typeof fetch,
        },
      ),
    ).rejects.toThrow(/modelRouting\.stills/)
  })

  it('verifyKey accepts a 405 (wrong method, valid key) and rejects a 401', async () => {
    await expect(
      falImageGen.verifyKey('good', { fetchImpl: fetchFailing(405) }),
    ).resolves.toBeUndefined()
    await expect(
      falImageGen.verifyKey('bad', { fetchImpl: fetchFailing(401) }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
