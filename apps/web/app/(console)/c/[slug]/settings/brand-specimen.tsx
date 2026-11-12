'use client'

import { Player } from '@remotion/player'
import * as React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import {
  CardOverlay,
  GraphicCode,
  KaraokeCaptions,
  loadBrandFonts,
} from '@boom-busters/compositions'
import { resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitTokens, Caption, GraphicCodePayload, Settings } from '@boom-busters/schemas'
import { isCardTechnique, SPECIMEN_CARD_TITLE } from '@/lib/specimen-reel'
import type { ReelPiece } from '@/lib/specimen-reel'

/**
 * The Brand Kit's live specimen: the channel's package reel (the film title
 * when a design exists, chapter card, lower third, a chart and a counter),
 * each drawn by the channel's approved exemplar or the house design, through
 * @remotion/player with the CURRENT token values. Edits to the colours above
 * re-render it on the spot, because the brand arrives through the form's own
 * optimistic state. In portrait a final beat adds the captions, which only
 * Shorts carry.
 */

const FPS = 30
const CAPTIONS_FRAMES = 3 * FPS

/** Six words over three seconds, enough pages to see the highlight move. */
export const SPECIMEN_WORDS: Caption[] = ['The', 'money', 'was', 'never', 'really', 'there.'].map(
  (text, index) => ({
    text,
    startMs: index * 450,
    endMs: index * 450 + 430,
    timestampMs: null,
    confidence: null,
  }),
)

interface PlayablePiece {
  payload: GraphicCodePayload
  frames: number
  /** A chapter or film title: the render plays these through the card overlay and its exit fade. */
  card: boolean
}

const framesOf = (ms: number) => Math.max(1, Math.round((ms * FPS) / 1000))

function Specimen({
  brand,
  pieces,
  captions,
}: {
  brand: BrandKitTokens
  pieces: PlayablePiece[]
  captions: boolean
}) {
  // Idempotent; @remotion/google-fonts handles delayRender internally.
  loadBrandFonts(brand.typography)
  let from = 0
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      {pieces.map((piece, index) => {
        const start = from
        from += piece.frames
        return (
          <Sequence key={index} from={start} durationInFrames={piece.frames}>
            {piece.card ? (
              <CardOverlay
                title={SPECIMEN_CARD_TITLE}
                code={{
                  version: piece.payload.version,
                  compiled: piece.payload.compiled,
                  title: piece.payload.title,
                  words: piece.payload.words,
                  durationMs: piece.payload.durationMs,
                }}
                brand={brand}
                durationInFrames={piece.frames}
              />
            ) : (
              <GraphicCode payload={piece.payload} brand={brand} durationInFrames={piece.frames} />
            )}
          </Sequence>
        )
      })}
      {captions ? (
        <Sequence from={from} durationInFrames={CAPTIONS_FRAMES}>
          <KaraokeCaptions words={SPECIMEN_WORDS} brand={brand} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  )
}

export function BrandSpecimenPanel({ settings, reel }: { settings: Settings; reel: ReelPiece[] }) {
  const brand = React.useMemo(() => resolveBrandKit(settings), [settings])
  const [portrait, setPortrait] = React.useState(false)

  const pieces = React.useMemo<PlayablePiece[]>(
    () =>
      reel.flatMap((piece) =>
        piece.payload
          ? [
              {
                payload: piece.payload,
                frames: framesOf(piece.payload.durationMs),
                card: isCardTechnique(piece.technique),
              },
            ]
          : [],
      ),
    [reel],
  )
  const totalFrames = Math.max(
    1,
    pieces.reduce((sum, piece) => sum + piece.frames, 0) + (portrait ? CAPTIONS_FRAMES : 0),
  )
  const size = portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {(
          [
            ['Landscape 16:9', false],
            ['Portrait 9:16', true],
          ] as const
        ).map(([label, isPortrait]) => (
          <button
            key={label}
            type="button"
            aria-pressed={portrait === isPortrait}
            onClick={() => setPortrait(isPortrait)}
            className={`rounded-[6px] border px-3 py-1 text-[13px] ${
              portrait === isPortrait
                ? 'border-[var(--color-accent)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        data-player-shell
        className="mx-auto w-full overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-black"
        style={{ maxWidth: portrait ? 320 : undefined }}
      >
        <Player
          // A new shape or reel restarts from the top.
          key={`${portrait}-${totalFrames}`}
          component={Specimen}
          inputProps={{ brand, pieces, captions: portrait }}
          durationInFrames={totalFrames}
          fps={FPS}
          // Full frames, as the board's player uses for code: a design may size
          // in pixels against the 1080p frame, and the Player scales it down.
          compositionWidth={size.width}
          compositionHeight={size.height}
          controls
          loop
          acknowledgeRemotionLicense
          style={{ width: '100%' }}
        />
      </div>
      <ul className="text-[12px] text-[var(--color-text-muted)]">
        {reel.map((piece) => (
          <li key={piece.technique}>
            {piece.issue
              ? `${piece.label} · could not compile: ${piece.issue}`
              : `${piece.label} · ${piece.source === 'channel' ? 'channel version' : 'house design'}`}
          </li>
        ))}
        {portrait ? <li>Captions (Shorts only)</li> : null}
      </ul>
    </div>
  )
}
