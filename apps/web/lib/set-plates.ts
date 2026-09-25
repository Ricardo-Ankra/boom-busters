import { HOUSE_PHOTOGRAPH } from '@boom-busters/providers'
import { layoutView, OPPOSITE_DIRECTION, parseLayout } from '@boom-busters/schemas'
import type {
  ProjectSet,
  SetCamera,
  SetPlateDirection,
  SetViewRequest,
  ShotSize,
  StillBrief,
} from '@boom-busters/schemas'

/**
 * The brief a generated set plate is drawn from (decision 264, amended 273,
 * 275).
 *
 * Its own module because both the Set card's action and the project page's
 * estimate build it, and a 'use server' file may export only async functions.
 *
 * A set's first plate comes from the look alone. Every later one is another
 * view of the same room, so the brief names the set and the plates the set
 * already holds travel with it: `generateStillCandidates` attaches them and
 * closes the prompt telling the model to photograph the room anew from the
 * framing below, never to copy the plates' own. That is how a set comes to
 * hold more than one viewpoint, and why stills of it stop repeating one.
 */

/** The first plate: the room seen whole, before any direction exists. */
const FIRST_PLATE_FRAMING =
  'a wide establishing photograph of the whole room, taken from its entrance at eye level with a 24mm lens'

const VIEW_FRAMING: Record<SetViewRequest, string> = {
  north: 'a wide photograph of the whole room facing north',
  east: 'a wide photograph of the whole room facing east',
  south: 'a wide photograph of the whole room facing south',
  west: 'a wide photograph of the whole room facing west',
  detail:
    "a close photograph of one part of the room, its furniture, surfaces and materials at arm's length with a 50mm lens",
}

/*
 * Every plate names its own lens (decision 275 final review): the house line
 * carries none. The first plate and a detail say it in the framing above; a
 * compass view of a plated set says it in its camera sentence (24mm), which
 * `generateStillCandidates` appends through `describeCamera`.
 */

/**
 * The contact sheet's prompt (decision 275): the grid first, then each
 * panel's direction, then the room. Four panels labelled by direction cannot
 * all copy the reference, and one pass resolves the whole room, so the walls
 * the reference never showed agree with each other.
 */
export function buildSetSheetPrompt(input: {
  name: string
  layout: string
  look: string
  styleAnchors: string
}): string {
  // Each panel names the wall it looks at (live run 1, 2026-09-24): with
  // directions alone the east panel repeated the north wall. A wall said in
  // its panel is not said again in the room line.
  const layout = parseLayout(input.layout)
  const labelled = [layout.north, layout.east, layout.south, layout.west].some(
    (line) => line !== undefined,
  )
  const looking = (direction: 'north' | 'east' | 'south' | 'west', lead: string): string => {
    const line = layout[direction]
    return line === undefined ? '' : `, ${lead} the ${direction} wall: ${line}`
  }
  const room = labelled
    ? [
        layout.centre !== undefined ? `Centre: ${layout.centre}.` : '',
        layout.light !== undefined ? `Light: ${layout.light}.` : '',
        layout.rest,
      ]
        .filter((part) => part !== '')
        .join(' ')
    : (input.layout.trim() !== '' ? input.layout.trim() : input.look.trim()).replace(/\r?\n/g, ' ')
  return [
    `A 2x2 contact sheet of four photographs of one room, ${input.name}, separated by thin white borders of equal width, each panel 16:9.`,
    'All four show the same room at the same moment in the same light, each taken at eye level with a 35mm lens from the middle of the opposite wall, with no people in the room.',
    `Top left: facing north, the view in reference image 1${looking('north', 'looking at')}.`,
    `Top right: facing east${looking('east', 'looking straight at')}.`,
    `Bottom left: facing south${looking('south', 'looking straight at')}.`,
    `Bottom right: facing west${looking('west', 'looking straight at')}.`,
    ...(room !== '' ? [`The room: ${room}`] : []),
    HOUSE_PHOTOGRAPH,
    input.styleAnchors,
  ].join('\n')
}

export function setPlateBrief(
  set: Pick<ProjectSet, 'name' | 'look' | 'plates'>,
  view: SetViewRequest,
  styleAnchors: string,
): StillBrief {
  const referenced = set.plates.length > 0
  const framing = referenced ? VIEW_FRAMING[view] : FIRST_PLATE_FRAMING
  // A compass view of a plated set is shot from the middle of the opposite
  // wall, so the camera sentence and the plates nearest it travel (Task 10).
  const camera =
    referenced && view !== 'detail'
      ? {
          facing: view,
          position: `the middle of the ${OPPOSITE_DIRECTION[view]} wall, at eye level`,
          lens: '24mm',
        }
      : undefined
  return {
    type: 'still',
    coversText: set.name,
    description: set.look,
    shotSize: view === 'detail' ? 'close' : 'wide',
    motion: { kind: 'static' },
    transition: 'cut',
    ...(referenced ? { set: set.name } : {}),
    ...(camera ? { camera } : {}),
    // A plate is the room, not a scene in it: people belong to the stills.
    prompt: `${set.name}, empty of people: ${framing}. ${set.look} ${HOUSE_PHOTOGRAPH} ${styleAnchors}`,
    negativePrompt: 'people, figures',
  }
}

