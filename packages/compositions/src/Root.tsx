import { Composition } from 'remotion'
import { gainAt, timelineDurationMs } from '@boom-busters/schemas'
import type { BrandKitTokens, HeadlinePayload } from '@boom-busters/schemas'
import { AnimatedMap } from './components/AnimatedMap'
import { ChapterCard } from './components/ChapterCard'
import { ChartReveal } from './components/ChartReveal'
import type { ChartPayload } from './components/ChartReveal'
import { DocumentaryMaster } from './components/DocumentaryMaster'
import { EndCta } from './components/EndCta'
import { HeadlineCard } from './components/HeadlineCard'
import { KaraokeCaptions } from './components/KaraokeCaptions'
import { KenBurnsImage } from './components/KenBurnsImage'
import { LowerThird } from './components/LowerThird'
import { MusicBed } from './components/MusicBed'
import { ShortVertical } from './components/ShortVertical'
import { StockClip } from './components/StockClip'
import { WatermarkFixture } from './components/Watermark'
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

/**
 * The bar chart that set the figure rule (decision 254): a unit of "USD
 * Millions" and bars of 1000 and 4000, which the screen must read as one and
 * four billion dollars without the viewer doing the multiplication.
 */
const CHART_BAR: ChartPayload = {
  kind: 'chart',
  chartKind: 'bar',
  series: [
    {
      label: 'Reported valuation',
      unit: 'USD Millions',
      points: [
        { x: 'Oct 2022', y: 1000 },
        { x: 'Spring 2023', y: 4000 },
      ],
    },
  ],
  dataRefs: ['01HQ00000000000000000000AA'],
  takeaway: 'Four billion dollars, six months, and the product was free.',
  reveal: 'draw-on',
}

/**
 * Two measures that cannot share a scale (decision 259), and the chart that
 * prompted the work: a valuation climbing into the billions against a margin
 * falling through the floor in percent. On one scale the margin is a flat line
 * along the bottom, labelled in dollars.
 */
const CHART_DUAL_AXIS: ChartPayload = {
  kind: 'chart',
  chartKind: 'line',
  series: [
    {
      label: 'Valuation',
      unit: '$bn',
      points: [
        { x: '2019', y: 1.2 },
        { x: '2020', y: 4.8 },
        { x: '2021', y: 12.4 },
        { x: '2022', y: 18.1 },
      ],
    },
    {
      label: 'Operating margin',
      unit: '%',
      axis: 'right',
      points: [
        { x: '2019', y: -4 },
        { x: '2020', y: -19 },
        { x: '2021', y: -61 },
        { x: '2022', y: -148 },
      ],
    },
  ],
  dataRefs: ['01HQ00000000000000000000AA'],
  takeaway: 'The more it was worth, the more each sale cost them.',
  reveal: 'draw-on',
}

/**
 * The headline card (decision 257). Invented outlet, invented byline: a
 * fixture naming a real paper and a real journalist would be a fabricated
 * record living in the repo, which is the thing this card exists to prevent.
 */
const HEADLINE_CARD: HeadlinePayload = {
  kind: 'headline',
  outlet: 'The Financial Record',
  headline: 'Auditors cannot find the $1.9 billion the company says it holds',
  publishedAt: '2023-03-14',
  author: 'Elena Marsh',
  deck: 'Three banks told investigators they had never held the escrow accounts named in the filings.',
  emphasis: '$1.9 billion',
  sourceLabel: 'financialrecord.example/2023/03/14',
  sourceUrl: 'https://financialrecord.example/2023/03/14',
  claimId: '01HQ00000000000000000000AA',
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
        id="ChartRevealBar"
        component={ChartReveal}
        durationInFrames={240}
        {...WIDE}
        defaultProps={{ payload: CHART_BAR, brand: FIXTURE_BRAND, durationInFrames: 240 }}
      />

      <Composition
        id="HeadlineCardWide"
        component={HeadlineCard}
        durationInFrames={240}
        {...WIDE}
        defaultProps={{ payload: HEADLINE_CARD, brand: FIXTURE_BRAND }}
      />

      <Composition
        id="HeadlineCardTall"
        component={HeadlineCard}
        durationInFrames={240}
        {...TALL}
        defaultProps={{ payload: HEADLINE_CARD, brand: FIXTURE_BRAND }}
      />

      <Composition
        id="WatermarkLogo"
        component={WatermarkFixture}
        durationInFrames={30}
        {...WIDE}
        defaultProps={{
          brand: {
            ...FIXTURE_BRAND,
            look: {
              ...FIXTURE_BRAND.look,
              logoR2Key: 'boom-busters/logos/fixture.png',
              logoUrl: FIXTURE_IMAGE_SKYLINE,
            },
          },
        }}
      />

      <Composition
        id="ChartRevealDualAxis"
        component={ChartReveal}
        durationInFrames={240}
        {...WIDE}
        defaultProps={{ payload: CHART_DUAL_AXIS, brand: FIXTURE_BRAND, durationInFrames: 240 }}
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
