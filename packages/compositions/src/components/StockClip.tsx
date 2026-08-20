import { AbsoluteFill, OffthreadVideo, useVideoConfig } from 'remotion'
import { mediaCrossOrigin } from '../lib/cross-origin'
import { msToFrames } from '../lib/motion'

/**
 * A stock video slot. Always muted BY TYPE upstream (the timeline schema
 * pins `muted: true`) — narration and music own the mix; a clip's own audio
 * never plays. `OffthreadVideo` extracts frames server-side during renders
 * and falls back to a video tag in the Player and Studio.
 */
export function StockClip({ src, trimStartMs }: { src: string; trimStartMs?: number }) {
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <OffthreadVideo
        src={src}
        crossOrigin={mediaCrossOrigin()}
        muted
        startFrom={msToFrames(trimStartMs ?? 0, fps)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  )
}
