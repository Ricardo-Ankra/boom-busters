import { Composition } from 'remotion'
import { gainAt, timelineDurationMs } from '@boom-busters/schemas'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { AnimatedMap } from './components/AnimatedMap'
import { ChapterCard } from './components/ChapterCard'
import { ChartReveal } from './components/ChartReveal'
import type { ChartPayload } from './components/ChartReveal'
import { DocumentaryMaster } from './components/DocumentaryMaster'
import { EndCta } from './components/EndCta'
import { KaraokeCaptions } from './components/KaraokeCaptions'
import { KenBurnsImage } from './components/KenBurnsImage'
import { LowerThird } from './components/LowerThird'
import { MusicBed } from './components/MusicBed'
import { ShortVertical } from './components/ShortVertical'
import { StockClip } from './components/StockClip'
import {
  FIXTURE_BRAND,
  FIXTURE_CAPTION_WORDS,
  FIXTURE_MAP_LOCATIONS,
  FIXTURE_SHORT_TIMELINE,
  FIXTURE_TIMELINE,
} from './fixtures/timeline'
import { FIXTURE_IMAGE_SKYLINE } from './fixtures/media'
import { msToFrames } from './lib/motion'

/**
 * The Studio fixture gallery (spec section 8.3: every component gets a
 * fixture for visual development) — also the entry the snapshot tests
 * bundle and render stills from. Fixture data only; no network, except the
 * dev-only StockClip sample noted below.
 */

const FPS = 30
const WIDE = { fps: FPS, width: 1920, height: 1080 } as const
const TALL = { fps: FPS, width: 1080, height: 1920 } as const

function lookVariant(look: Partial<BrandKitTokens['look']>): BrandKitTokens {
  return { ...FIXTURE_BRAND, look: { ...FIXTURE_BRAND.look, ...look } }
}

const CHART_LINE: ChartPayload = (() => {
  const slot = FIXTURE_TIMELINE.slots[1]!
  if (slot.payload.kind !== 'chart') throw new Error('fixture slot 1 must be the chart')
  return slot.payload
})()

const CHART_WATERFALL: ChartPayload = {
  kind: 'chart',
  chartKind: 'waterfall',
  series: [
    {
      label: 'Cash position',
      unit: '€bn',
      points: [
        { x: '2018', y: 1.9 },
        { x: 'H1 19', y: 1.4 },
        { x: 'H2 19', y: 0.9 },
        { x: 'Audit', y: 0.1 },
        { x: 'Rescue', y: 0.4 },
      ],
    },
  ],
  dataRefs: ['01HQ00000000000000000000AA'],
  takeaway: 'The cash that was never there.',
  reveal: 'draw-on',
}

/** A dev-only sample clip for Studio; never part of a render or snapshot. */
const STOCK_SAMPLE_URL =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'

/** Captions render over footage in real use; the fixture needs a stage. */
function CaptionStage() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: FIXTURE_BRAND.colors.background,
      }}
    >
      <KaraokeCaptions words={FIXTURE_CAPTION_WORDS} brand={FIXTURE_BRAND} />
    </div>
  )
}

/** MusicBed has no pixels, so its fixture draws the ducking envelope. */
function MusicBedCurve() {
  const music = FIXTURE_TIMELINE.music
  if (!music) return null
  const total = timelineDurationMs(FIXTURE_TIMELINE)
  const width = 1920
  const height = 1080
  const points: string[] = []
  for (let tMs = 0; tMs <= total; tMs += 100) {
    const gain = gainAt(music.duckingCurve, tMs)
    const x = (tMs / total) * (width - 200) + 100
    const y = 200 + ((gain + 60) / -60) * -1 * (height - 400)
    points.push(`${x},${height - y}`)
  }
  return (
    <div style={{ width, height, backgroundColor: FIXTURE_BRAND.colors.background }}>
      <svg width={width} height={height}>
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={FIXTURE_BRAND.colors.accent}
          strokeWidth={4}
        />
      </svg>
      <MusicBed music={music} />
    </div>
  )
}

