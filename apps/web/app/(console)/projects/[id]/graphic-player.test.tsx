import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'

/** The Player's ref handle, as the board drives it, with every call recorded. */
const handle = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>()
  return {
    listeners,
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    isPlaying: vi.fn(() => false),
    addEventListener: (name: string, callback: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name)!.add(callback)
    },
    removeEventListener: (name: string, callback: () => void) => {
      listeners.get(name)?.delete(callback)
    },
  }
})
const fire = (name: 'play' | 'pause' | 'ended') =>
  act(() => {
    for (const callback of [...(handle.listeners.get(name) ?? [])]) callback()
  })

/** Every Player render's component and props, newest last. */
const played = vi.hoisted(() => vi.fn())

/** Counts how many times the heavy module is evaluated: not until Play is pressed. */
const loads = vi.hoisted(() => ({ count: 0 }))
vi.mock('./graphic-player', async (importActual) => {
  loads.count += 1
  return importActual()
})

vi.mock('@remotion/player', () => ({
  Player: Object.assign(
    React.forwardRef(function MockPlayer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { component, durationInFrames, compositionWidth, compositionHeight, inputProps }: any,
      ref,
    ) {
      React.useImperativeHandle(ref, () => handle as never)
      played({ component, inputProps })
      return (
        <div data-testid="player">
          frames:{durationInFrames} size:{compositionWidth}x{compositionHeight} logos:
          {Object.keys(inputProps.payload.logos).join(',')}
        </div>
      )
    }),
    { displayName: 'Player' },
  ),
}))
vi.mock('@boom-busters/compositions', () => ({
  GraphicCard: () => null,
  GraphicCode: () => null,
  loadBrandFonts: () => Promise.resolve(),
  msToFrames: (ms: number, fps: number) => Math.round((ms * fps) / 1000),
}))

import { GraphicCode } from '@boom-busters/compositions'

import { GraphicPlayback, GraphicPlaybackProvider } from './graphic-playback'

const SCENE = {
  elements: [
    {
      kind: 'logo' as const,
      id: 'l1',
      cell: { col: 0, row: 0, colSpan: 4, rowSpan: 4 },
      entity: 'Acme',
      assetId: 'A1',
      enter: { kind: 'fade' as const, atMs: 0 },
    },
  ],
}
const card = (slotId: string) => (
  <GraphicPlayback
    slotId={slotId}
    scene={SCENE}
    brand={DEFAULT_SETTINGS.brandKit}
    logoUrls={{ A1: 'https://r2.example/acme.png' }}
    durationMs={6000}
  />
)

beforeEach(() => {
  vi.clearAllMocks()
  handle.listeners.clear()
  handle.isPlaying.mockReturnValue(true)
})

