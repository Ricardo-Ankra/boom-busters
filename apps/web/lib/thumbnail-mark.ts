import 'server-only'
import sharp from 'sharp'

/**
 * The channel's logo, trimmed to its glyph for the thumbnail. A logo file is
 * often padded with transparent margin, so a mark sized by the file's height
 * shows a glyph well under that. Only the thumbnail trims; the film's
 * watermark keeps the file as it is.
 */

/** A pixel whose alpha is under this, out of 255, counts as empty. */
export const MARK_ALPHA_FLOOR = 8

/**
 * The logo cropped to the bounding box of its visible pixels, as PNG bytes.
 * Null means "use the file as it is": no alpha channel, nothing visible,
 * nothing to trim, or bytes that are not an image. Never throws.
 */
export async function trimmedMark(bytes: Uint8Array): Promise<Buffer | null> {
  try {
    const source = sharp(bytes)
    if (!(await source.metadata()).hasAlpha) return null
    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width, height, channels } = info
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * channels + channels - 1]! < MARK_ALPHA_FLOOR) continue
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
    if (right < 0) return null
    const boxWidth = right - left + 1
    const boxHeight = bottom - top + 1
    if (boxWidth === width && boxHeight === height) return null
    return await sharp(bytes)
      .extract({ left, top, width: boxWidth, height: boxHeight })
      .png()
      .toBuffer()
  } catch {
    return null
  }
}
