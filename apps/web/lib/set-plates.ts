import { OPPOSITE_DIRECTION } from '@boom-busters/schemas'
import type { ProjectSet, SetViewRequest, StillBrief } from '@boom-busters/schemas'

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
    prompt: `${set.name}, empty of people: ${framing}. ${set.look} ${styleAnchors}`,
    negativePrompt: 'people, figures',
  }
}
