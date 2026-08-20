import type { SlotCandidate } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  putObject: vi.fn(async (key: string) => ({ key })),
}))
const dbHelpers = vi.hoisted(() => ({
  setSlotResolution: vi.fn(async () => undefined),
  upsertAssetByHash: vi.fn(async (_db: unknown, input: { r2Key: string }) => ({
    id: '01HQ00000000000000000ASSET',
    r2Key: input.r2Key,
  })),
  visualCredentials: vi.fn(async () => ({ pixabay: 'pixa-key' })),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/env', () => ({ env: { SECRETS_ENCRYPTION_KEY: 'k'.repeat(64) } }))
vi.mock('@/lib/storage', () => ({
  putObject: storage.putObject,
  stockKey: (input: { contentHash: string; ext: string }) =>
    `boom-busters/stock/${input.contentHash}.${input.ext}`,
}))
vi.mock('@boom-busters/db', () => dbHelpers)

import {
  downloadStock,
  downloadStockPreview,
  ingestSlotStock,
  needsStockIngest,
  stockExtension,
} from './stock-ingest'

function candidate(overrides: Partial<SlotCandidate> = {}): SlotCandidate {
  return {
    id: '2557396',
    provider: 'pixabay',
    kind: 'image',
    sourceUrl: 'https://pixabay.com/get/expired_1280.jpg',
    pageUrl: 'https://pixabay.com/photos/office-2557396/',
    licence: 'Pixabay Content License',
    chosen: true,
    ...overrides,
  }
}

function slotWith(chosen: SlotCandidate) {
  return {
    id: 'slot-1',
    type: 'stock',
    status: 'resolved',
    candidates: [chosen as unknown as Record<string, unknown>],
  }
}

const JPEG = Buffer.from('jpeg-bytes')

function fetchRouting(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    const match = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
    if (!match) throw new Error(`unrouted fetch: ${url}`)
    return match[1]()
  }) as typeof fetch
}

const ok = (body: Buffer | string, contentType: string) => () =>
  new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    status: 200,
    headers: { 'Content-Type': contentType },
  })
const gone = () => new Response('', { status: 400 })

describe('needsStockIngest', () => {
  it('wants resolved media slots whose chosen candidate has no bytes yet', () => {
    expect(needsStockIngest(slotWith(candidate()))).toBe(true)
  })

  it('leaves alone: charts, unresolved slots, ingested and mock candidates', () => {
    expect(needsStockIngest({ ...slotWith(candidate()), type: 'chart' })).toBe(false)
    expect(needsStockIngest({ ...slotWith(candidate()), status: 'placeholder' })).toBe(false)
    expect(needsStockIngest(slotWith(candidate({ r2Key: 'boom-busters/stock/abc.jpg' })))).toBe(
      false,
    )
    expect(needsStockIngest(slotWith(candidate({ sourceUrl: 'mock://pexels/office/1' })))).toBe(
      false,
    )
  })

  it('re-visits an ingested VIDEO that still lacks its preview proxy', () => {
    expect(
      needsStockIngest(slotWith(candidate({ kind: 'video', r2Key: 'boom-busters/stock/abc.mp4' }))),
    ).toBe(true)
    expect(
      needsStockIngest(
        slotWith(
          candidate({
            kind: 'video',
            r2Key: 'boom-busters/stock/abc.mp4',
            previewR2Key: 'boom-busters/stock/small.mp4',
          }),
        ),
      ),
    ).toBe(false)
  })
})

describe('downloadStockPreview', () => {
  it('fetches the stored preview variant when it still answers', async () => {
    const result = await downloadStockPreview(
      candidate({ kind: 'video', previewSourceUrl: 'https://cdn.pixabay.com/video/small.mp4' }),
      {
        keys: {},
        fetchImpl: fetchRouting({
          'https://cdn.pixabay.com/video/small.mp4': ok(JPEG, 'video/mp4'),
        }),
      },
    )
    expect(result?.url).toBe('https://cdn.pixabay.com/video/small.mp4')
  })

  it('mints a fresh preview by id when nothing stored answers', async () => {
    const result = await downloadStockPreview(
      candidate({ kind: 'video' }), // no previewSourceUrl stored (pre-proxy candidate)
      {
        keys: { pixabay: 'pixa-key' },
        fetchImpl: fetchRouting({
          'https://pixabay.com/api/videos/?key=pixa-key&id=2557396': ok(
            JSON.stringify({
              hits: [
                {
                  id: 2557396,
                  pageURL: 'https://pixabay.com/videos/office-2557396/',
                  duration: 16,
                  videos: {
                    large: {
                      url: 'https://cdn.pixabay.com/video/large.mp4',
                      width: 1920,
                      height: 1080,
                    },
                    medium: {
                      url: 'https://cdn.pixabay.com/video/medium.mp4',
                      width: 1280,
                      height: 720,
                    },
                    small: null,
                    tiny: null,
                  },
                },
              ],
            }),
            'application/json',
          ),
          'https://cdn.pixabay.com/video/medium.mp4': ok(JPEG, 'video/mp4'),
        }),
      },
    )
    expect(result?.url).toBe('https://cdn.pixabay.com/video/medium.mp4')
  })

  it('answers null, never a throw, when no preview can be had', async () => {
    const result = await downloadStockPreview(candidate({ kind: 'video' }), {
      keys: {},
      fetchImpl: fetchRouting({ 'https://': gone }),
    })
    expect(result).toBeNull()
  })
})

