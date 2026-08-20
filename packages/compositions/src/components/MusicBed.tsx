import { Audio as WebCodecsAudio } from '@remotion/media'
import { Audio, useVideoConfig } from 'remotion'
import { gainAt } from '@boom-busters/schemas'
import type { MusicTrack } from '@boom-busters/schemas'
import { mediaCrossOrigin } from '../lib/cross-origin'
import { mediaEngine } from '../lib/media-engine'
import { dbToGain, materialisedUrl } from '../lib/motion'

/**
 * The music bed (spec section 8.3): volume-function ducking driven by the
 * compiler's curve, interpolated by the contract-level `gainAt` — the exact
 * function the preview screen's gain line uses, so what you see is what you
 * hear (decision 122). Loops if the bed is shorter than the video. Plays
 * through Web Audio in the player (see `mediaEngine`), the core tag offline.
 */
export function MusicBed({ music }: { music: MusicTrack }) {
  const { fps } = useVideoConfig()
  const src = materialisedUrl(music.url, 'music bed')
  const volume = (frame: number) =>
    dbToGain(
      music.duckingCurve.length > 0
        ? gainAt(music.duckingCurve, (frame / fps) * 1000)
        : music.gainDb,
    )
  if (mediaEngine() === 'core-tags') {
    return (
      <Audio loop pauseWhenBuffering crossOrigin={mediaCrossOrigin()} src={src} volume={volume} />
    )
  }
  return <WebCodecsAudio loop src={src} volume={volume} />
}
