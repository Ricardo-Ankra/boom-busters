'use client'

import { GraphicCard, loadBrandFonts, msToFrames } from '@boom-busters/compositions'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitStored, GraphicScene } from '@boom-busters/schemas'
import { MASTER_FPS } from '@boom-busters/timeline'
import { Player, type PlayerRef } from '@remotion/player'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useGraphicPlayback } from './graphic-playback'

/**
 * The board plays the real graphic (decision 289): the same `GraphicCard` the
 * render mounts, at the slot's own length, so the motion the owner approves is
 * the motion the film shows. The resting-frame SVG stays the thumbnail.
 *
 * The board imports this module through `next/dynamic` (`ssr: false`), so the
 * player and the composition library load on the first card only.
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
  playerRef,
}: {
  scene: GraphicScene
  brand: BrandKitStored
  logoUrls: Readonly<Record<string, string>>
  durationMs: number
  portrait: boolean
  playerRef?: React.Ref<PlayerRef>
}) {
  const tokens = React.useMemo(
    () => resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand }),
    [brand],
  )
  React.useEffect(() => {
    void loadBrandFonts(tokens.typography)
  }, [tokens])
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

export function GraphicPlayback({
  slotId,
  scene,
  brand,
  logoUrls,
  durationMs,
}: {
  slotId: string
  scene: GraphicScene
  brand: BrandKitStored
  logoUrls: Readonly<Record<string, string>>
  durationMs: number
}) {
  const { playing, play, stop } = useGraphicPlayback(slotId)
  const [portrait, setPortrait] = React.useState(false)
  // The Player's own state, not the last button pressed: it ends by itself and
  // a remount (Portrait / Landscape) starts it again.
  const [running, setRunning] = React.useState(true)
  const ref = React.useRef<PlayerRef>(null)

  React.useEffect(() => {
    const player = ref.current
    if (!playing || !player) return
    setRunning(player.isPlaying())
    const onPlay = () => setRunning(true)
    const onStopped = () => setRunning(false)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onStopped)
    player.addEventListener('ended', onStopped)
    return () => {
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onStopped)
      player.removeEventListener('ended', onStopped)
    }
  }, [playing, portrait])

  if (!playing) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={play}>
          Play graphic
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <GraphicPlayerFrame
        key={portrait ? 'portrait' : 'landscape'}
        scene={scene}
        brand={brand}
        logoUrls={logoUrls}
        durationMs={durationMs}
        portrait={portrait}
        playerRef={ref}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            if (running) ref.current?.pause()
            else ref.current?.play()
          }}
        >
          {running ? 'Pause' : 'Play'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            ref.current?.seekTo(0)
            ref.current?.play()
          }}
        >
          Replay
        </Button>
        <Button variant="outline" onClick={() => setPortrait((value) => !value)}>
          {portrait ? 'Landscape' : 'Portrait'}
        </Button>
        <Button variant="ghost" onClick={stop}>
          Close player
        </Button>
      </div>
    </div>
  )
}
