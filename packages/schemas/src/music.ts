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

/**
 * The attribution/licence text a bed may carry (decision 207). It is
 * published verbatim in the YouTube description of every video that uses
 * the track, so the cap leaves room for the description's other blocks
 * inside YouTube's 5000-character ceiling — a full Pixabay licence
 * certificate fits; an essay does not.
 */
export const MUSIC_ATTRIBUTION_MAX_CHARS = 3000
export const MUSIC_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/ogg',
] as const
