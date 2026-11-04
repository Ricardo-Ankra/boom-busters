import sharp from 'sharp'
import type { MsgImage } from '@boom-busters/providers'

/**
 * A reference image as the model is shown it (final review of plan 2, issue
 * 6): a still is stored up to 8 MB and the vision call refuses an image over
 * 5 MB, so anything wider than the model width, or not already a JPEG, is
 * resized to that width and re-encoded. A small JPEG passes through as it is.
 */

export const MODEL_IMAGE_MAX_WIDTH = 1600
const JPEG_QUALITY = 85

export async function imageForModel(object: {
  bytes: Uint8Array
  contentType: string
}): Promise<MsgImage> {
  const input = Buffer.from(object.bytes)
  if (object.contentType === 'image/jpeg') {
    const meta = await sharp(input).metadata()
    if ((meta.width ?? Infinity) <= MODEL_IMAGE_MAX_WIDTH) {
      return { mimeType: 'image/jpeg', data: input.toString('base64') }
    }
  }
  const shrunk = await sharp(input)
    .resize({ width: MODEL_IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
  return { mimeType: 'image/jpeg', data: shrunk.toString('base64') }
}
