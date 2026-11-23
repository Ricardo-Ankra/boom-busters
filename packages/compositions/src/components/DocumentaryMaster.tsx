import { Audio as WebCodecsAudio } from '@remotion/media'
import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  AbsoluteFill,
  Audio,
  getRemotionEnvironment,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import type { BrandKitTokens, GradePreset, Timeline, TimelineSlot } from '@boom-busters/schemas'
import { captionsClearOf } from '../lib/captions'
import { mediaCrossOrigin } from '../lib/cross-origin'
import { mediaEngine } from '../lib/media-engine'
import { loadBrandFonts } from '../fonts/load'
import {
  materialisedUrl,
  mediaUrl,
  msToFrames,
  previewMediaUrl,
  punchScale,
  transitionOpacity,
} from '../lib/motion'
import { AnimatedMap } from './AnimatedMap'
import { CardOverlay } from './CardOverlay'
import { ChartReveal } from './ChartReveal'
import { containScale, EndCard, endCardSlotBox } from './EndCard'
import type { EndCardSlotBox } from './EndCard'
import { EndCta } from './EndCta'
import { FollowCard } from './FollowCard'
import { GraphicCard } from './GraphicCard'
import { GraphicCode } from './GraphicCode'
import { HeadlineCard } from './HeadlineCard'
import { KaraokeCaptions } from './KaraokeCaptions'
import { KenBurnsImage } from './KenBurnsImage'
import { LowerThird } from './LowerThird'
import { MusicBed } from './MusicBed'
import { RelatedArrow } from './RelatedArrow'
import { SocialPost } from './SocialPost'
import { StockClip } from './StockClip'
import { SubscribeBadge } from './SubscribeBadge'
import { Watermark } from './Watermark'

/**
 * The master composition (spec section 8.3): a MATERIALISED timeline in,
 * frames out. Consumes the timeline JSON and the brand snapshot inside it
 * and nothing else — no DB, no env, no network beyond the media URLs the
 * broker resolved. Layering, bottom to top: slots, grain, overlays,
 * captions; narration and music are audio-only.
 */
/**
 * The box the slots draw into while a point Short's end card is up; null
 * (the default) means the whole frame.
 */
const SlotBoxContext = createContext<EndCardSlotBox | null>(null)

/**
 * The picture's layer. While a point Short's end card is up (decision 479)
 * it shrinks into the card's 16:9 frame and keeps playing there; otherwise
 * it is a plain full frame. It is resized rather than scaled (decision 481),
 * so photos and clips cover the frame at its own aspect. Its own component,
 * so only it reads the frame.
 */
function SlotLayer({
  overlays,
  surface,
  children,
}: {
  overlays: Timeline['overlays']
  /** The frame's fill, behind a drawn slot fitted inside it. */
  surface: string
  children: ReactNode
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const tMs = (frame / fps) * 1000
  const card = overlays.find(
    (overlay) =>
      overlay.kind === 'endCard' &&
      tMs >= overlay.startMs &&
      tMs < overlay.startMs + overlay.durationMs,
  )
  if (!card) return <AbsoluteFill>{children}</AbsoluteFill>
  const box = endCardSlotBox(tMs - card.startMs, width, height)
  return (
    <div
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        borderRadius: box.radius,
        overflow: 'hidden',
        backgroundColor: surface,
      }}
    >
      <SlotBoxContext.Provider value={box}>{children}</SlotBoxContext.Provider>
    </div>
  )
}

export function DocumentaryMaster({ timeline }: { timeline: Timeline }) {
  const { fps } = useVideoConfig()
  const { brand } = timeline

  // Idempotent; @remotion/google-fonts handles delayRender internally.
  loadBrandFonts(brand.typography)

  // A point Short's end card and follow card (decision 479) hold the
  // captions back, which would otherwise sit on top of them.
  const captionWords = useMemo(() => {
    const cards = timeline.overlays.filter(
      (overlay) => overlay.kind === 'endCard' || overlay.kind === 'followCard',
    )
    return cards.length === 0
      ? timeline.captions.words
      : captionsClearOf(timeline.captions.words, cards)
  }, [timeline.overlays, timeline.captions.words])

  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <SlotLayer overlays={timeline.overlays} surface={brand.colors.surface}>
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
      </SlotLayer>

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
          ) : overlay.kind === 'chapterCard' || overlay.kind === 'titleCard' ? (
            <CardOverlay
              title={overlay.props.title}
              {...(overlay.code !== undefined ? { code: overlay.code } : {})}
              brand={brand}
              durationInFrames={msToFrames(overlay.durationMs, fps)}
            />
          ) : overlay.kind === 'endCta' ? (
            <EndCta text={overlay.props.text} brand={brand} />
          ) : overlay.kind === 'relatedArrow' ? (
            <RelatedArrow label={overlay.props.label} brand={brand} />
          ) : overlay.kind === 'subscribeBadge' ? (
            <SubscribeBadge
              channelName={overlay.props.channelName}
              handle={overlay.props.handle}
              brand={brand}
            />
          ) : overlay.kind === 'endCard' ? (
            <EndCard {...overlay.props} brand={brand} />
          ) : overlay.kind === 'followCard' ? (
            <FollowCard {...overlay.props} brand={brand} />
          ) : (
            <Watermark brand={brand} />
          )}
        </Sequence>
      ))}

      {timeline.captions.style === 'karaoke' ? (
        <KaraokeCaptions words={captionWords} brand={brand} />
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
          <NarrationAudio
            src={materialisedUrl(segment.url, `narration segment ${index}`)}
            {...(segment.trimStartMs !== undefined
              ? { trimBefore: msToFrames(segment.trimStartMs, fps) }
              : {})}
          />
        </Sequence>
      ))}

      {timeline.music ? <MusicBed music={timeline.music} /> : null}
    </AbsoluteFill>
  )
}

