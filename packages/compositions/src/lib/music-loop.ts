/**
 * Looping a music bed without a seam (decision 256).
 *
 * A library track is written to end: it fades out and leaves silence on the
 * tail. Played on repeat, that ending is the loop point, so a film longer than
 * its bed fades the music away, holds a gap, and starts the intro again in the
 * middle of a sentence. It is the most obviously machine-made sound in the
 * whole cut.
 *
 * So the bed is laid down as overlapping copies instead. Each copy stops a
 * crossfade before the file ends, which is where the written fade-out lives,
 * and the next copy starts a crossfade before that, so the two overlap. Over
 * the overlap the outgoing copy follows cos and the incoming sin, the
 * equal-power pair: for two uncorrelated signals (and the tail of a track
 * against its own intro is as uncorrelated as it gets) the sum holds a
 * constant loudness, where a straight linear crossfade dips in the middle.
 *
 * Pure and unit-tested, like the chart geometry: the component only reads the
 * numbers out.
 */

export interface LoopCopy {
  /** Frame the copy starts at, in the composition's own clock. */
  fromFrames: number
  /** How long this copy plays, tail already dropped. */
  durationInFrames: number
}

/**
 * Where each copy of the bed starts, for a film of `totalFrames`.
 *
 * Returns an EMPTY list when the bed cannot be looped this way: one that is
 * not much longer than the crossfade has nothing left of itself between two
 * seams, and one longer than the film never loops at all. Both cases belong
 * to the caller, which plays the file straight.
 */
export function loopCopies(input: {
  bedFrames: number
  totalFrames: number
  crossfadeFrames: number
}): LoopCopy[] {
  const { bedFrames, totalFrames, crossfadeFrames } = input
  // Three crossfades of material is the floor: one to fade out, one to fade
  // in, and one of the track actually playing on its own in between.
  if (crossfadeFrames <= 0 || bedFrames < crossfadeFrames * 3) return []

  const keptFrames = bedFrames - crossfadeFrames
  if (keptFrames >= totalFrames) return []

  const periodFrames = keptFrames - crossfadeFrames
  const copies: LoopCopy[] = []
  for (let fromFrames = 0; fromFrames < totalFrames; fromFrames += periodFrames) {
    copies.push({
      fromFrames,
      durationInFrames: Math.min(keptFrames, totalFrames - fromFrames),
    })
  }
  return copies
}

/**
 * One copy's own gain at `localFrame`, before the ducking curve.
 *
 * The first copy opens at full: the film starts with the music, it does not
 * fade up into it. Every other copy rises over the seam its predecessor is
 * falling through.
 */
export function crossfadeGain(input: {
  localFrame: number
  copyIndex: number
  keptFrames: number
  crossfadeFrames: number
}): number {
  const { localFrame, copyIndex, keptFrames, crossfadeFrames } = input
  if (crossfadeFrames <= 0) return 1

  const rising =
    copyIndex === 0 ? 1 : equalPowerIn(Math.min(1, Math.max(0, localFrame / crossfadeFrames)))
  const fallFrom = keptFrames - crossfadeFrames
  const falling =
    localFrame <= fallFrom
      ? 1
      : equalPowerOut(Math.min(1, Math.max(0, (localFrame - fallFrom) / crossfadeFrames)))
  return rising * falling
}

/**
 * The film's own ending: the bed follows the picture out rather than being
 * cut off mid-chord on the last frame. Same equal-power curve as a seam.
 */
export function outroGain(frame: number, totalFrames: number, fadeFrames: number): number {
  if (fadeFrames <= 0) return 1
  const from = totalFrames - fadeFrames
  if (frame <= from) return 1
  return equalPowerOut(Math.min(1, Math.max(0, (frame - from) / fadeFrames)))
}

function equalPowerIn(t: number): number {
  return Math.sin((t * Math.PI) / 2)
}

function equalPowerOut(t: number): number {
  return Math.cos((t * Math.PI) / 2)
}
