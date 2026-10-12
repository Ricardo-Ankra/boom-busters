import { z } from 'zod'
import { nameMatches } from './cast'

/**
 * The logo library (decision 268): real marks the owner uploaded, composited
 * on the brand grade, never generated. Marks are `assets` rows of kind
 * `logo`, channel-wide, titled with the entity's name as the dossier writes
 * it, and matched by that name the way a still's "depicts" is matched to the
 * cast.
 *
 * Stored bytes are always raster. SVG and AVIF are accepted at the door and
 * converted to PNG before storage: the render's Chromium draws what is
 * stored, so a stored SVG would be a script the render executes, and no
 * image model or renderer needs vector marks at the sizes a film shows them.
 */

export const LOGO_STORED_MIME = ['image/png', 'image/webp', 'image/jpeg'] as const
export const LogoStoredMimeSchema = z.enum(LOGO_STORED_MIME)
export type LogoStoredMime = z.infer<typeof LogoStoredMimeSchema>

/** The extension a stored mark takes from its MIME type. */
export function logoExtension(mimeType: LogoStoredMime): 'png' | 'webp' | 'jpg' {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
}

/** Marks are small; a 4 MB PNG is already a poster. */
export const LOGO_MAX_BYTES = 4 * 1024 * 1024

/** A vector mark is rasterised at this long edge: crisp at 1080p, small on disk. */
export const LOGO_RASTER_MAX_EDGE = 2048

/** What the file picker offers, by type and by extension for browsers that report neither. */
export const LOGO_ACCEPT =
  'image/png,image/webp,image/jpeg,image/svg+xml,image/avif,.png,.webp,.jpg,.jpeg,.svg,.avif'

/**
 * What a resolver needs to know about a mark: its id, the name it answers to
 * and the size it was stored at, null when none was recorded (both columns
 * are nullable). A design written as code is handed only the marks with a
 * size (decision 295, ruling 25): the render cannot place a mark it cannot
 * size, so the dry run never shows the code one.
 */
export interface LogoIndex {
  id: string
  title: string
  width: number | null
  height: number | null
}

/**
 * The mark an entity name refers to, or null. The join between a graphic's
 * "logo" element and the library (Plan B), through the cast's tolerant
 * matcher, tried in both directions: the exact name, or either side
 * followed by a role or suffix, never a bare substring. The reverse
 * direction matters because the query can carry the role ("Wirecard AG, the
 * payments processor" against a title of "Wirecard AG") or the stored title
 * can ("Wirecard AG (Germany)" against a query of "Wirecard AG").
 */
export function logoForEntity<T extends LogoIndex>(entity: string, logos: readonly T[]): T | null {
  return (
    logos.find((logo) => nameMatches(entity, logo.title) || nameMatches(logo.title, entity)) ?? null
  )
}

/**
 * The marks a design written as code is handed (decision 295; rulings 5 and
 * 25), keyed by title: the one rule the dry run, the assembly and the board
 * share. A mark with no title cannot be named and one with no recorded size
 * cannot be placed, so both are left out, and the first mark stored under a
 * title wins, in the order given. Each row comes back whole, its size narrowed
 * to numbers.
 */
export function codeLogoLibrary<
  T extends { id: string; title: string | null; width?: number | null; height?: number | null },
>(rows: readonly T[]): Map<string, T & { width: number; height: number }> {
  const library = new Map<string, T & { width: number; height: number }>()
  for (const row of rows) {
    const title = row.title ?? ''
    if (title.trim() === '' || library.has(title) || !row.width || !row.height) continue
    library.set(title, { ...row, width: row.width, height: row.height })
  }
  return library
}