describe('stockExtension', () => {
  it('prefers the content type, falls back to the URL, then bin', () => {
    expect(stockExtension('image/jpeg', 'https://x.example/a')).toBe('jpg')
    expect(stockExtension('video/mp4; charset=binary', 'https://x.example/a')).toBe('mp4')
    expect(stockExtension('application/octet-stream', 'https://x.example/clip.MP4?sig=1')).toBe(
      'mp4',
    )
    expect(stockExtension(null, 'https://x.example/mystery')).toBe('bin')
  })
})

describe('downloadStock', () => {
  it('uses the stored URL while it still answers', async () => {
    const result = await downloadStock(candidate(), {
      keys: {},
      fetchImpl: fetchRouting({ 'https://pixabay.com/get/expired': ok(JPEG, 'image/jpeg') }),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bytes.equals(JPEG)).toBe(true)
  })

  it('mints a fresh URL by id when the stored one has expired', async () => {
    const result = await downloadStock(candidate(), {
      keys: { pixabay: 'pixa-key' },
      fetchImpl: fetchRouting({
        'https://pixabay.com/get/expired': gone,
        'https://pixabay.com/api/?key=pixa-key&id=2557396': ok(
          JSON.stringify({
            hits: [
              {
                id: 2557396,
                pageURL: 'https://pixabay.com/photos/office-2557396/',
                previewURL: 'https://cdn.pixabay.com/photo/office_150.jpg',
                webformatURL: 'https://cdn.pixabay.com/photo/office_640.jpg',
                largeImageURL: 'https://pixabay.com/get/fresh_1280.jpg',
                imageWidth: 4752,
                imageHeight: 3168,
              },
            ],
          }),
          'application/json',
        ),
        'https://pixabay.com/get/fresh': ok(JPEG, 'image/jpeg'),
      }),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://pixabay.com/get/fresh_1280.jpg')
  })

  it('names the missing key when a dead URL cannot be re-minted', async () => {
    const result = await downloadStock(candidate(), {
      keys: {},
      fetchImpl: fetchRouting({ 'https://pixabay.com/get/expired': gone }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('Settings → Connections')
  })

  it('reports an asset the provider deleted, not a mystery failure', async () => {
    const result = await downloadStock(candidate(), {
      keys: { pixabay: 'pixa-key' },
      fetchImpl: fetchRouting({
        'https://pixabay.com/get/expired': gone,
        'https://pixabay.com/api/?key=pixa-key&id=2557396': gone,
      }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('no longer offers this asset')
  })
})

describe('ingestSlotStock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbHelpers.visualCredentials.mockResolvedValue({ pixabay: 'pixa-key' })
    vi.stubGlobal(
      'fetch',
      fetchRouting({ 'https://pixabay.com/get/expired': ok(JPEG, 'image/jpeg') }),
    )
    return () => vi.unstubAllGlobals()
  })

  it('stores the bytes content-hash keyed and writes the key into the candidate', async () => {
    const slot = slotWith(candidate())
    const outcome = await ingestSlotStock(slot)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.r2Key).toMatch(/^boom-busters\/stock\/[0-9a-f]{64}\.jpg$/)

    expect(storage.putObject).toHaveBeenCalledWith(outcome.r2Key, expect.anything(), 'image/jpeg')
    expect(dbHelpers.upsertAssetByHash).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'image',
        r2Key: outcome.r2Key,
        // Provenance survives: the page URL, never the signed download URL.
        sourceUrl: 'https://pixabay.com/photos/office-2557396/',
        licence: 'Pixabay Content License',
      }),
    )

    const [, slotId, resolution] = dbHelpers.setSlotResolution.mock.calls[0] as unknown as [
      unknown,
      string,
      { candidates: Record<string, unknown>[]; chosenAssetId: string },
    ]
    expect(slotId).toBe('slot-1')
    expect(resolution.chosenAssetId).toBe('01HQ00000000000000000ASSET')
    expect(resolution.candidates[0]).toMatchObject({ r2Key: outcome.r2Key })
  })

  it('stores the preview proxy beside a video and writes both keys back', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouting({
        'https://pixabay.com/get/expired': ok(JPEG, 'video/mp4'),
        'https://cdn.pixabay.com/video/small.mp4': ok('small-bytes', 'video/mp4'),
      }),
    )
    const slot = slotWith(
      candidate({
        kind: 'video',
        previewSourceUrl: 'https://cdn.pixabay.com/video/small.mp4',
      }),
    )
    const outcome = await ingestSlotStock(slot)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.previewR2Key).toMatch(/^boom-busters\/stock\/[0-9a-f]{64}\.mp4$/)
    expect(outcome.previewR2Key).not.toBe(outcome.r2Key)

    const [, , resolution] = dbHelpers.setSlotResolution.mock.calls[0] as unknown as [
      unknown,
      string,
      { candidates: Record<string, unknown>[] },
    ]
    expect(resolution.candidates[0]).toMatchObject({
      r2Key: outcome.r2Key,
      previewR2Key: outcome.previewR2Key,
    })
  })

  it('answers a failure reason, not a throw, when the bytes are unreachable', async () => {
    vi.stubGlobal('fetch', fetchRouting({ 'https://pixabay.com/': gone }))
    const outcome = await ingestSlotStock(slotWith(candidate()))
    expect(outcome.ok).toBe(false)
    expect(storage.putObject).not.toHaveBeenCalled()
  })
})
