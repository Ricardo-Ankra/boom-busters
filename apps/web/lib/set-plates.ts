import { HOUSE_PHOTOGRAPH } from '@boom-busters/providers'
import { layoutView, OPPOSITE_DIRECTION, parseLayout } from '@boom-busters/schemas'
import type { ProjectSet, SetCamera, SetViewRequest, StillBrief } from '@boom-busters/schemas'

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
  'a wide establishing photograph of the whole room, taken from its entrance at eye level'

const VIEW_FRAMING: Record<SetViewRequest, string> = {
  north: 'a wide photograph of the whole room facing north',
  east: 'a wide photograph of the whole room facing east',
  south: 'a wide photograph of the whole room facing south',
  west: 'a wide photograph of the whole room facing west',
  detail:
    "a close photograph of one part of the room, its furniture, surfaces and materials at arm's length",
}

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
  const room = input.layout.trim() !== '' ? input.layout.trim() : input.look.trim()
  return [
    `A 2x2 contact sheet of four photographs of one room, ${input.name}, separated by thin white borders of equal width, each panel 16:9.`,
    'All four show the same room at the same moment in the same light, each taken at eye level with a 35mm lens from the middle of the opposite wall, with no people in the room.',
    'Top left: facing north, the view in reference image 1.',
    'Top right: facing east. Bottom left: facing south. Bottom right: facing west.',
    `The room: ${room.replace(/\r?\n/g, ' ')}`,
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
export function describeCamera(camera: SetCamera, layout: string): string {
  const lens = camera.lens ? `, ${camera.lens}` : ''
  const sentences = [`The camera stands at ${camera.position}, facing ${camera.facing}${lens}.`]
  const view = layoutView(parseLayout(layout), camera.facing)
  if (view.inFrame) sentences.push(`In frame: ${view.inFrame}.`)
  if (view.edges.length > 0) sentences.push(`At the edges: ${view.edges.join('; ')}.`)
  if (view.centre) sentences.push(`Centre: ${view.centre}.`)
  if (view.light) sentences.push(`Light: ${view.light}.`)
  if (view.behind) sentences.push(`Behind the camera, out of frame: ${view.behind}.`)
  if (view.rest) sentences.push(`The room: ${view.rest.replace(/\.$/, '')}.`)
  return sentences.join(' ')
}
