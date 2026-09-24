import type { ProjectSet, SetPlateAngle, StillBrief } from '@boom-busters/schemas'

/**
 * The brief a generated set plate is drawn from (decision 264, amended 273).
 *
 * Its own module because both the Set card's action and the project page's
 * estimate build it, and a 'use server' file may export only async functions.
 *
 * A set's first plate comes from the look alone. Every later one is another
 * angle of the same room, so the brief names the set and the plates the set
 * already holds travel with it: `generateStillCandidates` attaches them and
 * closes the prompt telling the model to photograph the room anew from the
 * framing below, never to copy the plates' own. That is how a set comes to
 * hold more than one viewpoint, and why stills of it stop repeating one.
 */

const ANGLE_FRAMING: Record<SetPlateAngle, string> = {
  establishing: 'a wide establishing photograph of the whole room, taken from its entrance',
  reverse:
    'the same room photographed from its opposite end, looking back towards the entrance, ' +
    'showing the walls and windows the first view has behind the camera',
  side: 'the same room photographed from one side, looking across its width',
  detail:
    "a close photograph of one part of the room, its furniture, surfaces and materials at arm's length",
}

export function setPlateBrief(
  set: Pick<ProjectSet, 'name' | 'look' | 'plates'>,
  angle: SetPlateAngle,
  styleAnchors: string,
): StillBrief {
  const referenced = set.plates.length > 0
  return {
    type: 'still',
    coversText: set.name,
    description: set.look,
    shotSize: angle === 'detail' ? 'close' : 'wide',
    motion: { kind: 'static' },
    transition: 'cut',
    ...(referenced ? { set: set.name } : {}),
    // A plate is the room, not a scene in it: people belong to the stills.
    prompt: `${set.name}, empty of people: ${ANGLE_FRAMING[angle]}. ${set.look} ${styleAnchors}`,
    negativePrompt: 'people, figures',
  }
}