/**
 * The camera sentence and what it sees (decision 275): where the camera
 * stands, then the inventory lines for the wall in frame, the walls at the
 * edges, the centre and the light, and the wall behind it. Stated positively,
 * so the model is given the new picture to make rather than an old one to avoid.
 */
/**
 * How much of the room a shot shows (live run 5, 2026-09-24): an 85mm close
 * shot given the whole inventory (the wall ahead, both edges, the table)
 * came back as a wide view of the room with the subject small. A brief's
 * shot size decides; without one, a lens of 70mm or longer reads as close.
 */
type Framing = 'wide' | 'medium' | 'close'

function framingOf(shotSize: ShotSize | undefined, lens: string | undefined): Framing {
  if (shotSize === 'close' || shotSize === 'macro') return 'close'
  if (shotSize === 'medium') return 'medium'
  if (shotSize !== undefined) return 'wide'
  const mm = Number(/(\d+)\s?mm/.exec(lens ?? '')?.[1])
  return Number.isFinite(mm) && mm >= 70 ? 'close' : 'wide'
}

/**
 * The framing, said first (live run 6, 2026-09-24): stated at the end of the
 * prompt, "a close shot" lost to a wide opening sentence and a wide reference
 * plate. A still with a camera now opens with how tight it is; a wide shot
 * needs no lead.
 */
export function framingLead(camera: SetCamera, shotSize?: ShotSize): string {
  const framing = framingOf(shotSize, camera.lens)
  if (framing === 'close') {
    return 'A close shot, the subject filling most of the frame, the room behind soft and out of focus: '
  }
  if (framing === 'medium') return 'A medium shot, the subject from the waist up: '
  return ''
}

/** Where each compass direction falls for a camera facing one way. */
const FRAME_SIDE: Record<SetPlateDirection, Record<SetPlateDirection, string>> = {
  north: {
    north: 'ahead',
    east: "to the camera's right",
    south: 'behind the camera',
    west: "to the camera's left",
  },
  east: {
    east: 'ahead',
    south: "to the camera's right",
    west: 'behind the camera',
    north: "to the camera's left",
  },
  south: {
    south: 'ahead',
    west: "to the camera's right",
    north: 'behind the camera',
    east: "to the camera's left",
  },
  west: {
    west: 'ahead',
    north: "to the camera's right",
    east: 'behind the camera',
    south: "to the camera's left",
  },
}

/**
 * The light line with each compass word placed in the frame (live run 13,
 * 2026-09-25): "daylight from the west windows" means nothing to a model that
 * does not know where west is, and naming the window wall itself pulled it in
 * behind a close subject.
 */
function orientLight(light: string, facing: SetPlateDirection): string {
  return light.replace(
    /\b(north|east|south|west)\b/gi,
    (word) => `${word} (${FRAME_SIDE[facing][word.toLowerCase() as SetPlateDirection]})`,
  )
}

export function describeCamera(camera: SetCamera, layout: string, shotSize?: ShotSize): string {
  const lens = camera.lens ? `, ${camera.lens}` : ''
  const sentences = [`The camera stands at ${camera.position}, facing ${camera.facing}${lens}.`]
  const view = layoutView(parseLayout(layout), camera.facing)
  const framing = framingOf(shotSize, camera.lens)
  const light = view.light ? `Light: ${orientLight(view.light, camera.facing)}.` : null
  // A close shot orients by its light alone: naming a side wall's contents
  // pulled that wall in behind the subject (live run 13).
  if (framing === 'close') {
    if (view.inFrame) sentences.push(`Behind, soft and out of focus: ${view.inFrame}.`)
    if (light) sentences.push(light)
    return sentences.join(' ')
  }
  // Which wall stands on which side (live run 10): without it the room came
  // back mirrored, its windows on the wrong side.
  if (framing === 'medium') {
    if (view.inFrame) sentences.push(`Behind: ${view.inFrame}.`)
    if (view.left) sentences.push(`To the camera's left: ${view.left}.`)
    if (view.right) sentences.push(`To the camera's right: ${view.right}.`)
    if (light) sentences.push(light)
    return sentences.join(' ')
  }
  if (view.inFrame) sentences.push(`In frame: ${view.inFrame}.`)
  if (view.left) sentences.push(`Frame left: ${view.left}.`)
  if (view.right) sentences.push(`Frame right: ${view.right}.`)
  if (view.centre) sentences.push(`Centre: ${view.centre}.`)
  if (light) sentences.push(light)
  if (view.behind) sentences.push(`Behind the camera, out of frame: ${view.behind}.`)
  if (view.rest) sentences.push(`The room: ${view.rest.replace(/\.$/, '')}.`)
  return sentences.join(' ')
}
