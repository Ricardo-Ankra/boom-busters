// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fetching a cast photo by its web address (decision 253 (k)). DNS is stubbed
 * so the address rules can be exercised without the network: by default every
 * name resolves to a public address, and the tests that care about blocking
 * use literal addresses, which never reach the resolver.
 */
const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }))

const {
  fetchRemoteImage,
  imageDimensions,
  sniffImageMime,
  MAX_REMOTE_IMAGE_BYTES,
  MIN_REMOTE_IMAGE_EDGE,
} = await import('./remote-image')

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(16)
  bytes.writeUInt8(0xff, 0)
  bytes.writeUInt8(0xd8, 1)
  bytes.writeUInt8(0xff, 2)
  bytes.writeUInt8(0xc0, 3) // SOF0
  bytes.writeUInt16BE(17, 4) // segment length
  bytes.writeUInt8(8, 6) // sample precision
  bytes.writeUInt16BE(height, 7)
  bytes.writeUInt16BE(width, 9)
  return bytes
}

function webpExtended(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(22, 4)
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8X', 12, 'ascii')
  bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

function webpLossless(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(25)
  bytes.write('RIFF', 0, 'ascii')
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8L', 12, 'ascii')
  bytes.writeUInt8(0x2f, 20)
  bytes.writeUInt32LE((width - 1) | ((height - 1) << 14), 21)
  return bytes
}

function respond(bytes: Buffer, init: ResponseInit = {}): Response {
  return new Response(new Uint8Array(bytes), init)
}

beforeEach(() => {
  vi.clearAllMocks()
  dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})

describe('sniffImageMime', () => {
  it('reads the format from the magic bytes, not anybody’s header', () => {
    expect(sniffImageMime(png(400, 400))).toBe('image/png')
    expect(sniffImageMime(jpeg(400, 400))).toBe('image/jpeg')
    expect(sniffImageMime(webpExtended(400, 400))).toBe('image/webp')
    expect(sniffImageMime(Buffer.from('<!doctype html><html>'))).toBeNull()
    expect(sniffImageMime(Buffer.from('GIF89a'))).toBeNull()
  })
})

describe('imageDimensions', () => {
  it('reads PNG, JPEG and both common WebP flavours', () => {
    expect(imageDimensions(png(1200, 1600), 'image/png')).toEqual({ width: 1200, height: 1600 })
    expect(imageDimensions(jpeg(800, 600), 'image/jpeg')).toEqual({ width: 800, height: 600 })
    expect(imageDimensions(webpExtended(1024, 768), 'image/webp')).toEqual({
      width: 1024,
      height: 768,
    })
    expect(imageDimensions(webpLossless(640, 480), 'image/webp')).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('returns null for a truncated file rather than a made-up size', () => {
    expect(imageDimensions(png(10, 10).subarray(0, 14), 'image/png')).toBeNull()
  })
})

describe('fetchRemoteImage', () => {
  it('fetches an image and reports its real type and size', async () => {
    const bytes = jpeg(1200, 1600)
    const fetchImpl = vi.fn(async () =>
      respond(bytes, { headers: { 'content-type': 'text/html' } }),
    )
    const result = await fetchRemoteImage('https://example.com/emad.jpg', { fetchImpl })

    expect(result).toMatchObject({
      ok: true,
      image: { mimeType: 'image/jpeg', width: 1200, height: 1600 },
    })
    // The lying Content-Type was ignored in favour of the bytes.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses a page address, and says to copy the image address instead', async () => {
    const fetchImpl = vi.fn(async () => respond(Buffer.from('<!doctype html><html>…</html>')))
    const result = await fetchRemoteImage('https://example.com/article', { fetchImpl })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.error).toMatch(/copy its image address/i)
  })

  it('refuses a thumbnail, because a small face makes a worse likeness', async () => {
    const small = MIN_REMOTE_IMAGE_EDGE - 1
    const fetchImpl = vi.fn(async () => respond(png(small, 900)))
    const result = await fetchRemoteImage('https://example.com/thumb.png', { fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/thumbnail/i)
  })

  it('refuses an image over the size cap without buffering it all', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(png(900, 900), {
        headers: { 'content-length': String(MAX_REMOTE_IMAGE_BYTES + 1) },
      }),
    )
    const result = await fetchRemoteImage('https://example.com/huge.png', { fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/15 MB/)
  })

  it('tells the producer to save the file when a site blocks server fetches', async () => {
    const fetchImpl = vi.fn(async () => respond(Buffer.alloc(0), { status: 403 }))
    const result = await fetchRemoteImage('https://agency.example/photo.jpg', { fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/Add photo instead/)
  })

  it.each([
    ['http://127.0.0.1/x', 'loopback'],
    ['http://169.254.169.254/latest/meta-data/', 'the cloud metadata endpoint'],
    ['http://10.1.2.3/x', 'a private range'],
    ['http://192.168.0.5/x', 'a home network'],
    ['http://[::1]/x', 'IPv6 loopback'],
    ['http://localhost:3000/x', 'localhost by name'],
  ])('refuses %s (%s) without fetching anything', async (url) => {
    const fetchImpl = vi.fn()
    const result = await fetchRemoteImage(url, { fetchImpl })
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a public name that resolves into the private network', async () => {
    dns.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    const fetchImpl = vi.fn()
    const result = await fetchRemoteImage('https://nice-name.example/photo.jpg', { fetchImpl })
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks every redirect hop, not just the first', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('start')) {
        return respond(Buffer.alloc(0), {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        })
      }
      return respond(png(900, 900))
    })
    const result = await fetchRemoteImage('https://example.com/start', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    // The first hop was fetched; the redirect target never was.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('follows a redirect to a good image', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('start')
        ? respond(Buffer.alloc(0), {
            status: 301,
            headers: { location: 'https://cdn.example.com/full.png' },
          })
        : respond(png(1000, 1400)),
    )
    const result = await fetchRemoteImage('https://example.com/start', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: true, image: { width: 1000, height: 1400 } })
    expect(result.ok === true && result.image.resolvedUrl).toBe('https://cdn.example.com/full.png')
  })

  it('refuses anything that is not a web address at all', async () => {
    const fetchImpl = vi.fn()
    for (const bad of ['not a url', 'file:///etc/passwd', 'data:image/png;base64,iVBORw0KGgo=']) {
      expect((await fetchRemoteImage(bad, { fetchImpl })).ok).toBe(false)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
