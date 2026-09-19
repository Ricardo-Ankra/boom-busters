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

/** Lower-cased, trimmed, runs of whitespace collapsed: how two names are compared. */
function normaliseName(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** What may follow the name in a "depicts" entry: a role after a comma, a bracket, a dash. */
const AFTER_NAME = /^\s*[,;:(/.\-\u2013\u2014]/

/**
 * Whether one "depicts" entry names this cast member.
 *
 * The join key is the exact full name, and the shot-list model is asked for
 * exactly that. It does not always comply: the plan of 2026-09-19 wrote
 * "Emad Mostaque, founder and former CEO of Stability AI", the prompt's own
 * "full name and role" phrasing carried into the list, and an exact-string
 * join read every such entry as a stranger. Six cast stills were routed,
 * priced and generated as plain ones, with no reference photograph, while
 * the two whose list held the bare name went to the likeness generator.
 *
 * So an entry names a member when, ignoring case and runs of whitespace, it
 * IS the name, or it begins with the name and goes on with a separator. A
 * name that merely appears inside a longer entry ("an aide to Emad
 * Mostaque") does not depict him, and neither does a longer name that
 * happens to start the same way.
 */
export function depictsName(entry: string, name: string): boolean {
  const wanted = normaliseName(name)
  const given = normaliseName(entry)
  if (wanted.length === 0 || given.length === 0) return false
  if (given === wanted) return true
  return given.startsWith(wanted) && AFTER_NAME.test(given.slice(wanted.length))
}

/**
 * The cast members a brief's "depicts" list names, in cast order, each once.
 * THE join between a brief and the cast: routing, pricing, the photographs
 * sent and the altered-content label all go through it, so none of them can
 * answer differently.
 */
export function depictedMembers<T extends Pick<CastMember, 'name'>>(
  depicts: readonly string[] | undefined,
  cast: readonly T[],
): T[] {
  const entries = (depicts ?? []).filter((entry) => entry.trim().length > 0)
  if (entries.length === 0) return []
  return cast.filter((member) => entries.some((entry) => depictsName(entry, member.name)))
}
