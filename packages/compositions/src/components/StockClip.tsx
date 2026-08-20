import { Video } from '@remotion/media'
import { AbsoluteFill, OffthreadVideo, useVideoConfig } from 'remotion'
import { mediaCrossOrigin } from '../lib/cross-origin'
import { mediaEngine } from '../lib/media-engine'
import { msToFrames } from '../lib/motion'

/**
 * A stock video slot. Always muted BY TYPE upstream (the timeline schema
 * pins `muted: true`) — narration and music own the mix; a clip's own audio
 * never plays. `OffthreadVideo` extracts frames server-side during renders;
 * in the player, `@remotion/media`'s `<Video>` paints WebCodecs frames onto
 * a canvas in exact timeline sync instead of seek-correcting a video tag
 * (see `mediaEngine`), falling back to `OffthreadVideo` on refusal.
 */
export function StockClip({ src, trimStartMs }: { src: string; trimStartMs?: number }) {
  const { fps } = useVideoConfig()
  const trimBefore = msToFrames(trimStartMs ?? 0, fps)
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {mediaEngine() === 'core-tags' ? (
        <OffthreadVideo
          src={src}
          crossOrigin={mediaCrossOrigin()}
          muted
          startFrom={trimBefore}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Video
          src={src}
          muted
          trimBefore={trimBefore}
          objectFit="cover"
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </AbsoluteFill>
  )
}
