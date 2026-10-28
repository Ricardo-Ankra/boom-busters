import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, SettingsSchema } from '@boom-busters/schemas'
import { BrandSpecimenPanel, SPECIMEN_DURATION_FRAMES } from './brand-specimen'

/**
 * The specimen panel's contract: the Player runs the CURRENT brand tokens.
 * The Player itself is mocked — jsdom has no frames to draw; the components
 * it would mount are covered by the compositions snapshot suite.
 */

vi.mock('@remotion/player', () => ({
  Player: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ durationInFrames, inputProps }: any) => (
      <div data-testid="player">
        frames:{durationInFrames} accent:{inputProps.brand.colors.accent} voice:
        {inputProps.brand.voice.provider}
      </div>
    ),
    { displayName: 'Player' },
  ),
}))
vi.mock('remotion', () => ({ AbsoluteFill: () => null, Sequence: () => null }))
vi.mock('@boom-busters/compositions', () => ({
  ChapterCard: () => null,
  ChartReveal: () => null,
  KaraokeCaptions: () => null,
  LowerThird: () => null,
  loadBrandFonts: () => Promise.resolve(),
}))

describe('BrandSpecimenPanel', () => {
  it('hands the resolved brand — colours and all — to the player', () => {
    const settings = SettingsSchema.parse(DEFAULT_SETTINGS)
    render(<BrandSpecimenPanel settings={settings} />)

    const player = screen.getByTestId('player')
    expect(player).toHaveTextContent(`frames:${SPECIMEN_DURATION_FRAMES}`)
    expect(player).toHaveTextContent(`accent:${settings.brandKit.colors.accent}`)
    // `resolveBrandKit` projected the narration voice in — the specimen runs
    // the same shape a compiled timeline snapshots.
    expect(player).toHaveTextContent(`voice:${settings.tts.provider}`)
  })

  it('re-renders live when a colour changes, and names the active variants', () => {
    const settings = SettingsSchema.parse(DEFAULT_SETTINGS)
    const edited = structuredClone(settings)
    edited.brandKit.colors.accent = '#ff0055'

    const { rerender } = render(<BrandSpecimenPanel settings={settings} />)
    rerender(<BrandSpecimenPanel settings={edited} />)

    expect(screen.getByTestId('player')).toHaveTextContent('accent:#ff0055')
    expect(
      screen.getByText(
        new RegExp(`chapter card \\(${settings.brandKit.look.chapterCardVariant}\\)`, 'i'),
      ),
    ).toBeInTheDocument()
  })
})
