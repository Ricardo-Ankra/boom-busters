import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'

vi.mock('@remotion/player', () => ({
  Player: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ durationInFrames, compositionWidth, compositionHeight, inputProps }: any) => (
      <div data-testid="player">
        frames:{durationInFrames} size:{compositionWidth}x{compositionHeight} logos:
        {Object.keys(inputProps.payload.logos).join(',')}
      </div>
    ),
    { displayName: 'Player' },
  ),
}))
vi.mock('@boom-busters/compositions', () => ({
  GraphicCard: () => null,
  loadBrandFonts: () => Promise.resolve(),
}))

import { GraphicPlayback } from './graphic-player'
import { GraphicPlaybackProvider } from './graphic-playback'

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

describe('GraphicPlayback (decision 289)', () => {
  it('mounts the player only when Play graphic is pressed, at the slot length', async () => {
    render(<GraphicPlaybackProvider>{card('s1')}</GraphicPlaybackProvider>)
    expect(screen.queryByTestId('player')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    expect(await screen.findByTestId('player')).toHaveTextContent(
      'frames:180 size:960x540 logos:l1',
    )
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
})
