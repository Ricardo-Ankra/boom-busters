import {
  AbsoluteFill,
  Audio,
  getRemotionEnvironment,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import type { BrandKitTokens, Timeline, TimelineSlot } from '@boom-busters/schemas'
import { loadBrandFonts } from '../fonts/load'
import { materialisedUrl, mediaUrl, msToFrames, transitionOpacity } from '../lib/motion'
import { AnimatedMap } from './AnimatedMap'
import { frameScale, typeStyle, withAlpha } from './brand'
import { ChapterCard } from './ChapterCard'
import { ChartReveal } from './ChartReveal'
import { KaraokeCaptions } from './KaraokeCaptions'
import { KenBurnsImage } from './KenBurnsImage'
import { LowerThird } from './LowerThird'
import { MusicBed } from './MusicBed'
import { StockClip } from './StockClip'

/**
 * The master composition (spec section 8.3): a MATERIALISED timeline in,
 * frames out. Consumes the timeline JSON and the brand snapshot inside it
 * and nothing else — no DB, no env, no network beyond the media URLs the
 * broker resolved. Layering, bottom to top: slots, grain, overlays,
 * captions; narration and music are audio-only.
 */
export function DocumentaryMaster({ timeline }: { timeline: Timeline }) {
  const { fps } = useVideoConfig()
  const { brand } = timeline

  // Idempotent; @remotion/google-fonts handles delayRender internally.
  loadBrandFonts(brand.typography)

  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      {timeline.slots.map((slot, index) => (
        <Sequence
          key={`slot-${index}`}
          from={msToFrames(slot.startMs, fps)}
          durationInFrames={msToFrames(slot.durationMs, fps)}
          name={`${slot.type} slot ${index}`}
          // Same premount reasoning as narration: a stock clip or image
          // fetching at its own start frame is a visible hitch in the player.
          premountFor={fps * 3}
        >
          <SlotView slot={slot} brand={brand} />
        </Sequence>
      ))}

      <Grain preset={brand.look.grainPreset} />

      {timeline.overlays.map((overlay, index) => (
        <Sequence
          key={`overlay-${index}`}
          from={msToFrames(overlay.startMs, fps)}
          durationInFrames={msToFrames(overlay.durationMs, fps)}
          name={`${overlay.kind} overlay`}
        >
          {overlay.kind === 'lowerThird' ? (
            <LowerThird
              title={overlay.props.title}
              {...(overlay.props.subtitle !== undefined
                ? { subtitle: overlay.props.subtitle }
                : {})}
              brand={brand}
              durationInFrames={msToFrames(overlay.durationMs, fps)}
            />
          ) : overlay.kind === 'chapterCard' ? (
            <ChapterCard
              index={overlay.props.index}
              title={overlay.props.title}
              brand={brand}
              durationInFrames={msToFrames(overlay.durationMs, fps)}
            />
          ) : (
            <Watermark brand={brand} />
          )}
        </Sequence>
      ))}

      {timeline.captions.style === 'karaoke' ? (
        <KaraokeCaptions words={timeline.captions.words} brand={brand} />
      ) : null}

      {timeline.narration.map((segment, index) => (
        <Sequence
          key={`narration-${index}`}
          from={msToFrames(segment.startMs, fps)}
          durationInFrames={msToFrames(segment.durationMs, fps)}
          name={`narration ${index}`}
          // Mounted 4 s early, paused: without this, each paragraph's WAV
          // starts downloading at the frame it must already be playing —
          // an audible glitch at every boundary in the @remotion/player
          // (the offline render never noticed; found 2026-08-19).
          premountFor={fps * 4}
        >
          <Audio
            src={materialisedUrl(segment.url, `narration segment ${index}`)}
            pauseWhenBuffering
          />
        </Sequence>
      ))}

      {timeline.music ? <MusicBed music={timeline.music} /> : null}
    </AbsoluteFill>
  )
}

/** One slot, dispatched by payload kind, with its dissolve-in if any. */
function SlotView({ slot, brand }: { slot: TimelineSlot; brand: BrandKitTokens }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const durationInFrames = msToFrames(slot.durationMs, fps)
  const opacity = transitionOpacity(slot.transition, (frame / fps) * 1000)

  return (
    <AbsoluteFill style={{ opacity }}>
      {slot.payload.kind === 'image' ? (
        <KenBurnsImage
          src={mediaUrl(slot.payload.src)}
          motion={slot.motion}
          durationInFrames={durationInFrames}
        />
      ) : slot.payload.kind === 'video' ? (
        <StockClip
          src={mediaUrl(slot.payload.src)}
          {...(slot.payload.trimStartMs !== undefined
            ? { trimStartMs: slot.payload.trimStartMs }
            : {})}
        />
      ) : slot.payload.kind === 'chart' ? (
        <ChartReveal payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      ) : (
        <AnimatedMap payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      )}
    </AbsoluteFill>
  )
}

const GRAIN_OPACITY: Record<BrandKitTokens['look']['grainPreset'], number> = {
  none: 0,
  subtle: 0.05,
  film: 0.09,
  heavy: 0.16,
}

/**
 * Static film grain via SVG turbulence — texture, not animation.
 *
 * The overlay blend is what the spec look wants, and the offline render
 * keeps it. In the @remotion/player it is dropped: `mix-blend-mode` forces
 * the browser to recomposite the blend against every repaint of everything
 * underneath — at 30 fps that is a full-frame blend per frame for a 5-9%
 * texture. Plain alpha at the same opacity reads near-identically at
 * preview size and costs one cached layer.
 */
function Grain({ preset }: { preset: BrandKitTokens['look']['grainPreset'] }) {
  const opacity = GRAIN_OPACITY[preset]
  if (opacity === 0) return null
  const { isRendering } = getRemotionEnvironment()
  return (
    <AbsoluteFill
      style={{
        opacity,
        ...(isRendering ? { mixBlendMode: 'overlay' as const } : {}),
        pointerEvents: 'none',
      }}
    >
      <svg width="100%" height="100%">
        <filter id="bb-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" />
        </filter>
        <rect width="100%" height="100%" filter="url(#bb-grain)" />
      </svg>
    </AbsoluteFill>
  )
}

/**
 * The corner watermark. A typographic wordmark until a logo pipeline exists
 * — brand.look carries a logo r2Key but no materialised URL yet, and a
 * broken image in every frame would be worse than clean type ("Boom &
 * Busters" with the ampersand: public-facing copy, per the naming rule).
 */
function Watermark({ brand }: { brand: BrandKitTokens }) {
  const { width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const placement = brand.look.watermarkPlacement
  if (placement === 'none') return null
  const inset = Math.round(36 * scale)
  const position: React.CSSProperties = {
    position: 'absolute',
    ...(placement === 'tl' || placement === 'tr' ? { top: inset } : { bottom: inset }),
    ...(placement === 'tl' || placement === 'bl' ? { left: inset } : { right: inset }),
  }
  return (
    <div
      style={{
        ...position,
        ...typeStyle(brand.typography.captions, 24, scale),
        color: withAlpha(brand.colors.textPrimary, 0.45),
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      Boom &amp; Busters
    </div>
  )
}
