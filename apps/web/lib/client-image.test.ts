// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import {
  fittedSize,
  readImageSize,
  toUploadableImage,
  toUploadableLogo,
  type ImageCodec,
  type SvgRasteriser,
} from './client-image'

/**
 * The browser's decode and encode are the one thing jsdom cannot do, so they
 * are the one thing the codec seam replaces. Everything else in the helper is
 * exercised for real.
 */
interface FakeBitmap {
  width: number
  height: number
  close(): void
}

function codecFor(
  width: number,
  height: number,
): ImageCodec<FakeBitmap> & { encode: ReturnType<typeof vi.fn> } {
  const closed = vi.fn()
  const encode = vi.fn(
    async (_image: FakeBitmap, w: number, h: number, type: string) =>
      // Stand-in bytes; only the size and the type are ever asserted.
      new Blob([new Uint8Array(w * h)], { type }),
  )
  return {
    decode: async () => ({ width, height, close: closed }),
    encode,
  }
}

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

describe('fittedSize', () => {
  it('leaves an image that already fits exactly as it is', () => {
    expect(fittedSize(1200, 800, 3072)).toEqual({ width: 1200, height: 800 })
  })

  it('shrinks on the longest edge and keeps the shape', () => {
    expect(fittedSize(4400, 2200, 3072)).toEqual({ width: 3072, height: 1536 })
    expect(fittedSize(2000, 6000, 3000)).toEqual({ width: 1000, height: 3000 })
  })

  it('never rounds an edge away to nothing', () => {
    expect(fittedSize(10000, 2, 3072)).toEqual({ width: 3072, height: 1 })
  })
})

describe('toUploadableImage', () => {
  it('hands back the very same file when nothing needs converting', async () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']) {
      const original = file('clip', type)
      const result = await toUploadableImage(original, { codec: codecFor(100, 100) })
      expect(result.ok).toBe(true)
      expect(result.ok && result.file).toBe(original)
    }
  })

  it('converts an AVIF to a JPEG, renaming it to match', async () => {
    const codec = codecFor(1200, 800)
    const result = await toUploadableImage(file('the office.avif', 'image/avif'), { codec })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.type).toBe('image/jpeg')
    expect(result.file.name).toBe('the office.jpg')
    expect(codec.encode).toHaveBeenCalledWith(
      expect.anything(),
      1200,
      800,
      'image/jpeg',
      expect.any(Number),
    )
  })

  it('caps a huge AVIF on its longest edge', async () => {
    const codec = codecFor(4400, 2200)
    await toUploadableImage(file('wide.avif', 'image/avif'), { codec })
    expect(codec.encode).toHaveBeenCalledWith(expect.anything(), 3072, 1536, 'image/jpeg', 0.92)
  })

  it('writes PNG when the caller needs transparency kept', async () => {
    const codec = codecFor(600, 600)
    const result = await toUploadableImage(file('logo.avif', 'image/avif'), {
      codec,
      format: 'image/png',
    })

    expect(result.ok && result.file.type).toBe('image/png')
    expect(result.ok && result.file.name).toBe('logo.png')
  })

  it('says what to do when this browser cannot decode the AVIF', async () => {
    const codec: ImageCodec<FakeBitmap> = {
      decode: async () => {
        throw new Error('unsupported')
      },
      encode: async () => null,
    }
    const result = await toUploadableImage(file('office.avif', 'image/avif'), { codec })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/could not read that AVIF/i)
    expect(result.ok === false && result.error).toMatch(/JPEG/)
  })

  it('reports an encoder that produces nothing rather than uploading nothing', async () => {
    const codec: ImageCodec<FakeBitmap> = {
      decode: async () => ({ width: 800, height: 600, close: () => undefined }),
      encode: async () => null,
    }
    const result = await toUploadableImage(file('office.avif', 'image/avif'), { codec })
    expect(result.ok).toBe(false)
  })

  it('closes the bitmap it decoded, whatever happens next', async () => {
    const closed = vi.fn()
    const codec: ImageCodec<FakeBitmap> = {
      decode: async () => ({ width: 800, height: 600, close: closed }),
      encode: async () => null,
    }
    await toUploadableImage(file('office.avif', 'image/avif'), { codec })
    expect(closed).toHaveBeenCalledTimes(1)
  })
})

