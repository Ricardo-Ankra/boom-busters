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

/**
 * Which way a GENERATED plate looks at the room (decision 273). A set with
 * one plate gives every still of it one viewpoint to copy, so a plate can be
 * generated from another angle, conditioned on the plates the set already
 * holds. Only the first plate is generated from the look alone, so only
 * `establishing` is offered before a set has one.
 */
export const SET_PLATE_ANGLES = ['establishing', 'reverse', 'side', 'detail'] as const
export const SetPlateAngleSchema = z.enum(SET_PLATE_ANGLES)
export type SetPlateAngle = z.infer<typeof SetPlateAngleSchema>

/**
 * Which way a plate looks at the room: a generated plate records the angle it
 * was generated from, so every angle is a view (decision 274). `other` is an
 * uploaded plate after a set's first, whose viewpoint nobody stated, and
 * every plate recorded before the angles existed.
 */
export const SET_PLATE_VIEWS = [...SET_PLATE_ANGLES, 'other'] as const
export const SetPlateViewSchema = z.enum(SET_PLATE_VIEWS)
export type SetPlateView = z.infer<typeof SetPlateViewSchema>

/**
 * The view an uploaded plate is recorded as (decision 274). The producer is
 * no longer asked: the view never reached a prompt, and its one effect, which
 * plates travel, is better decided by `referencePlates`. A set's first plate
 * is the room seen whole; anything after it is another angle.
 */
export function uploadedPlateView(set: Pick<ProjectSet, 'plates'>): SetPlateView {
  return set.plates.length === 0 ? 'establishing' : 'other'
}

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

/**
 * How much each view teaches a model about a room it must photograph anew,
 * lowest first. The whole room, then its far side, then across it; a detail
 * shows materials and little of the space.
 */
const VIEW_RANK: Record<SetPlateView, number> = {
  establishing: 0,
  reverse: 1,
  side: 2,
  other: 3,
  detail: 4,
}

/**
 * The plates sent with a still, at most `limit` (decision 274). Only two
 * travel of the four a set may hold, so they are chosen to be two different
 * viewpoints: the best view of each kind first, in `VIEW_RANK` order, and
 * only then a second plate of a kind already sent. Two views of one room
 * teach the model the room; two copies of one view teach it a picture.
 * Upload order breaks ties.
 */
export function referencePlates(set: Pick<ProjectSet, 'plates'>, limit = 1): SetPlate[] {
  const ranked = set.plates
    .map((plate, at) => ({ plate, at }))
    .sort((a, b) => VIEW_RANK[a.plate.view] - VIEW_RANK[b.plate.view] || a.at - b.at)
    .map(({ plate }) => plate)
  const seen = new Set<SetPlateView>()
  const distinct: SetPlate[] = []
  const repeats: SetPlate[] = []
  for (const plate of ranked) {
    if (seen.has(plate.view)) repeats.push(plate)
    else {
      seen.add(plate.view)
      distinct.push(plate)
    }
  }
  return [...distinct, ...repeats].slice(0, Math.max(0, limit))
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
