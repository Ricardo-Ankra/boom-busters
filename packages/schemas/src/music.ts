import { z } from 'zod'

/**
 * The music library's vocabulary (build spec section 10.1).
 *
 * Music is user-populated only: tracks are downloaded by the human — the
 * YouTube Audio Library has no API — and uploaded through Settings into R2.
 * The app never fetches music from any external source, so licensing stays
 * a human decision, and the licence field is REQUIRED on upload because a
 * bed nobody can prove the right to use is a strike waiting to happen.
 */

export const MUSIC_LICENCES = [
  'yt-audio-library',
  'epidemic',
  'artlist',
  'generated',
  'other',
] as const
export const MusicLicenceSchema = z.enum(MUSIC_LICENCES)
export type MusicLicence = z.infer<typeof MusicLicenceSchema>

/** How each licence reads on the library card. */
export const MUSIC_LICENCE_LABELS: Record<MusicLicence, string> = {
  'yt-audio-library': 'YouTube Audio Library',
  epidemic: 'Epidemic Sound',
  artlist: 'Artlist',
  generated: 'Generated',
  other: 'Other — verify before publishing',
}

/** Upload constraints: beds are single files, minutes long, not albums. */
export const MUSIC_MAX_BYTES = 25 * 1024 * 1024
export const MUSIC_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/ogg',
] as const
