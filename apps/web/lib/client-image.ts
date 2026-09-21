'use client'

import { LOGO_RASTER_MAX_EDGE } from '@boom-busters/schemas'

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

/**
 * Whether a file is this MIME type, or the browser reported no type at all
 * and the name carries one of the given extensions. Some browsers leave
 * `file.type` empty for formats they do not register a handler for, which
 * is common for AVIF and SVG and not unheard of for a plain PNG dragged in
 * from certain sources; the name is the only signal left at that point.
 */
function hasType(file: File, mime: string, extensions: readonly string[]): boolean {
  return (
    file.type === mime ||
    (file.type === '' && extensions.some((ext) => file.name.toLowerCase().endsWith(ext)))
  )
}

/** A file the browser will not admit is an AVIF still has the extension. */
function isAvif(file: File): boolean {
  return hasType(file, 'image/avif', ['.avif'])
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

/**
 * Draw an SVG to a bitmap at `maxEdge` on its long side, or null when the
 * browser will not render it. Behind a type so a test can stand in for it:
 * jsdom has neither an image decoder nor a canvas encoder.
 */
export type SvgRasteriser = (
  file: File,
  maxEdge: number,
) => Promise<{ blob: Blob; width: number; height: number } | null>

export const browserSvgRasteriser: SvgRasteriser = async (file, maxEdge) => {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('svg did not load'))
      element.src = url
    })
    // A vector mark upscales losslessly, so it is drawn AT the long edge, not
    // capped by it. An SVG with no intrinsic size reports the browser's
    // 300 by 150 default; its shape is still the file's own.
    const sourceWidth = image.naturalWidth || 300
    const sourceHeight = image.naturalHeight || 150
    const scale = maxEdge / Math.max(sourceWidth, sourceHeight)
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? { blob, width, height } : null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function isSvg(file: File): boolean {
  return hasType(file, 'image/svg+xml', ['.svg'])
}

/** PNG, JPEG and WebP recognised by extension, for a browser that reports no type. */
const RASTER_TYPES: ReadonlyArray<{
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  extensions: readonly string[]
}> = [
  { mime: 'image/png', extensions: ['.png'] },
  { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  { mime: 'image/webp', extensions: ['.webp'] },
]

/** What a rejected pick is called in the refusal: the type it reported, or its extension. */
function pickedFormatName(file: File): string {
  if (file.type) return (file.type.split('/')[1] ?? file.type).toUpperCase()
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]
  return extension ? extension.toUpperCase() : 'file'
}

/**
 * The file to upload as a logo (decision 268). A raster mark passes through;
 * an SVG is drawn to a PNG at the logo edge; an AVIF is converted to PNG, not
 * JPEG, because a mark's transparency is the point of it. A browser that
 * reported no type at all is trusted by extension for the three raster
 * formats too, not only SVG and AVIF, so an untyped PNG does not fall
 * through to the door's SVG-and-AVIF refusal message. Anything else is
 * refused here, in words, rather than left for the server to name badly.
 */
export async function toUploadableLogo<T extends DecodedImage>(
  file: File,
  options: { codec?: ImageCodec<T>; rasterise?: SvgRasteriser } = {},
): Promise<UploadableImage> {
  if (isSvg(file)) {
    const drawn = await (options.rasterise ?? browserSvgRasteriser)(file, LOGO_RASTER_MAX_EDGE)
    if (!drawn) {
      return {
        ok: false,
        error:
          'This browser could not draw that SVG. Export it as a PNG with a transparent ' +
          'background and add that instead.',
      }
    }
    return {
      ok: true,
      file: new File([drawn.blob], renamed(file.name, 'image/png'), { type: 'image/png' }),
    }
  }
  if (isAvif(file)) {
    return toUploadableImage(file, {
      ...(options.codec ? { codec: options.codec } : {}),
      format: 'image/png',
    })
  }
  for (const raster of RASTER_TYPES) {
    if (hasType(file, raster.mime, raster.extensions)) {
      const typed =
        file.type === raster.mime ? file : new File([file], file.name, { type: raster.mime })
      return { ok: true, file: typed }
    }
  }
  return {
    ok: false,
    error: `That is a ${pickedFormatName(file)}. A mark must be a PNG, WebP, JPEG, SVG or AVIF.`,
  }
}
