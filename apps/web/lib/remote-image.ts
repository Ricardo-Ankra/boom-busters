import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Fetching an image the producer found on the web, for the cast (decision
 * 253 (k)).
 *
 * A pasted URL is a convenience on the way in, never the reference itself:
 * the bytes are copied into R2 and the URL is kept only as provenance. Gemini
 * is handed the photo as inline base64 read back from storage, so a remote
 * link could not be used directly even if link rot were acceptable, and it
 * is not: the same face has to regenerate identically weeks later.
 *
 * Everything here is deliberately dependency-free and byte-level. The type a
 * server announces is a claim, not a fact, so the format is read from the
 * magic bytes, and the dimensions from the image's own header, because there
 * is no server-side decoder in this app and a pasted thumbnail is the easiest
 * way to get a worse likeness without noticing.
 */

/** The ceiling a cast photo carries, and the default here. */
export const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024

/**
 * Refuse an image whose shorter edge is under this.
 *
 * Only the URL route enforces it. A file the producer picked off their disk
 * is a deliberate choice, and its dimensions are reported by the browser and
 * may legitimately be zero where the environment cannot decode images, so a
 * floor there would be unenforceable. A pasted URL is different: a search
 * result thumbnail is a couple of hundred pixels and looks identical to the
 * real thing in the address bar.
 */
export const MIN_REMOTE_IMAGE_EDGE = 320

/** Redirect hops followed. Each one is re-checked against the address rules. */
const MAX_REDIRECTS = 4

const FETCH_TIMEOUT_MS = 15_000

export type RemoteImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export interface RemoteImage {
  bytes: Buffer
  mimeType: RemoteImageMime
  width: number
  height: number
  /** The URL the bytes actually came from, after any redirects. */
  resolvedUrl: string
}

export type RemoteImageResult = { ok: true; image: RemoteImage } | { ok: false; error: string }

export interface RemoteImageOptions {
  fetchImpl?: typeof fetch
  /** Defaults to `MAX_REMOTE_IMAGE_BYTES`; callers with their own ceiling pass it. */
  maxBytes?: number
  /** Defaults to `MIN_REMOTE_IMAGE_EDGE`; 0 accepts any size. */
  minEdge?: number
}

/**
 * The format, from the first bytes rather than the Content-Type header.
 * Returns null for anything that is not one of the three the image models
 * take as a reference.
 */
export function sniffImageMime(bytes: Buffer): RemoteImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

/** PNG: width and height are the two big-endian words of the IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/**
 * JPEG: walk the marker segments to the frame header, whose payload carries
 * height then width. Every SOF marker counts except the four that are not
 * frames (DHT, JPG, DAC and the restart markers share the same high range).
 */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    // Padding and standalone markers carry no length word.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }
    const length = bytes.readUInt16BE(offset + 2)
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

/** WebP: three container flavours, each storing the size in its own place. */
function webpSize(bytes: Buffer): { width: number; height: number } | null {
  const format = bytes.subarray(12, 16).toString('ascii')

  // Lossy: the VP8 bitstream's 14-bit dimensions follow the start code.
  if (format === 'VP8 ' && bytes.length >= 30) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    }
  }
  // Lossless: 14 bits each, packed across four bytes, both minus one.
  if (format === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  // Extended: 24-bit canvas size, both minus one.
  if (format === 'VP8X' && bytes.length >= 30) {
    return {
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    }
  }
  return null
}

/** The pixel size from the image's own header, or null when it cannot be read. */
export function imageDimensions(
  bytes: Buffer,
  mimeType: RemoteImageMime,
): { width: number; height: number } | null {
  const size =
    mimeType === 'image/png'
      ? pngSize(bytes)
      : mimeType === 'image/jpeg'
        ? jpegSize(bytes)
        : webpSize(bytes)
  if (!size || size.width <= 0 || size.height <= 0) return null
  return size
}

/**
 * Addresses the server must never be told to fetch.
 *
 * The console has one owner, so this is not holding back an attacker so much
 * as making sure a mistyped or hostile URL cannot turn the deployment into a
 * proxy for its own private network or a cloud metadata endpoint.
 */
function isBlockedAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local, and the metadata endpoint
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    return false
  }
  if (version === 6) {
    const normalised = address.toLowerCase()
    if (normalised === '::1' || normalised === '::') return true
    if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true // unique local
    if (normalised.startsWith('fe80')) return true // link-local
    // An IPv4 address wearing an IPv6 hat.
    const mapped = normalised.split(':').pop()
    if (mapped && isIP(mapped) === 4) return isBlockedAddress(mapped)
    return false
  }
  return false
}

/** The URL is a public http(s) address, resolved rather than trusted by name. */
async function checkAddress(url: URL): Promise<string | null> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'Only http and https image links can be used.'
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    return isBlockedAddress(host) ? 'That address is not reachable from the server.' : null
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return 'That address is not reachable from the server.'
  }
  let resolved: { address: string }[]
  try {
    resolved = await lookup(host, { all: true })
  } catch {
    return 'That address could not be resolved. Check the link.'
  }
  if (resolved.length === 0 || resolved.some((entry) => isBlockedAddress(entry.address))) {
    return 'That address is not reachable from the server.'
  }
  return null
}

/** Read the body with the cap applied as it streams, so a huge file is dropped early. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return null

  const body = response.body
  if (!body) return Buffer.from(await response.arrayBuffer())

  const chunks: Buffer[] = []
  let total = 0
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * Fetch an image the producer linked to, following redirects by hand so that
 * every hop is checked against the address rules rather than only the first.
 */
export async function fetchRemoteImage(
  rawUrl: string,
  options: RemoteImageOptions = {},
): Promise<RemoteImageResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? MAX_REMOTE_IMAGE_BYTES
  const minEdge = options.minEdge ?? MIN_REMOTE_IMAGE_EDGE

  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return { ok: false, error: 'That is not a web address. Copy the image address and paste it.' }
  }

  let response: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const blocked = await checkAddress(url)
    if (blocked) return { ok: false, error: blocked }

    let hopResponse: Response
    try {
      hopResponse = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          // Some hosts answer a bare programmatic request with a block page.
          accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
        },
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      return {
        ok: false,
        error: timedOut
          ? 'That link took too long to answer.'
          : 'That link could not be reached from the server.',
      }
    }

    const location = hopResponse.headers.get('location')
    if (hopResponse.status >= 300 && hopResponse.status < 400 && location) {
      try {
        url = new URL(location, url)
      } catch {
        return { ok: false, error: 'That link redirects somewhere the server cannot follow.' }
      }
      continue
    }
    response = hopResponse
    break
  }

  if (!response) return { ok: false, error: 'That link redirects too many times.' }
  if (!response.ok) {
    // The agencies answer 403 to a server fetch on purpose; say what to do.
    const blocked = response.status === 403 || response.status === 401
    return {
      ok: false,
      error: blocked
        ? 'That site refuses downloads from a server. Save the image and use Add photo instead.'
        : `That link answered ${response.status}. Check it points straight at the image file.`,
    }
  }

  const bytes = await readCapped(response, maxBytes)
  if (!bytes) {
    return {
      ok: false,
      error: `That image is over the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
    }
  }
  if (bytes.length === 0) return { ok: false, error: 'That link returned an empty file.' }

  const mimeType = sniffImageMime(bytes)
  if (!mimeType) {
    // Overwhelmingly this is a page URL rather than the image on it.
    return {
      ok: false,
      error:
        'That link is not a JPEG, PNG or WebP image. Right-click the image itself and copy its ' +
        'image address, not the page address.',
    }
  }

  const size = imageDimensions(bytes, mimeType)
  if (!size) return { ok: false, error: 'That image file is damaged and could not be read.' }
  if (Math.min(size.width, size.height) < minEdge) {
    return {
      ok: false,
      error:
        `That image is only ${size.width}×${size.height}. It is a thumbnail, and a face this ` +
        'small makes a worse likeness. Open the full-size image and copy that address.',
    }
  }

  return {
    ok: true,
    image: { bytes, mimeType, width: size.width, height: size.height, resolvedUrl: url.toString() },
  }
}
