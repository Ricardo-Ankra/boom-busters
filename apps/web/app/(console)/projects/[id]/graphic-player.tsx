'use client'

import { GraphicCard, loadBrandFonts, msToFrames } from '@boom-busters/compositions'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitStored, GraphicScene } from '@boom-busters/schemas'
import { MASTER_FPS } from '@boom-busters/timeline'
import { Player, type PlayerRef } from '@remotion/player'
import * as React from 'react'

/**
 * The heavy half of the board's playback (decision 289): the same `GraphicCard`
 * the render mounts, at the slot's own length, so the motion the owner approves
 * is the motion the film shows. The resting-frame SVG stays the thumbnail.
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

export function GraphicPlayerFrame({
  scene,
  brand,
  logoUrls,
  durationMs,
  portrait,
  onPlayer,
}: {
  scene: GraphicScene
  brand: BrandKitStored
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
  // The card reads only each logo's URL; the size fields the timeline schema
  // requires are not read by the component, so the board passes 1 by 1.
  const logos = Object.fromEntries(
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
  const size = portrait ? PORTRAIT : LANDSCAPE
  return (
    <div
      role="region"
      aria-label="Graphic playback"
      className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-black"
    >
      <Player
        ref={playerRef}
        component={GraphicCard}
        inputProps={{
          payload: { kind: 'graphic', scene, logos, claimIds: [] },
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
    </div>
  )
}
