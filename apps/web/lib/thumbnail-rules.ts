/**
 * What a thumbnail has to be, per target type (decision 251).
 *
 * YouTube documents two different shapes, and the console enforced only the
 * first: a long-form thumbnail is 16:9 with a minimum WIDTH of 640px, and a
 * Short's is 9:16 with a minimum HEIGHT of 640px. Decision 232 extended the
 * dropzone to Shorts and inherited the master's 1280x720 rule, so the normal
 * Canva Shorts export (1080x1920) was refused for being 1080 wide. Worse than
 * refusing a good file: YouTube replaces a 16:9 thumbnail on a vertical video
 * with an auto-generated 4:5 crop on some surfaces, so the old rule steered
 * the owner toward an asset that would partly be discarded.
 *
 * The floors here are the app's, not YouTube's: a quarter of the recommended
 * resolution in each orientation, which is the same posture the master rule
 * always had. The messages say so rather than putting the app's opinion in
 * YouTube's mouth. Because each type's floor names both dimensions, the pair
 * also rejects the wrong ORIENTATION without a separate ratio check: a
 * landscape PNG fails a Short's height, a portrait one fails a master's width.
 *
 * This module holds no 'use server' directive on purpose. `publish-actions.ts`
 * may only export async functions, which is why these limits used to live as
 * duplicated literals on both sides of the wire.
 */

/** The Data API caps `thumbnails.set` at 2 MB, whatever Studio's web uploader allows. */
export const THUMB_MAX_BYTES = 2 * 1024 * 1024

/** Test & Compare takes three variants. */
export const THUMB_LIMIT = 3

export type ThumbnailTarget = 'master' | 'short'

export interface ThumbnailRule {
  /** The app's floor, not YouTube's (whose minimum is 640 on one side). */
  minWidth: number
  minHeight: number
  /** What to export, in the copy the dropzone shows. */
  recommended: string
  shape: '16:9' | '9:16'
}

export const THUMBNAIL_RULES: Record<ThumbnailTarget, ThumbnailRule> = {
  master: { minWidth: 1280, minHeight: 720, recommended: '1280×720', shape: '16:9' },
  // 720x1280 is the master floor stood on its end; 1080x1920 is what Canva's
  // Shorts preset exports, and it clears this comfortably.
  short: { minWidth: 720, minHeight: 1280, recommended: '1080×1920', shape: '9:16' },
}

export function thumbnailRule(target: ThumbnailTarget): ThumbnailRule {
  return THUMBNAIL_RULES[target]
}

/**
 * The refusal, or null when the PNG is fine. One function so the dropzone and
 * the server action refuse in the same words: the client check is a courtesy
 * (and is skipped where `createImageBitmap` is missing), the server's is law.
 */
export function thumbnailDimensionError(
  target: ThumbnailTarget,
  dimensions: { width: number; height: number },
): string | null {
  const rule = thumbnailRule(target)
  if (dimensions.width >= rule.minWidth && dimensions.height >= rule.minHeight) return null

  const subject = target === 'master' ? 'A master’s thumbnail' : 'A Short’s thumbnail'
  return (
    `That PNG is ${dimensions.width}×${dimensions.height}. ${subject} is ${rule.shape}: ` +
    `at least ${rule.minWidth}×${rule.minHeight}, ideally ${rule.recommended}.`
  )
}

/** The line above the dropzone. Says the shape first, because that is what a
 *  Canva export gets wrong. */
export function thumbnailHint(target: ThumbnailTarget): string {
  const rule = thumbnailRule(target)
  const spec = `${rule.shape}, ${rule.recommended} ideal, up to ${THUMB_LIMIT} PNGs, 2 MB max.`

  return target === 'master'
    ? `Thumbnail: export from Canva. ${spec} Masters need one before upload.`
    : `Thumbnail: optional for a Short. The feed plays the video itself, but search and ` +
        `channel pages show it. Vertical ${spec}`
}