/**
 * One narration paragraph's audio. Offline it is the core tag the renderer
 * mixes; in the player it plays through Web Audio (see `mediaEngine`), so
 * paragraph boundaries are sample-accurate instead of shared-audio-tag
 * swaps — the audible tick that survived premounting and full buffering.
 */
function NarrationAudio({ src, trimBefore }: { src: string; trimBefore?: number }) {
  const trim = trimBefore !== undefined ? { trimBefore } : {}
  if (mediaEngine() === 'core-tags') {
    return <Audio src={src} crossOrigin={mediaCrossOrigin()} pauseWhenBuffering {...trim} />
  }
  return <WebCodecsAudio src={src} {...trim} />
}

/**
 * One slot, dispatched by payload kind, with its dissolve-in if any.
 *
 * Exported for its own render test (decision 287 final review, spec §10):
 * the grade filter has no render-level check otherwise, and mounting the
 * whole master to get at it means a webpack bundle and headless Chrome for
 * what is really one inline style.
 */
export function SlotView({ slot, brand }: { slot: TimelineSlot; brand: BrandKitTokens }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const box = useContext(SlotBoxContext)
  const durationInFrames = msToFrames(slot.durationMs, fps)
  const opacity = transitionOpacity(slot.transition, (frame / fps) * 1000)

  const grade = GRADE_FILTER[brand.look.gradePreset ?? 'none']
  const graded = (child: ReactNode) =>
    grade ? <AbsoluteFill style={{ filter: grade }}>{child}</AbsoluteFill> : child

  const punch =
    slot.motion.kind === 'punch'
      ? punchScale(slot.motion.scale, slot.motion.durationMs, (frame / fps) * 1000)
      : undefined

  const drawn = (
    <>
      {slot.payload.kind === 'image' ? (
        graded(
          <KenBurnsImage
            src={mediaUrl(slot.payload.src)}
            motion={slot.motion}
            durationInFrames={durationInFrames}
            {...(slot.crop !== undefined ? { crop: slot.crop } : {})}
          />,
        )
      ) : slot.payload.kind === 'video' ? (
        graded(
          <StockClip
            src={mediaUrl(slot.payload.src)}
            {...(previewMediaUrl(slot.payload.src) !== undefined
              ? { previewSrc: previewMediaUrl(slot.payload.src) }
              : {})}
            {...(slot.payload.trimStartMs !== undefined
              ? { trimStartMs: slot.payload.trimStartMs }
              : {})}
            {...(slot.crop !== undefined ? { crop: slot.crop } : {})}
          />,
        )
      ) : slot.payload.kind === 'chart' ? (
        <ChartReveal payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      ) : slot.payload.kind === 'headline' ? (
        <HeadlineCard payload={slot.payload} brand={brand} />
      ) : slot.payload.kind === 'graphic' ? (
        <GraphicCard payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      ) : slot.payload.kind === 'graphic-code' ? (
        <GraphicCode payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      ) : slot.payload.kind === 'social' ? (
        <SocialPost payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      ) : (
        <AnimatedMap payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      )}
    </>
  )
  // In an end card's frame (decision 481) a photo or clip covers the box by
  // itself; anything laid out on the whole frame keeps the frame's size and
  // is scaled to fit inside the box, whole, on the frame's surface.
  const photographic = slot.payload.kind === 'image' || slot.payload.kind === 'video'
  const content =
    box === null || photographic ? (
      drawn
    ) : (
      <div
        style={{
          position: 'absolute',
          left: (box.width - width) / 2,
          top: (box.height - height) / 2,
          width,
          height,
          transform: `scale(${containScale(box, width, height)})`,
          transformOrigin: 'center center',
        }}
      >
        {drawn}
      </div>
    )

  return (
    <AbsoluteFill style={{ opacity }}>
      {punch === undefined ? (
        content
      ) : (
        // The punch-in (playbook Shorts, spec 4.5): any payload kind scales
        // about the frame centre; the opacity wrapper stays outside it.
        <AbsoluteFill style={{ transform: `scale(${punch})`, transformOrigin: 'center center' }}>
          {content}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}

/**
 * The film's grade (decision 287): one CSS filter over photographic slots,
 * stills, stock and archival alike, so generated and real pictures sit in
 * one look. Charts, cards, graphics and maps are drawn in brand colours and
 * are never filtered. Values set by eye in the player and a render.
 */
export const GRADE_FILTER: Record<GradePreset, string | undefined> = {
  none: undefined,
  muted: 'saturate(0.82) contrast(1.06) brightness(0.97)',
  strong: 'saturate(0.68) contrast(1.12) brightness(0.94)',
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
