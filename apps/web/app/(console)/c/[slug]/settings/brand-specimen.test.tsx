import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, SettingsSchema } from '@boom-busters/schemas'
import type { GraphicCodePayload } from '@boom-busters/schemas'
import type { ReelPiece } from '@/lib/specimen-reel'
import { BrandSpecimenPanel } from './brand-specimen'

/**
 * The specimen panel's contract: the Player runs the CURRENT brand tokens
 * over the channel's package reel. The Player itself is mocked, since jsdom
 * has no frames to draw.
 */

vi.mock('@remotion/player', () => ({
  Player: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ durationInFrames, inputProps, compositionWidth, compositionHeight }: any) => (
      <div data-testid="player">
        frames:{durationInFrames} size:{compositionWidth}x{compositionHeight} accent:
        {inputProps.brand.colors.accent}
      </div>
    ),
    { displayName: 'Player' },
  ),
}))
vi.mock('remotion', () => ({ AbsoluteFill: () => null, Sequence: () => null }))
vi.mock('@boom-busters/compositions', () => ({
  GraphicCode: () => null,
  KaraokeCaptions: () => null,
  loadBrandFonts: () => Promise.resolve(),
}))

function payload(durationMs: number): GraphicCodePayload {
  return {
    kind: 'graphic-code',
    version: 1,
    compiled: 'x',
    title: 't',
    words: [],
    durationMs,
    logos: {},
    claimIds: [],
  }
}

const REEL: ReelPiece[] = [
  { technique: 'chapter-title', label: 'Chapter card', source: 'channel', payload: payload(4000) },
  { technique: 'lower-third', label: 'Lower third', source: 'house', payload: payload(3000) },
  { technique: 'bar-chart', label: 'Chart', source: 'house', issue: 'bad import' },
]

const settings = () => SettingsSchema.parse(DEFAULT_SETTINGS)

describe('BrandSpecimenPanel', () => {
  it('plays the playable pieces only in landscape, with the brand accent', () => {
    render(<BrandSpecimenPanel settings={settings()} reel={REEL} />)
    const player = screen.getByTestId('player')
    expect(player).toHaveTextContent('frames:210') // 4s + 3s at 30 fps
    expect(player).toHaveTextContent('size:1920x1080')
    expect(player).toHaveTextContent(`accent:${settings().brandKit.colors.accent}`)
    expect(screen.getByRole('button', { name: 'Landscape 16:9' })).toBeInTheDocument()
  })

  it('adds the captions beat in portrait', () => {
    render(<BrandSpecimenPanel settings={settings()} reel={REEL} />)
    fireEvent.click(screen.getByRole('button', { name: 'Portrait 9:16' }))
    const player = screen.getByTestId('player')
    expect(player).toHaveTextContent('frames:300') // plus a 3 s captions beat
    expect(player).toHaveTextContent('size:1080x1920')
    expect(screen.getByText(/Captions \(Shorts only\)/)).toBeInTheDocument()
  })

  it('says which version drew each piece and why one could not play', () => {
    render(<BrandSpecimenPanel settings={settings()} reel={REEL} />)
    expect(screen.getByText('Chapter card · channel version')).toBeInTheDocument()
    expect(screen.getByText('Lower third · house design')).toBeInTheDocument()
    expect(screen.getByText('Chart · could not compile: bad import')).toBeInTheDocument()
  })

  it('re-renders live when a colour changes', () => {
    const edited = structuredClone(settings())
    edited.brandKit.colors.accent = '#ff0055'
    const { rerender } = render(<BrandSpecimenPanel settings={settings()} reel={REEL} />)
    rerender(<BrandSpecimenPanel settings={edited} reel={REEL} />)
    expect(screen.getByTestId('player')).toHaveTextContent('accent:#ff0055')
  })
})