describe('GraphicPlayback (decision 289)', () => {
  it('mounts the player only when Play graphic is pressed, at the slot length', async () => {
    render(<GraphicPlaybackProvider>{card('s1')}</GraphicPlaybackProvider>)
    expect(screen.queryByTestId('player')).toBeNull()
    // The player chunk is not fetched until the first press.
    expect(loads.count).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    expect(await screen.findByTestId('player')).toHaveTextContent(
      'frames:180 size:960x540 logos:l1',
    )
    expect(loads.count).toBe(1)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument()
  })

  it('plays the portrait frame on Portrait', async () => {
    render(<GraphicPlaybackProvider>{card('s1')}</GraphicPlaybackProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    await userEvent.click(screen.getByRole('button', { name: 'Portrait' }))
    expect(await screen.findByTestId('player')).toHaveTextContent('size:540x960')
    expect(screen.getByRole('button', { name: 'Landscape' })).toBeInTheDocument()
  })

  it('plays one graphic at a time', async () => {
    render(
      <GraphicPlaybackProvider>
        {card('s1')}
        {card('s2')}
      </GraphicPlaybackProvider>,
    )
    const [first, second] = screen.getAllByRole('button', { name: 'Play graphic' })
    await userEvent.click(first!)
    await userEvent.click(second!)
    expect(screen.getAllByTestId('player')).toHaveLength(1)
  })

  it('plays on its own outside a provider, and Close player stops it', async () => {
    render(card('s1'))
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    expect(await screen.findByTestId('player')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close player' }))
    expect(screen.queryByTestId('player')).toBeNull()
    expect(screen.getByRole('button', { name: 'Play graphic' })).toBeInTheDocument()
  })

  it('Pause pauses the player, and the Player pausing shows Play', async () => {
    render(card('s1'))
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(handle.pause).toHaveBeenCalledTimes(1)
    fire('pause')
    await userEvent.click(await screen.findByRole('button', { name: 'Play' }))
    expect(handle.play).toHaveBeenCalledTimes(1)
    fire('play')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('shows Play when the clip ends by itself', async () => {
    render(card('s1'))
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    fire('ended')
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('Replay seeks to the start, then plays', async () => {
    render(card('s1'))
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(handle.seekTo).toHaveBeenCalledWith(0)
    expect(handle.play).toHaveBeenCalled()
    expect(handle.seekTo.mock.invocationCallOrder[0]).toBeLessThan(
      handle.play.mock.invocationCallOrder[0]!,
    )
  })

  it('reads Pause on the new frame after pausing then switching to Portrait', async () => {
    render(card('s1'))
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    fire('pause')
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument()
    // The remounted frame autoPlays; it reports itself playing.
    handle.isPlaying.mockReturnValue(false)
    await userEvent.click(screen.getByRole('button', { name: 'Portrait' }))
    fire('play')
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })
})

/** A design written as code (decision 295). Plain JS: the source is its own compiled form. */
const CODE_SOURCE = "function Graphic(props) { return props.logos['Acme'] ? null : null }"
const CODE = {
  version: 1 as const,
  source: CODE_SOURCE,
  compiled: CODE_SOURCE,
  title: 'Acme, counted up',
  facts: [],
  words: [{ text: 'four', atMs: 300 }],
  durationMs: 6000,
}
const ACME = { assetId: 'A1', url: 'https://r2.example/acme.png', width: 400, height: 200 }
const DATA = {
  series: [
    {
      label: 'Share price',
      unit: 'EUR',
      points: [
        { x: '2020-06-17', y: 104.5 },
        { x: '2020-06-26', y: 1.28 },
      ],
    },
  ],
  takeaway: 'From €104 to €1.28 in nine days.',
}

describe('GraphicPlayback with code (decision 295)', () => {
  it('plays the code on GraphicCode in the full frame, its marks keyed by title', async () => {
    render(
      <GraphicPlayback
        slotId="s1"
        code={CODE}
        codeLogos={{ Acme: ACME }}
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{}}
        durationMs={6000}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    // The frame the dry run checked the code in; the Player scales it to the card.
    expect(await screen.findByTestId('player')).toHaveTextContent(
      'frames:180 size:1920x1080 logos:Acme',
    )
    expect(played).toHaveBeenLastCalledWith({
      component: GraphicCode,
      inputProps: {
        payload: {
          kind: 'graphic-code',
          version: 1,
          compiled: CODE_SOURCE,
          title: 'Acme, counted up',
          words: CODE.words,
          durationMs: 6000,
          logos: { Acme: { r2Key: 'logos/A1', url: ACME.url, width: 400, height: 200 } },
          claimIds: [],
        },
        brand: expect.objectContaining({ colors: expect.any(Object) }),
        durationInFrames: 180,
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Portrait' }))
    expect(await screen.findByTestId('player')).toHaveTextContent('size:1080x1920')
  })

  it('plays the code when the brief still carries the scene it replaced', async () => {
    render(
      <GraphicPlayback
        slotId="s1"
        scene={SCENE}
        code={CODE}
        codeLogos={{}}
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{ A1: 'https://r2.example/acme.png' }}
        durationMs={6000}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    await screen.findByTestId('player')
    expect(played).toHaveBeenLastCalledWith(expect.objectContaining({ component: GraphicCode }))
  })

  it('names a chart on its button, and hands its code the series', async () => {
    render(
      <GraphicPlayback
        slotId="s1"
        code={CODE}
        data={DATA}
        noun="chart"
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{}}
        durationMs={6000}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Play chart' }))
    await screen.findByTestId('player')
    expect(played).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inputProps: expect.objectContaining({
          payload: expect.objectContaining({ kind: 'graphic-code', data: DATA }),
        }),
      }),
    )
  })

  it('offers nothing to play without a scene or code', () => {
    const { container } = render(
      <GraphicPlayback
        slotId="s1"
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{}}
        durationMs={6000}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
