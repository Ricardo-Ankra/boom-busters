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
 * Which way a plate's camera faces (decision 275). A set's first image
 * defines north: whatever it looks at is the north wall, and the others
 * follow clockwise seen from above. Directions, not angle names, because a
 * planner can place a camera by a direction and cannot by "reverse".
 */
export const SET_PLATE_DIRECTIONS = ['north', 'east', 'south', 'west'] as const
export const SetPlateDirectionSchema = z.enum(SET_PLATE_DIRECTIONS)
export type SetPlateDirection = z.infer<typeof SetPlateDirectionSchema>

export const OPPOSITE_DIRECTION: Record<SetPlateDirection, SetPlateDirection> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
}

/** The two directions either side, clockwise first. */
const ADJACENT_DIRECTIONS: Record<
  SetPlateDirection,
  readonly [SetPlateDirection, SetPlateDirection]
> = {
  north: ['east', 'west'],
  east: ['south', 'north'],
  south: ['west', 'east'],
  west: ['north', 'south'],
}

/** What "Generate a view" may ask for: a direction, or a close detail. */
export const SET_VIEW_REQUESTS = [...SET_PLATE_DIRECTIONS, 'detail'] as const
export const SetViewRequestSchema = z.enum(SET_VIEW_REQUESTS)
export type SetViewRequest = z.infer<typeof SetViewRequestSchema>

/**
 * A plate's view: a direction, a close detail, or `other` for an upload whose
 * direction nobody stated. Plates stored under decisions 273 and 274's names
 * are read forward here, so nothing in the database is migrated.
 */
export const SET_PLATE_VIEWS = [...SET_PLATE_DIRECTIONS, 'detail', 'other'] as const
const LEGACY_PLATE_VIEWS: Record<string, (typeof SET_PLATE_VIEWS)[number]> = {
  establishing: 'north',
  reverse: 'south',
  side: 'east',
}
export const SetPlateViewSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value in LEGACY_PLATE_VIEWS ? LEGACY_PLATE_VIEWS[value] : value,
  z.enum(SET_PLATE_VIEWS),
)
export type SetPlateView = z.infer<typeof SetPlateViewSchema>

/**
 * The view an uploaded plate is recorded as (decisions 274, 275): a set's
 * first plate defines north; anything after it is `other` until someone says.
 */
export function uploadedPlateView(set: Pick<ProjectSet, 'plates'>): SetPlateView {
  return set.plates.length === 0 ? 'north' : 'other'
}

/** Four directions and two details (decision 275). At most two travel with a still. */
export const MAX_SET_PLATES = 6

/** The plates one still carries (decision 264): the wall it faces and one beside it. */
export const MAX_SET_REFERENCES = 2

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
  /** The room inventory (decision 275): one line per wall, then Centre and Light. */
  layout: z.string().max(1500).default(''),
  plates: z.array(SetPlateSchema).max(MAX_SET_PLATES),
})
export type ProjectSet = z.infer<typeof ProjectSetSchema>

/**
 * A set's room inventory, read line by line (decision 275). Six labels are
 * known: the four walls, the centre, the light. Anything else is kept whole
 * as `rest`, so an owner who writes prose loses nothing.
 */
export interface RoomLayout {
  north?: string
  east?: string
  south?: string
  west?: string
  centre?: string
  light?: string
  rest: string
}

const LAYOUT_LINE =
  /^\s*(north|east|south|west|centre|center|light)(?:\s+wall)?\s*:\s*(.+?)\s*\.?\s*$/i

export function parseLayout(text: string): RoomLayout {
  const layout: RoomLayout = { rest: '' }
  const rest: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const match = LAYOUT_LINE.exec(line)
    if (!match) {
      rest.push(line.trim())
      continue
    }
    const label = match[1]!.toLowerCase()
    const key = (label === 'center' ? 'centre' : label) as Exclude<keyof RoomLayout, 'rest'>
    layout[key] = match[2]!
  }
  layout.rest = rest.join(' ')
  return layout
}

export interface LayoutView {
  inFrame?: string
  /**
   * The side walls by the side of the frame they stand on (live run 10,
   * 2026-09-25): an unordered pair let the model mirror the room, windows on
   * the wrong side, because nothing said which wall was which side.
   */
  left?: string
  right?: string
  behind?: string
  centre?: string
  light?: string
  rest: string
}

/** What a camera facing `facing` sees of the room, and what is behind it. */
export function layoutView(layout: RoomLayout, facing: SetPlateDirection): LayoutView {
  const view: LayoutView = { rest: layout.rest }
  if (layout[facing] !== undefined) view.inFrame = layout[facing]
  // Clockwise is to the camera's right.
  const [rightOf, leftOf] = ADJACENT_DIRECTIONS[facing]
  if (layout[leftOf] !== undefined) view.left = layout[leftOf]
  if (layout[rightOf] !== undefined) view.right = layout[rightOf]
  const behind = layout[OPPOSITE_DIRECTION[facing]]
  if (behind !== undefined) view.behind = behind
  if (layout.centre !== undefined) view.centre = layout.centre
  if (layout.light !== undefined) view.light = layout.light
  return view
}

/**
 * How much each view teaches a model about a room it must photograph anew,
 * lowest first. The whole room, then its far side, then across it; a detail
 * shows materials and little of the space.
 */
const VIEW_RANK: Record<SetPlateView, number> = {
  north: 0,
  south: 1,
  east: 2,
  west: 3,
  other: 4,
  detail: 5,
}

/** The best plate of each view first, in `order`, then second plates of a view already taken. */
function distinctFirst(plates: readonly SetPlate[], limit: number): SetPlate[] {
  const seen = new Set<SetPlateView>()
  const distinct: SetPlate[] = []
  const repeats: SetPlate[] = []
  for (const plate of plates) {
    if (seen.has(plate.view)) repeats.push(plate)
    else {
      seen.add(plate.view)
      distinct.push(plate)
    }
  }
  return [...distinct, ...repeats].slice(0, Math.max(0, limit))
}

/**
 * The plates sent with a still that has no camera, at most `limit`
 * (decision 274, directions from 275): two different viewpoints before a
 * second copy of one. Upload order breaks ties.
 */
export function referencePlates(set: Pick<ProjectSet, 'plates'>, limit = 1): SetPlate[] {
  const ranked = set.plates
    .map((plate, at) => ({ plate, at }))
    .sort((a, b) => VIEW_RANK[a.plate.view] - VIEW_RANK[b.plate.view] || a.at - b.at)
    .map(({ plate }) => plate)
  return distinctFirst(ranked, limit)
}

/**
 * The plates sent with a still whose camera faces `facing` (decision 275):
 * the plate facing the same way, then the adjacent directions, then details,
 * then undirected uploads. Never the opposite direction's plate, which shows
 * what is behind the camera, unless it is all the set holds: a set with one
 * plate sends it whatever the camera faces, and the inventory carries the rest.
 */
export function platesForCamera(
  set: Pick<ProjectSet, 'plates'>,
  facing: SetPlateDirection | undefined,
  limit: number,
): SetPlate[] {
  if (facing === undefined) return referencePlates(set, limit)
  const order: SetPlateView[] = [facing, ...ADJACENT_DIRECTIONS[facing], 'detail', 'other']
  const ordered = order.flatMap((view) => set.plates.filter((plate) => plate.view === view))
  const chosen = distinctFirst(ordered, limit)
  return chosen.length > 0 ? chosen : referencePlates(set, limit)
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
