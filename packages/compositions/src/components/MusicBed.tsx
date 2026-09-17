import { Audio as WebCodecsAudio } from '@remotion/media'
import { Audio, Sequence, useVideoConfig } from 'remotion'
import { gainAt } from '@boom-busters/schemas'
import type { MusicTrack } from '@boom-busters/schemas'
import { mediaCrossOrigin } from '../lib/cross-origin'
import { mediaEngine } from '../lib/media-engine'
import { dbToGain, materialisedUrl, msToFrames } from '../lib/motion'
import { crossfadeGain, loopCopies, outroGain } from '../lib/music-loop'

/**
 * How long two iterations of the bed overlap, and how much of the file's own
 * ending is dropped with them. Five seconds is long enough to carry a written
 * fade-out under the next intro and short enough that no phrase is lost.
 */
const CROSSFADE_MS = 5000

/** The bed follows the picture out rather than stopping on the last frame. */
const OUTRO_FADE_MS = 2500

/**
 * The music bed (spec section 8.3): volume-function ducking driven by the
 * compiler's curve, interpolated by the contract-level `gainAt` — the exact
 * function the preview screen's gain line uses, so what you see is what you
 * hear (decision 122). Plays through Web Audio in the player (see
 * `mediaEngine`), the core tag offline.
 *
 * A bed shorter than the film is laid down as overlapping copies rather than
 * repeated (decision 256): a library track ends with a written fade-out and a
 * tail of silence, and on repeat that ending becomes an audible seam in the
 * middle of the cut. Each copy stops before the tail and the next rises
 * through it on the equal-power pair. The maths is in `lib/music-loop`; the
 * track's length comes from the timeline, so a frame cannot be rendered
 * against a different soundtrack than its neighbours.
 */
export function MusicBed({ music }: { music: MusicTrack }) {
  const { fps, durationInFrames } = useVideoConfig()
  const src = materialisedUrl(music.url, 'music bed')

  /** The ducking curve, and the film's own ending, at an ABSOLUTE frame. */
  const bedGain = (frame: number) =>
    dbToGain(
      music.duckingCurve.length > 0
        ? gainAt(music.duckingCurve, (frame / fps) * 1000)
        : music.gainDb,
    ) * outroGain(frame, durationInFrames, msToFrames(OUTRO_FADE_MS, fps))

  const crossfadeFrames = msToFrames(CROSSFADE_MS, fps)
  const bedFrames = music.durationMs === undefined ? 0 : msToFrames(music.durationMs, fps)
  const copies = loopCopies({ bedFrames, totalFrames: durationInFrames, crossfadeFrames })

  // A bed longer than the film, one too short to carry a seam, or one the
  // library never measured: play the file as it is. `loop` is still right for
  // the last of those, because an audible seam beats silence.
  if (copies.length === 0) {
    return <Track src={src} loop volume={bedGain} />
  }

  const keptFrames = bedFrames - crossfadeFrames
  return (
    <>
      {copies.map((copy, index) => (
        <Sequence
          key={copy.fromFrames}
          from={copy.fromFrames}
          durationInFrames={copy.durationInFrames}
          name={`music bed ${index + 1}`}
        >
          <Track
            src={src}
            volume={(local) =>
              bedGain(copy.fromFrames + local) *
              crossfadeGain({ localFrame: local, copyIndex: index, keptFrames, crossfadeFrames })
            }
          />
        </Sequence>
      ))}
    </>
  )
}

/** One audio element, on whichever engine this environment plays through. */
function Track({
  src,
  volume,
  loop,
}: {
  src: string
  volume: (frame: number) => number
  loop?: boolean
}) {
  if (mediaEngine() === 'core-tags') {
    return (
      <Audio
        {...(loop === true ? { loop: true as const } : {})}
        pauseWhenBuffering
        crossOrigin={mediaCrossOrigin()}
        src={src}
        volume={volume}
      />
    )
  }
  return (
    <WebCodecsAudio {...(loop === true ? { loop: true as const } : {})} src={src} volume={volume} />
  )
}
