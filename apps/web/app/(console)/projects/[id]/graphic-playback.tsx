'use client'

import * as React from 'react'

/**
 * Which graphic is playing on the board (decision 289). Kept apart from the
 * player so the board can import the provider statically without pulling
 * `@remotion/player` and the composition library into its first load.
 */

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
