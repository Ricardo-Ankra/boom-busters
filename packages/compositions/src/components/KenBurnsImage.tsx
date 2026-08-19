import { AbsoluteFill, Img, useCurrentFrame } from 'remotion'
import type { TimelineMotion } from '@boom-busters/schemas'
import { kenburnsScale } from '../lib/motion'

/**
 * A full-frame still with the compiler's resolved Ken Burns move (decision
 * 120: slow 0.06 / medium 0.10 / fast 0.16). `static` motion renders the
 * frame unmoved; any other motion kind is treated as static too — a chart or
 * map motion reaching an image is a compiler bug, not a rendering choice.
 */
export function KenBurnsImage({
  src,
  motion,
  durationInFrames,
}: {
  src: string
  motion: TimelineMotion
  durationInFrames: number
}) {
  const frame = useCurrentFrame()
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1)
  const scale =
    motion.kind === 'kenburns' ? kenburnsScale(motion.direction, motion.intensity, progress) : 1

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      />
    </AbsoluteFill>
  )
}
