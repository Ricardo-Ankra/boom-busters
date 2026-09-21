import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { LOGO_MAX_BYTES, LOGO_RASTER_MAX_EDGE } from '@boom-busters/schemas'
import type { LogoStoredMime } from '@boom-busters/schemas'

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
 * Everything here is byte-level. The type a server announces is a claim, not
 * a fact, so the format is read from the magic bytes, and the dimensions from
 * the image's own header, because a pasted thumbnail is the easiest way to
 * get a worse likeness without noticing.
 *
 * AVIF is the one exception to the no-dependency rule (decision 266). Its
 * header can be read byte by byte like any other, but no image model accepts
 * AVIF. Gemini takes PNG, JPEG, WebP, HEIC and HEIF, Anthropic takes PNG,
 * JPEG, GIF and WebP, so an AVIF cannot be stored and handed on the way the
 * other three can. It is decoded to a JPEG here at the door, and nothing
 * downstream ever learns the format existed.
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

/**
 * The longest edge a converted image keeps.
 *
 * Only conversion is capped, because only conversion re-encodes: a PNG the
 * producer pasted is stored at whatever size it came in. Every image model
 * works at around a thousand pixels, so this is generous, and it is what
 * bounds the JPEG an enormous AVIF turns into, because a 15 MB AVIF holds far
 * more pixels than a 15 MB JPEG ever could.
 */
export const MAX_CONVERTED_IMAGE_EDGE = 3072

/** The three formats a stored image may be, because every model reads all three. */
export type RemoteImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

/** What may arrive. AVIF is accepted but never stored; it is converted first. */
export type SniffedImageMime = RemoteImageMime | 'image/avif'

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
 * AVIF: an ISOBMFF file whose `ftyp` box names `avif` (a still) or `avis` (a
 * sequence) as its major brand or among its compatible ones. The brand list
 * has to be walked rather than only the major brand read, because encoders
 * routinely write `mif1` as the major and leave `avif` in the list.
 */
function isAvif(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') return false
  const declared = bytes.readUInt32BE(0)
  const end = Math.min(bytes.length, declared > 8 ? declared : bytes.length)
  // The major brand sits at 8, the minor version at 12 is a number rather
  // than a brand, and the compatible brands run four bytes each after it.
  for (let at = 8; at + 4 <= end; at += 4) {
    if (at === 12) continue
    const brand = bytes.subarray(at, at + 4).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return true
  }
  return false
}

/**
 * The format, from the first bytes rather than the Content-Type header.
 * Returns null for anything that is not one of the three the image models
 * take as a reference, or an AVIF, which is converted into one of them.
 */
export function sniffImageMime(bytes: Buffer): SniffedImageMime | null {
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
  if (isAvif(bytes)) return 'image/avif'
  return null
}

/**
 * Decode an AVIF and re-encode it as a JPEG, or null when the file cannot be
 * read at all.
 *
 * `sharp` is imported here rather than at the top of the file so that the
 * native module is only ever loaded by a request that actually pasted an
 * AVIF. Chroma subsampling is turned off because these are faces and rooms a
 * model has to match, and 4:2:0 is exactly where a JPEG throws away the
 * colour detail around an eye.
 */
