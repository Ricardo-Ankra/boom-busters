import { z } from 'zod'

/**
 * The cast (decision 253): the real people a film shows, with the producer's
 * reference photographs of them.
 *
 * A text prompt cannot reproduce a face the image model never memorised, so
 * a likeness comes from photographs passed with the prompt. The cast is where
 * those photographs live: per project, one entry per person, up to four
 * photos, reused by every still (and later every hero clip) that depicts
 * them. It is its own table rather than part of the Director's Book because
 * the book's card leaves the screen when the plan is approved and the faces
 * are needed for the rest of the film.
 */

export const CAST_PHOTO_VIEWS = ['front', 'three-quarter', 'profile', 'full', 'other'] as const
export const CastPhotoViewSchema = z.enum(CAST_PHOTO_VIEWS)
export type CastPhotoView = z.infer<typeof CastPhotoViewSchema>

export const CAST_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export const CastPhotoMimeSchema = z.enum(CAST_PHOTO_MIME)
export type CastPhotoMime = z.infer<typeof CastPhotoMimeSchema>

/** Two to four help; more than four is noise the model averages into a stranger. */
export const MAX_CAST_PHOTOS = 4

export const CastPhotoSchema = z.object({
  /** boom-busters/cast/<projectId>/<contentHash>.<ext> */
  r2Key: z.string().min(1),
  contentHash: z.string().min(1),
  mimeType: CastPhotoMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  view: CastPhotoViewSchema,
  /** Where the producer found it. Provenance, not a licence: the photo is conditioning input, never output. */
  sourceUrl: z.string().url().optional(),
})
export type CastPhoto = z.infer<typeof CastPhotoSchema>

export const CastMemberSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** Exact full name: the join key `depicts` and the book's principals use. */
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(200),
  /** Written from the photos by a vision call, then edited by hand. Empty until then. */
  identityString: z.string().max(600),
  guardrail: z.string().max(600),
  photos: z.array(CastPhotoSchema).max(MAX_CAST_PHOTOS),
})
export type CastMember = z.infer<typeof CastMemberSchema>

/** The order references are sent: a front view first, then upload order. */
export function referencePhotos(member: Pick<CastMember, 'photos'>, limit = 1): CastPhoto[] {
  const front = member.photos.filter((photo) => photo.view === 'front')
  const rest = member.photos.filter((photo) => photo.view !== 'front')
  return [...front, ...rest].slice(0, Math.max(0, limit))
}

/** The extension a stored photo takes from its MIME type. */
export function castPhotoExtension(mimeType: CastPhotoMime): 'jpg' | 'png' | 'webp' {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp'
}
