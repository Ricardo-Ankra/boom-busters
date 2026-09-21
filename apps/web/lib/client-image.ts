'use client'

/**
 * Preparing a picked image in the browser, before it is uploaded
 * (decision 266).
 *
 * Every picker in the console hashes the file and PUTs it straight to R2 on
 * a presigned URL (decision 205), so the server never sees these bytes and
 * cannot convert anything. That is fine for JPEG, PNG and WebP, which every
 * image model reads, and impossible for AVIF, which none of them do: Gemini
 * takes PNG, JPEG, WebP, HEIC and HEIF, Anthropic takes PNG, JPEG, GIF and
 * WebP. An AVIF cast photo would sit in storage looking healthy and fail at
 * the moment a still is generated, which is the moment money is spent.
 *
 * So an AVIF is converted here, before the hash: what gets fingerprinted,
 * uploaded and recorded is the JPEG. Nothing downstream learns the format
 * existed, and the stored MIME stays one of the three it has always been.
 */

/** Matches the server's cap for a pasted image, `MAX_CONVERTED_IMAGE_EDGE`. */
export const MAX_CONVERTED_IMAGE_EDGE = 3072

/** High enough that a face survives it; 4:2:0 loss is the browser's own. */
export const CONVERTED_JPEG_QUALITY = 0.92

/**
 * What a conversion may write. JPEG for a photograph, which is every door
 * today; PNG for the one to come, where an uploaded logo has to keep its
 * transparency.
 */
export type ConvertedFormat = 'image/jpeg' | 'image/png'

const EXTENSIONS: Record<ConvertedFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/** The part of an `ImageBitmap` this module uses, so a test can stand in for one. */
export interface DecodedImage {
  width: number
  height: number
  close(): void
}

/**
 * The browser's decode and encode, behind an interface. They are the only
 * two things here that jsdom cannot run, so they are the only two things a
 * test replaces.
 */
export interface ImageCodec<T extends DecodedImage> {
  decode(file: File): Promise<T>
  encode(
    image: T,
    width: number,
    height: number,
    type: ConvertedFormat,
    quality: number,
  ): Promise<Blob | null>
}

export const browserCodec: ImageCodec<ImageBitmap> = {
  decode: (file) => createImageBitmap(file),
  encode: (image, width, height, type, quality) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return Promise.resolve(null)
    context.drawImage(image, 0, 0, width, height)
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
  },
}

/** The size an image takes once its longest edge is held to `maxEdge`. */
export function fittedSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  // A panorama's short edge can round to nothing; one pixel is the floor.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export type UploadableImage = { ok: true; file: File } | { ok: false; error: string }

/** A file the browser will not admit is an AVIF still has the extension. */
function isAvif(file: File): boolean {
  return file.type === 'image/avif' || (file.type === '' && /\.avif$/i.test(file.name))
}

function renamed(name: string, format: ConvertedFormat): string {
  const stem = name.replace(/\.[^.]+$/, '') || 'image'
  return `${stem}.${EXTENSIONS[format]}`
}

/**
 * The file to upload: the one that was picked, unless it is an AVIF, in
 * which case a converted copy of it. Anything that is not an image at all
 * (the board's archival video) passes straight through.
 */
export async function toUploadableImage<T extends DecodedImage>(
  file: File,
  options: { codec?: ImageCodec<T>; format?: ConvertedFormat } = {},
): Promise<UploadableImage> {
  if (!isAvif(file)) return { ok: true, file }

  const codec = (options.codec ?? browserCodec) as ImageCodec<T>
  const format = options.format ?? 'image/jpeg'

  let decoded: T
  try {
    decoded = await codec.decode(file)
  } catch {
    return {
      ok: false,
      error:
        'This browser could not read that AVIF. Open it and save it as a JPEG, then add that ' +
        'instead.',
    }
  }

  let blob: Blob | null
  try {
    const size = fittedSize(decoded.width, decoded.height, MAX_CONVERTED_IMAGE_EDGE)
    blob = await codec.encode(decoded, size.width, size.height, format, CONVERTED_JPEG_QUALITY)
  } finally {
    decoded.close()
  }

  if (!blob) {
    return { ok: false, error: 'That AVIF could not be converted. Save it as a JPEG and add that.' }
  }
  return { ok: true, file: new File([blob], renamed(file.name, format), { type: format }) }
}

/**
 * Dimensions read in the browser with createImageBitmap; zero where the
 * environment cannot decode images (jsdom in tests), and the server rounds
 * zero up to one. No object URLs and no Image element: in jsdom those never
 * fire load or error, and the upload sat waiting on them.
 */
export async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== 'function') return { width: 0, height: 0 }
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return { width: 0, height: 0 }
  }
}
