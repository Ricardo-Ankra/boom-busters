'use client'

import type { BrandKitStored, GraphicScene } from '@boom-busters/schemas'
import type { PlayerRef } from '@remotion/player'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { Button } from '@/components/ui/button'

/**
 * The light half of the board's playback (decision 289): which graphic is
 * playing, and the buttons that drive it. The board imports this statically,
 * so nothing here may import `@remotion/player` or `@boom-busters/compositions`
 * at runtime (types only). The heavy half, `GraphicPlayerFrame`, is fetched
 * the first time a frame renders, which is after Play is pressed.
 */

const GraphicPlayerFrame = dynamic(
  () => import('./graphic-player').then((module) => module.GraphicPlayerFrame),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="p-3 text-[13px] text-[var(--color-text-muted)]">
        Loading the player…
      </p>
    ),
  },
)

const PlaybackContext = React.createContext<{
  playing: string | null
  setPlaying: (slotId: string | null) => void
} | null>(null)

/** One graphic plays at a time across the board. */
export function GraphicPlaybackProvider({ children }: { children: React.ReactNode }) {
  const [playing, setPlaying] = React.useState<string | null>(null)
  const value = React.useMemo(() => ({ playing, setPlaying }), [playing])
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}

export function useGraphicPlayback(slotId: string) {
  const context = React.useContext(PlaybackContext)
  const [local, setLocal] = React.useState(false)
  // Outside a provider (a story, a lone test) each card plays on its own.
  if (!context) return { playing: local, play: () => setLocal(true), stop: () => setLocal(false) }
  return {
    playing: context.playing === slotId,
    play: () => context.setPlaying(slotId),
    stop: () => context.setPlaying(null),
  }
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
  // The frame mounts after its chunk loads, so the Player reaches us by callback.
  const [player, setPlayer] = React.useState<PlayerRef | null>(null)

  React.useEffect(() => {
    if (!player) return
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
  }, [player])

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
        onPlayer={setPlayer}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            if (running) player?.pause()
            else player?.play()
          }}
        >
          {running ? 'Pause' : 'Play'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            player?.seekTo(0)
            player?.play()
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
