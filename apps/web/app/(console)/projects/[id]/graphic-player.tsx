'use client'

import { GraphicCard, GraphicCode, loadBrandFonts, msToFrames } from '@boom-busters/compositions'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitStored, GraphicScene } from '@boom-busters/schemas'
import { MASTER_FPS } from '@boom-busters/timeline'
import { Player, type PlayerRef } from '@remotion/player'
import * as React from 'react'
import { codePayloadFor, type GraphicDesign } from './graphic-playback'

/**
 * The heavy half of the board's playback (decision 289): the same composition
 * the render mounts, at the slot's own length, so the motion the owner
 * approves is the motion the film shows. A scene plays on `GraphicCard`; a
 * design written as code (decision 295) plays on `GraphicCode`, the code
 * winning over a scene the brief still carries, as it does in the render.
 *
 * `graphic-playback` imports this module through `next/dynamic` (`ssr: false`)
 * and renders it only after Play is pressed, so the player and the composition
 * library are never fetched by a board nobody plays.
 *
 * The player ships with the Vercel deploy while renders use the uploaded
 * Remotion bundle: a composition change must ship with `deploy:remotion` for
 * the two to match.
 */

/** Half of 1080p, as the brand specimen plays: frameScale sizes everything. */
const LANDSCAPE = { width: 960, height: 540 }
const PORTRAIT = { width: 540, height: 960 }
/**
 * The full frames for code (decision 295): the designer's code may size in
 * pixels against the 1080p frame the dry run checked it in, so it plays at
 * that size and the Player scales the frame down to the card.
 */
const CODE_LANDSCAPE = { width: 1920, height: 1080 }
const CODE_PORTRAIT = { width: 1080, height: 1920 }

/**
 * A scene's marks, by element id. The card reads only each logo's URL; the
 * size fields the timeline schema requires are not read by the component, so
 * the board passes 1 by 1.
 */
function sceneLogos(scene: GraphicScene, logoUrls: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    scene.elements.flatMap((element) =>
      element.kind === 'logo' && element.assetId && logoUrls[element.assetId]
        ? [
            [
              element.id,
              {
                r2Key: `logos/${element.assetId}`,
                url: logoUrls[element.assetId]!,
                width: 1,
                height: 1,
              },
            ],
          ]
        : [],
    ),
  )
}

export function GraphicPlayerFrame({
  design,
  brand,
  logoUrls,
  durationMs,
  portrait,
  onPlayer,
}: {
  design: GraphicDesign
  brand: BrandKitStored
  /** A scene's marks, by asset id; a design in code carries its own, by title. */
  logoUrls: Readonly<Record<string, string>>
  durationMs: number
  portrait: boolean
  /** Handed the Player once it is attached, and null when this frame goes away. */
  onPlayer: (player: PlayerRef | null) => void
}) {
  const tokens = React.useMemo(
    () => resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand }),
    [brand],
  )
  React.useEffect(() => {
    void loadBrandFonts(tokens.typography)
  }, [tokens])
  const playerRef = React.useRef<PlayerRef>(null)
  React.useEffect(() => {
    onPlayer(playerRef.current)
    return () => onPlayer(null)
  }, [onPlayer])
  const durationInFrames = Math.max(1, msToFrames(durationMs, MASTER_FPS))
  const size =
    design.kind === 'code'
      ? portrait
        ? CODE_PORTRAIT
        : CODE_LANDSCAPE
      : portrait
        ? PORTRAIT
        : LANDSCAPE
  return (
    <div
      role="region"
      aria-label="Graphic playback"
      className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-black"
    >
      {design.kind === 'code' ? (
        <Player
          ref={playerRef}
          component={GraphicCode}
          inputProps={{
            payload: codePayloadFor(design.code, design.logos, design.data),
            brand: tokens,
            durationInFrames,
          }}
          durationInFrames={durationInFrames}
          fps={MASTER_FPS}
          compositionWidth={size.width}
          compositionHeight={size.height}
          autoPlay
          acknowledgeRemotionLicense
          style={{ width: '100%' }}
        />
      ) : (
        <Player
          ref={playerRef}
          component={GraphicCard}
          inputProps={{
            payload: {
              kind: 'graphic',
              scene: design.scene,
              logos: sceneLogos(design.scene, logoUrls),
              claimIds: [],
            },
            brand: tokens,
            durationInFrames,
          }}
          durationInFrames={durationInFrames}
          fps={MASTER_FPS}
          compositionWidth={size.width}
          compositionHeight={size.height}
          autoPlay
          acknowledgeRemotionLicense
          style={{ width: '100%' }}
        />
      )}
    </div>
  )
}