export function Root() {
  const masterDuration = msToFrames(timelineDurationMs(FIXTURE_TIMELINE), FPS)
  return (
    <>
      <Composition
        id="DocumentaryMaster"
        component={DocumentaryMaster}
        durationInFrames={masterDuration}
        {...WIDE}
        defaultProps={{ timeline: FIXTURE_TIMELINE }}
        /* A real render passes its own timeline as inputProps, and the
           metadata must follow IT — with the numbers above fixed, a
           45-minute master handed to the deployed site would render
           exactly the fixture's 14 seconds and stop. */
        calculateMetadata={({ props }) => ({
          durationInFrames: msToFrames(timelineDurationMs(props.timeline), props.timeline.fps),
          fps: props.timeline.fps,
          width: props.timeline.width,
          height: props.timeline.height,
        })}
      />

      <Composition
        id="ShortVertical"
        component={ShortVertical}
        durationInFrames={msToFrames(timelineDurationMs(FIXTURE_SHORT_TIMELINE), FPS)}
        {...TALL}
        defaultProps={{ timeline: FIXTURE_SHORT_TIMELINE }}
        /* Same contract as the master: a real render's metadata follows the
           timeline it is handed, not the fixture's numbers. */
        calculateMetadata={({ props }) => ({
          durationInFrames: msToFrames(timelineDurationMs(props.timeline), props.timeline.fps),
          fps: props.timeline.fps,
          width: props.timeline.width,
          height: props.timeline.height,
        })}
      />

      <Composition
        id="EndCtaFixture"
        component={EndCta}
        durationInFrames={120}
        {...TALL}
        defaultProps={{ text: 'The full story is on the channel', brand: FIXTURE_BRAND }}
      />

      <Composition
        id="KenBurnsImageFixture"
        component={KenBurnsImage}
        durationInFrames={150}
        {...WIDE}
        defaultProps={{
          src: FIXTURE_IMAGE_SKYLINE,
          motion: { kind: 'kenburns', direction: 'in', intensity: 0.1 },
          durationInFrames: 150,
        }}
      />

      <Composition
        id="StockClipFixture"
        component={StockClip}
        durationInFrames={150}
        {...WIDE}
        defaultProps={{ src: STOCK_SAMPLE_URL, trimStartMs: 2000 }}
      />

      <Composition
        id="ChartRevealLine"
        component={ChartReveal}
        durationInFrames={240}
        {...WIDE}
        defaultProps={{ payload: CHART_LINE, brand: FIXTURE_BRAND, durationInFrames: 240 }}
      />

      <Composition
        id="ChartRevealWaterfall"
        component={ChartReveal}
        durationInFrames={240}
        {...WIDE}
        defaultProps={{ payload: CHART_WATERFALL, brand: FIXTURE_BRAND, durationInFrames: 240 }}
      />

      <Composition
        id="AnimatedMapFixture"
        component={AnimatedMap}
        durationInFrames={240}
        {...WIDE}
        defaultProps={{
          payload: { kind: 'map', locations: FIXTURE_MAP_LOCATIONS, route: true },
          brand: FIXTURE_BRAND,
          durationInFrames: 240,
        }}
      />

      <Composition
        id="LowerThirdBar"
        component={LowerThird}
        durationInFrames={120}
        {...WIDE}
        defaultProps={{
          title: 'Markus Braun',
          subtitle: 'CEO, Wirecard',
          brand: FIXTURE_BRAND,
          durationInFrames: 120,
        }}
      />
      <Composition
        id="LowerThirdStack"
        component={LowerThird}
        durationInFrames={120}
        {...WIDE}
        defaultProps={{
          title: 'Markus Braun',
          subtitle: 'CEO, Wirecard',
          brand: lookVariant({ lowerThirdVariant: 'stack' }),
          durationInFrames: 120,
        }}
      />
      <Composition
        id="LowerThirdMinimal"
        component={LowerThird}
        durationInFrames={120}
        {...WIDE}
        defaultProps={{
          title: 'Markus Braun',
          subtitle: 'CEO, Wirecard',
          brand: lookVariant({ lowerThirdVariant: 'minimal' }),
          durationInFrames: 120,
        }}
      />

      <Composition
        id="ChapterCardFull"
        component={ChapterCard}
        durationInFrames={78}
        {...WIDE}
        defaultProps={{
          index: 3,
          title: 'The money that never was',
          brand: FIXTURE_BRAND,
          durationInFrames: 78,
        }}
      />
      <Composition
        id="ChapterCardCorner"
        component={ChapterCard}
        durationInFrames={78}
        {...WIDE}
        defaultProps={{
          index: 3,
          title: 'The money that never was',
          brand: lookVariant({ chapterCardVariant: 'corner' }),
          durationInFrames: 78,
        }}
      />
      <Composition
        id="ChapterCardMinimal"
        component={ChapterCard}
        durationInFrames={78}
        {...WIDE}
        defaultProps={{
          index: 3,
          title: 'The money that never was',
          brand: lookVariant({ chapterCardVariant: 'minimal' }),
          durationInFrames: 78,
        }}
      />

      <Composition
        id="KaraokeCaptionsWide"
        component={CaptionStage}
        durationInFrames={240}
        {...WIDE}
      />
      <Composition
        id="KaraokeCaptionsTall"
        component={CaptionStage}
        durationInFrames={240}
        {...TALL}
      />

      <Composition
        id="MusicBedCurve"
        component={MusicBedCurve}
        durationInFrames={masterDuration}
        {...WIDE}
      />
    </>
  )
}
