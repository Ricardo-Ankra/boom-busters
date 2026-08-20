import { Video } from '@remotion/media'
import { AbsoluteFill, OffthreadVideo, useVideoConfig } from 'remotion'
import { mediaCrossOrigin } from '../lib/cross-origin'
import { mediaEngine } from '../lib/media-engine'
import { msToFrames } from '../lib/motion'

/**
 * A stock video slot. Always muted BY TYPE upstream (the timeline schema
 * pins `muted: true`) — narration and music own the mix; a clip's own audio
 * never plays. `OffthreadVideo` extracts frames server-side during renders,
 * always from the full-quality `src`; in the player, `@remotion/media`'s
 * `<Video>` paints WebCodecs frames onto a canvas in exact timeline sync
 * (see `mediaEngine`), and it decodes `previewSrc` — the small proxy
 * ingestion stored — when one exists, because decode cost scales with
 * source pixels and the moderator's machine may only have software decode.
 */
export function StockClip({
  src,
  previewSrc,
  trimStartMs,
}: {
  src: string
  previewSrc?: string
  trimStartMs?: number
}) {
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
          src={previewSrc ?? src}
          muted
          trimBefore={trimBefore}
          objectFit="cover"
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </AbsoluteFill>
  )
}
