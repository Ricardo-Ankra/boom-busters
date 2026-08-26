'use client'

import { Player } from '@remotion/player'
import * as React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import {
  ChapterCard,
  ChartReveal,
  KaraokeCaptions,
  LowerThird,
  loadBrandFonts,
} from '@boom-busters/compositions'
import type { ChartPayload } from '@boom-busters/compositions'
import { resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitTokens, Caption, Settings } from '@boom-busters/schemas'

/**
 * The Brand Kit's live specimen (build spec section 10): a chapter card, a
 * lower third, a chart and karaoke captions rendered through @remotion/player
 * with the CURRENT token values — the same components the render farm uses,
 * so what this panel shows is what the pipeline will draw. Edits to the
 * colours above re-render it on the spot, because the brand arrives through
 * the form's own optimistic state.
 *
 * The content is a fixture, deliberately: the panel exists to judge tokens
 * (colours, type, variants), and fixed words make two palettes comparable.
 */

const FPS = 30
const BEAT_FRAMES = 3 * FPS
const BEATS = 4
export const SPECIMEN_DURATION_FRAMES = BEAT_FRAMES * BEATS

/** A ULID-shaped fixture ref — the chart component never dereferences it. */
const FIXTURE_CLAIM = '01HQ00000000000000000000AA'

const SPECIMEN_CHART: ChartPayload = {
  kind: 'chart',
  chartKind: 'line',
  series: [
    {
      label: 'Share price',
      unit: '€',
      points: [
        { x: 'Jun 17', y: 104.5 },
        { x: 'Jun 18', y: 39.9 },
        { x: 'Jun 19', y: 25.8 },
        { x: 'Jun 22', y: 14.4 },
        { x: 'Jun 25', y: 3.3 },
        { x: 'Jun 26', y: 1.28 },
      ],
    },
  ],
  dataRefs: [FIXTURE_CLAIM],
  takeaway: 'Nine days. Ninety-nine percent gone.',
  annotations: [{ atX: 'Jun 25', text: 'Insolvency filed' }],
  reveal: 'draw-on',
}

/** Six words over three seconds — enough pages to see the highlight move. */
const SPECIMEN_WORDS: Caption[] = ['The', 'money', 'was', 'never', 'really', 'there.'].map(
  (text, index) => ({
    text,
    startMs: index * 450,
    endMs: index * 450 + 430,
    timestampMs: null,
    confidence: null,
  }),
)

function Specimen({ brand }: { brand: BrandKitTokens }) {
  // Idempotent; @remotion/google-fonts handles delayRender internally.
  loadBrandFonts(brand.typography)

  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <Sequence durationInFrames={BEAT_FRAMES}>
        <ChapterCard
          index={3}
          title="The Money That Wasn't There"
          brand={brand}
          durationInFrames={BEAT_FRAMES}
        />
      </Sequence>
      <Sequence from={BEAT_FRAMES} durationInFrames={BEAT_FRAMES}>
        <LowerThird
          title="Markus Braun"
          subtitle="CEO, Wirecard AG · 2002 to 2020"
          brand={brand}
          durationInFrames={BEAT_FRAMES}
        />
      </Sequence>
      <Sequence from={BEAT_FRAMES * 2} durationInFrames={BEAT_FRAMES}>
        <ChartReveal payload={SPECIMEN_CHART} brand={brand} durationInFrames={BEAT_FRAMES} />
      </Sequence>
      <Sequence from={BEAT_FRAMES * 3} durationInFrames={BEAT_FRAMES}>
        <KaraokeCaptions words={SPECIMEN_WORDS} brand={brand} />
      </Sequence>
    </AbsoluteFill>
  )
}

export function BrandSpecimenPanel({ settings }: { settings: Settings }) {
  const brand = React.useMemo(() => resolveBrandKit(settings), [settings])
  const { look } = settings.brandKit

  return (
    <div className="flex flex-col gap-2">
      <div
        data-player-shell
        className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-black"
      >
        <Player
          component={Specimen}
          inputProps={{ brand }}
          durationInFrames={SPECIMEN_DURATION_FRAMES}
          fps={FPS}
          // Half of 1080p: the compositions size everything through
          // frameScale, so this is the same picture with a quarter of the
          // pixels — plenty inside a settings column.
          compositionWidth={960}
          compositionHeight={540}
          controls
          loop
          acknowledgeRemotionLicense
          style={{ width: '100%' }}
        />
      </div>
      <p className="text-[12px] text-[var(--color-text-muted)]">
        Chapter card ({look.chapterCardVariant}) · lower third ({look.lowerThirdVariant}) · chart ·
        karaoke captions — three seconds each, fixture words, your exact tokens.
      </p>
    </div>
  )
}
