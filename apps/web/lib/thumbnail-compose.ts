import 'server-only'
import { THUMB_HEIGHT, THUMB_JPEG_QUALITY, THUMB_WIDTH } from '@boom-busters/schemas'
import { screenshotFrame } from './graphic-code/frames'
import {
  headlineFontPx,
  scrimContrast,
  thumbnailDocument,
  thumbnailWarnings,
} from './thumbnail-document'

/**
 * Sets the headline and the channel's mark on the painted picture, in the
 * browser the designer's frames already use, and says what looks wrong.
 */
export async function composeThumbnail(
  input: Parameters<typeof thumbnailDocument>[0],
): Promise<{ jpeg: Buffer; warnings: string[] }> {
  const { jpeg, boxes } = await screenshotFrame({
    html: thumbnailDocument(input),
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    quality: THUMB_JPEG_QUALITY,
  })
  // The headline is the first text in the page; the wordmark, when there is
  // one, comes after it and is not the headline's to answer for.
  const headlineNode = boxes[0]?.node
  const headlineBoxes = boxes.filter((box) => box.node === headlineNode)
  const warnings = thumbnailWarnings({
    headline: input.headline,
    fontPx: headlineFontPx(input.headline),
    boxes: headlineBoxes,
    contrast: scrimContrast(input.brand.colors.textPrimary, input.brand.colors.background),
  })
  return { jpeg, warnings }
}
