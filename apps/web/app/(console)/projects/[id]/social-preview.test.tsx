import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RESTING_SOCIAL_PROGRESS } from '@boom-busters/compositions/social'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { SocialPayload } from '@boom-busters/schemas'
import { SocialPreview } from './social-preview'

/**
 * The board's social preview (decision 284, spec 6): the render's own card
 * component, drawn at rest. The card itself is covered by the compositions
 * suite; here it is mocked so the test can see exactly what it was handed.
 */

const cardProps = vi.fn()
vi.mock('@boom-busters/compositions/social-card', () => ({
  SocialPostCard: (props: Record<string, unknown>) => {
    cardProps(props)
    return <div data-testid="social-card" />
  },
}))

const loadBrandFonts = vi.fn(() => Promise.resolve())
vi.mock('@boom-busters/compositions', () => ({
  loadBrandFonts: (...args: unknown[]) => loadBrandFonts(...(args as [])),
}))

/** Invented account: a fixture must never carry a real one. */
const payload: SocialPayload = {
  kind: 'social',
  platform: 'x',
  authorName: 'Dana Okafor',
  handle: 'DanaOkafor',
  text: 'The audit is finished and the $1.9 billion is not there.',
  cutBefore: false,
  cutAfter: false,
  postedAt: '2023-03-14',
  initials: 'DO',
  sourceLabel: 'x.com/DanaOkafor/status/1734567890123456789',
  sourceUrl: 'https://x.com/DanaOkafor/status/1734567890123456789',
  claimId: '01HQ00000000000000000000S1',
}

describe('SocialPreview', () => {
  it('draws the shared card at rest, with the payload, at the master frame', () => {
    render(<SocialPreview payload={payload} brand={DEFAULT_SETTINGS.brandKit} />)

    expect(screen.getByTestId('social-card')).toBeInTheDocument()
    expect(cardProps).toHaveBeenCalled()
    const props = cardProps.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(props['progress']).toEqual(RESTING_SOCIAL_PROGRESS)
    expect(props['payload']).toEqual(payload)
    expect(props['frame']).toEqual({ width: 1920, height: 1080 })
    expect(props['ImageComponent'] ?? 'img').toBe('img')
    expect((props['brand'] as { colors: { accent: string } }).colors.accent).toBe(
      DEFAULT_SETTINGS.brandKit.colors.accent,
    )
  })

  it('loads the brand fonts, as the Brand Kit specimen does', () => {
    render(<SocialPreview payload={payload} brand={DEFAULT_SETTINGS.brandKit} />)

    expect(loadBrandFonts).toHaveBeenCalledWith(DEFAULT_SETTINGS.brandKit.typography)
  })

  it('keeps the frame’s shape, portrait too', () => {
    render(
      <SocialPreview
        payload={payload}
        brand={DEFAULT_SETTINGS.brandKit}
        frame={{ width: 1080, height: 1920 }}
      />,
    )

    const box = screen.getByLabelText('Post card preview')
    expect(box.style.aspectRatio).toBe('1080 / 1920')
    const props = cardProps.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(props['frame']).toEqual({ width: 1080, height: 1920 })
  })
})
