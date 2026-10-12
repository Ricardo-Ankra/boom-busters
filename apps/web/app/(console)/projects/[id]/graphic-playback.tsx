'use client'

import type {
  BrandKitStored,
  GraphicCode,
  GraphicCodePayload,
  GraphicScene,
} from '@boom-busters/schemas'
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
 *
 * Since decision 295 a graphic or a chart may be designed as code. The pure
 * helpers the player, the still and the board share live here, in the module
 * the board already loads: every library mark the board signed, keyed by
 * title (`codeLogosFor`; ruling 5), and the `graphic-code` payload a design
 * plays as (`codePayloadFor`), built the way the timeline builds it.
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

/** The library's marks for a design in code, keyed by entity title as `props.logos` is (decision 295). */
export type CodeLogos = Readonly<
  Record<string, { assetId: string; url: string; width: number; height: number }>
>

const NO_LOGOS: CodeLogos = {}

/**
 * What the player mounts: the designer's code (decision 295), or a scene
 * composed before it. Code carries its own marks, by title; a scene's are
 * looked up by asset id.
 */
export type GraphicDesign =
  | { kind: 'scene'; scene: GraphicScene }
  | { kind: 'code'; code: GraphicCode; data?: GraphicCodePayload['data']; logos: CodeLogos }

/**
 * The marks a design in code is handed (decision 295; ruling 5): every
 * library mark the board signed (`logoMarks` is the whole library), keyed by
 * its title, whatever the source reads, as the dry run and the render hand
 * them over.
 */
export function codeLogosFor(
  logoUrls: Readonly<Record<string, string>>,
  logoMarks: Readonly<Record<string, { title: string; width: number; height: number }>>,
): CodeLogos {
  const logos: Record<string, CodeLogos[string]> = {}
  for (const [assetId, mark] of Object.entries(logoMarks)) {
    const url = logoUrls[assetId]
    if (url !== undefined && logos[mark.title] === undefined) {
      logos[mark.title] = { assetId, url, width: mark.width, height: mark.height }
    }
  }
  return logos
}

/**
 * The `graphic-code` payload a design in code plays as, the shape the
 * timeline gives `GraphicCode` (decision 295). The board holds signed URLs,
 * so each mark carries its URL and a stand-in key the component never reads.
 */
export function codePayloadFor(
  code: GraphicCode,
  logos: CodeLogos,
  data?: GraphicCodePayload['data'],
): GraphicCodePayload {
  return {
    kind: 'graphic-code',
    version: code.version,
    compiled: code.compiled,
    title: code.title,
    words: code.words,
    durationMs: code.durationMs,
    logos: Object.fromEntries(
      Object.entries(logos).map(([title, logo]) => [
        title,
        { r2Key: `logos/${logo.assetId}`, url: logo.url, width: logo.width, height: logo.height },
      ]),
    ),
    claimIds: [],
    ...(data ? { data } : {}),
  }
}

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
  code,
  data,
  codeLogos = NO_LOGOS,
  noun = 'graphic',
  brand,
  logoUrls,
  durationMs,
}: {
  slotId: string
  /** A scene composed before decision 295. */
  scene?: GraphicScene
  /** The designer's code (decision 295): played in preference to a scene beside it. */
  code?: GraphicCode
  /** A chart's series, handed to its code as `props.data`. */
  data?: GraphicCodePayload['data']
  /** The library's marks, by title (`codeLogosFor`). */
  codeLogos?: CodeLogos
  /** What the Play button calls the design. */
  noun?: 'graphic' | 'chart'
  brand: BrandKitStored
  /** A scene's marks, by asset id. */
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

  // The code wins over a scene the brief still carries from before a
  // redesign (decision 295), as it does when the timeline is compiled.
  const design: GraphicDesign | null = code
    ? { kind: 'code', code, logos: codeLogos, ...(data ? { data } : {}) }
    : scene
      ? { kind: 'scene', scene }
      : null
  if (!design) return null

  if (!playing) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={play}>
          Play {noun}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <GraphicPlayerFrame
        key={portrait ? 'portrait' : 'landscape'}
        design={design}
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