describe('readImageSize', () => {
  it('reports zero where the environment cannot decode images', async () => {
    // jsdom has no createImageBitmap; the server rounds a zero up to one.
    expect(await readImageSize(file('x.png', 'image/png'))).toEqual({ width: 0, height: 0 })
  })
})

describe('toUploadableLogo', () => {
  const rasterise: SvgRasteriser = async (_file, maxEdge) => ({
    blob: new Blob([new Uint8Array(16)], { type: 'image/png' }),
    width: maxEdge,
    height: Math.round(maxEdge / 3),
  })

  it('hands back a PNG, WebP or JPEG mark unchanged', async () => {
    for (const type of ['image/png', 'image/webp', 'image/jpeg']) {
      const original = file('mark', type)
      const result = await toUploadableLogo(original, { rasterise })
      expect(result.ok && result.file).toBe(original)
    }
  })

  it('rasterises an SVG to a PNG at the logo edge, renamed to match', async () => {
    const result = await toUploadableLogo(file('stability.svg', 'image/svg+xml'), { rasterise })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.type).toBe('image/png')
    expect(result.file.name).toBe('stability.png')
  })

  it('treats a file the browser will not type, with an .svg name, as an SVG', async () => {
    const result = await toUploadableLogo(file('mark.svg', ''), { rasterise })
    expect(result.ok && result.file.type).toBe('image/png')
  })

  it('converts an AVIF mark to PNG, never JPEG, so transparency survives', async () => {
    const codec = codecFor(800, 300)
    const result = await toUploadableLogo(file('mark.avif', 'image/avif'), { codec, rasterise })
    expect(result.ok && result.file.type).toBe('image/png')
    expect(codec.encode).toHaveBeenCalledWith(
      expect.anything(),
      800,
      300,
      'image/png',
      expect.any(Number),
    )
  })

  it('says what to do when the SVG will not draw', async () => {
    const result = await toUploadableLogo(file('broken.svg', 'image/svg+xml'), {
      rasterise: async () => null,
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/could not draw that SVG/i)
  })

  it('treats a file the browser will not type, with a raster extension, as that raster type', async () => {
    const png = await toUploadableLogo(file('mark.png', ''), { rasterise })
    expect(png.ok && png.file.type).toBe('image/png')
    expect(png.ok && png.file.name).toBe('mark.png')

    const jpg = await toUploadableLogo(file('mark.jpg', ''), { rasterise })
    expect(jpg.ok && jpg.file.type).toBe('image/jpeg')

    const jpeg = await toUploadableLogo(file('mark.jpeg', ''), { rasterise })
    expect(jpeg.ok && jpeg.file.type).toBe('image/jpeg')

    const webp = await toUploadableLogo(file('mark.webp', ''), { rasterise })
    expect(webp.ok && webp.file.type).toBe('image/webp')
  })

  it('refuses a format none of the doors take, naming the format in the error', async () => {
    const gif = await toUploadableLogo(file('mark.gif', 'image/gif'), { rasterise })
    expect(gif.ok).toBe(false)
    expect(gif.ok === false && gif.error).toBe(
      'That is a GIF. A mark must be a PNG, WebP, JPEG, SVG or AVIF.',
    )

    // Untyped and unrecognised: named from the extension instead.
    const untyped = await toUploadableLogo(file('mark.bmp', ''), { rasterise })
    expect(untyped.ok).toBe(false)
    expect(untyped.ok === false && untyped.error).toBe(
      'That is a BMP. A mark must be a PNG, WebP, JPEG, SVG or AVIF.',
    )
  })
})