async function convertToJpeg(bytes: Buffer): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import('sharp')
    return await sharp(bytes)
      // Honour an orientation tag rather than storing a sideways reference.
      .rotate()
      .resize({
        width: MAX_CONVERTED_IMAGE_EDGE,
        height: MAX_CONVERTED_IMAGE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toBuffer()
  } catch {
    return null
  }
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

type FetchedBytes = { ok: true; bytes: Buffer; resolvedUrl: string } | { ok: false; error: string }

/** The address checks, the redirect walk, the status handling and the capped read. */
async function fetchImageBytes(
  rawUrl: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
): Promise<FetchedBytes> {
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

  const fetched = await readCapped(response, maxBytes)
  if (!fetched) {
    return {
      ok: false,
      error: `That image is over the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
    }
  }
  if (fetched.length === 0) return { ok: false, error: 'That link returned an empty file.' }

  return { ok: true, bytes: fetched, resolvedUrl: url.toString() }
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

  const got = await fetchImageBytes(rawUrl, fetchImpl, maxBytes)
  if (!got.ok) return got
  const fetched = got.bytes

  const sniffed = sniffImageMime(fetched)
  if (!sniffed) {
    // Overwhelmingly this is a page URL rather than the image on it.
    return {
      ok: false,
      error:
        'That link is not a JPEG, PNG, WebP or AVIF image. Right-click the image itself and copy ' +
        'its image address, not the page address.',
    }
  }

  // An AVIF becomes a JPEG here, and every check below runs on the file that
  // will actually be stored: the size floor measures the pixels the model
  // gets, not the pixels the link advertised.
  const converted = sniffed === 'image/avif' ? await convertToJpeg(fetched) : fetched
  if (!converted) return { ok: false, error: 'That image file is damaged and could not be read.' }
  const bytes = converted
  const mimeType: RemoteImageMime = sniffed === 'image/avif' ? 'image/jpeg' : sniffed

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
    image: {
      bytes,
      mimeType,
      width: size.width,
      height: size.height,
      resolvedUrl: got.resolvedUrl,
    },
  }
}

/**
 * SVG is text, so it has no magic bytes: the file starts, after an optional
 * BOM, whitespace and an XML prologue, with an `<svg` tag. An HTML page that
 * happens to contain an SVG starts with a doctype or `<html`, and is refused.
 */
export function isSvgText(bytes: Buffer): boolean {
  const head = bytes
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
  const afterPrologue = head.startsWith('<?xml')
    ? head.slice(head.indexOf('?>') + 2).trimStart()
    : head
  const afterComments = afterPrologue.replace(/^(<!--[\s\S]*?-->\s*)*/, '')
  return /^<svg[\s>]/i.test(afterComments)
}

export interface RemoteLogo {
  bytes: Buffer
  mimeType: LogoStoredMime
  width: number
  height: number
  resolvedUrl: string
}

export type RemoteLogoResult = { ok: true; logo: RemoteLogo } | { ok: false; error: string }

/**
 * Rasterise a vector or AVIF mark to PNG at the logo edge (decision 268).
 * PNG rather than JPEG because a mark's transparency is the point of it; a
 * vector is drawn AT the edge since upscaling it loses nothing. Null when the
 * file cannot be rendered.
 */
async function rasteriseLogo(
  bytes: Buffer,
  vector: boolean,
): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  try {
    const { default: sharp } = await import('sharp')
    // A high density makes librsvg render the vector at a size the resize
    // then brings down, so edges are anti-aliased at the final size.
    const image = vector ? sharp(bytes, { density: 384 }) : sharp(bytes).rotate()
    const { data, info } = await image
      .resize({
        width: LOGO_RASTER_MAX_EDGE,
        height: LOGO_RASTER_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: !vector,
      })
      .png()
      .toBuffer({ resolveWithObject: true })
    return { bytes: data, width: info.width, height: info.height }
  } catch {
    return null
  }
}

/**
 * Fetch a logo the owner linked to. Marks differ from photographs in three
 * ways: SVG is accepted (and drawn to PNG), AVIF becomes PNG rather than
 * JPEG, and there is no thumbnail floor, because a 64 px favicon-sized mark
 * is still the mark.
 */
export async function fetchRemoteLogo(
  rawUrl: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<RemoteLogoResult> {
  const got = await fetchImageBytes(rawUrl, options.fetchImpl ?? fetch, LOGO_MAX_BYTES)
  if (!got.ok) return got
  const { bytes, resolvedUrl } = got

  if (isSvgText(bytes)) {
    const drawn = await rasteriseLogo(bytes, true)
    if (!drawn)
      return {
        ok: false,
        error: 'That SVG could not be drawn. Export it as a PNG and paste that address.',
      }
    return { ok: true, logo: { ...drawn, mimeType: 'image/png', resolvedUrl } }
  }

  const sniffed = sniffImageMime(bytes)
  if (!sniffed) {
    return {
      ok: false,
      error:
        'That link is not a PNG, SVG, WebP, JPEG or AVIF image. Right-click the mark itself and ' +
        'copy its image address, not the page address.',
    }
  }
  if (sniffed === 'image/avif') {
    const drawn = await rasteriseLogo(bytes, false)
    if (!drawn) return { ok: false, error: 'That image file is damaged and could not be read.' }
    return { ok: true, logo: { ...drawn, mimeType: 'image/png', resolvedUrl } }
  }

  const size = imageDimensions(bytes, sniffed)
  if (!size) return { ok: false, error: 'That image file is damaged and could not be read.' }
  return {
    ok: true,
    logo: { bytes, mimeType: sniffed, width: size.width, height: size.height, resolvedUrl },
  }
}
