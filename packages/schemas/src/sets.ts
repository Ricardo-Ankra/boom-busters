import { z } from 'zod'
import { CastPhotoMimeSchema, nameMatches } from './cast'

/**
 * A set (decision 264): a place the film returns to, held as reference
 * photographs so that the same room is the same room in every shot of it.
 *
 * The cast's twin. A text prompt carries a genre of room and never a room,
 * so a film that describes the same boardroom twelve times gets twelve
 * boardrooms; the plates are what make it one. Its own table rather than a
 * field on the Director's Book for the same reason the cast has one: the
 * book's card leaves the screen when the plan is approved, and the rooms
 * are needed for the rest of the film.
 *
 * The book calls these "locations" and seeds them, exactly as its
 * "principals" seed the cast.
 */

export const SET_PLATE_VIEWS = ['establishing', 'detail', 'other'] as const
export const SetPlateViewSchema = z.enum(SET_PLATE_VIEWS)
export type SetPlateView = z.infer<typeof SetPlateViewSchema>

/** Two or three angles pin a room; beyond four the model averages a different one. */
export const MAX_SET_PLATES = 4

export const SetPlateSchema = z.object({
  /** boom-busters/sets/<projectId>/<contentHash>.<ext> */
  r2Key: z.string().min(1),
  contentHash: z.string().min(1),
  mimeType: CastPhotoMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  view: SetPlateViewSchema,
  /**
   * A generated plate is the film's own invention and safe to replace; an
   * uploaded one is evidence the producer chose. The card treats them
   * differently and the ledger only ever paid for the first kind.
   */
  origin: z.enum(['uploaded', 'generated']),
  /** Where an uploaded plate was found. Provenance, not a licence. */
  sourceUrl: z.string().url().optional(),
})
export type SetPlate = z.infer<typeof SetPlateSchema>

export const ProjectSetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** Exact name: the join key a still brief's "set" names. */
  name: z.string().trim().min(1).max(120),
  /** The book's look line, editable. Used to generate a plate and nothing else. */
  look: z.string().max(600),
  plates: z.array(SetPlateSchema).max(MAX_SET_PLATES),
})
export type ProjectSet = z.infer<typeof ProjectSetSchema>

/** The order plates are sent: an establishing view first, then upload order. */
export function referencePlates(set: Pick<ProjectSet, 'plates'>, limit = 1): SetPlate[] {
  const establishing = set.plates.filter((plate) => plate.view === 'establishing')
  const rest = set.plates.filter((plate) => plate.view !== 'establishing')
  return [...establishing, ...rest].slice(0, Math.max(0, limit))
}

/**
 * The set a brief names, or null. THE join between a brief and the set
 * library, on the same matcher the cast join uses, so a planner that writes
 * the room's name with a description after it still lands on the room
 * (decision 262 is what happens when it does not).
 */
export function setForBrief<T extends Pick<ProjectSet, 'name'>>(
  set: string | undefined,
  sets: readonly T[],
): T | null {
  const wanted = (set ?? '').trim()
  if (wanted.length === 0) return null
  return sets.find((candidate) => nameMatches(wanted, candidate.name)) ?? null
}
