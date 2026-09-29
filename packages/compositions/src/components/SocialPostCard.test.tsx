import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { SocialPayload } from '@boom-busters/schemas'
import { RESTING_SOCIAL_PROGRESS } from '../lib/social'
import { withAlpha } from './brand'
import { SocialPostCard } from './SocialPostCard'

/**
 * The pure card, tested with `react-dom/server` rather than a Remotion
 * harness (the component imports no `remotion`, per decision 284): the
 * board draws the same markup at rest that the render settles into.
 */

const brand = resolveBrandKit(DEFAULT_SETTINGS)
const WIDE = { width: 1920, height: 1080 }

const BASE_PAYLOAD: SocialPayload = {
  kind: 'social',
  platform: 'x',
  authorName: 'Dana Okafor',
  handle: 'danaokafor',
  text: 'Reminder that @KPMG confirmed the numbers this week.',
  cutBefore: false,
  cutAfter: true,
  postedAt: '2023-03-14',
  initials: 'DO',
  sourceLabel: 'x.com/danaokafor/status/1734567890123456789',
  sourceUrl: 'https://x.com/danaokafor/status/1734567890123456789',
  claimId: '01HQ00000000000000000000S1',
}

function render(payload: SocialPayload) {
  return renderToStaticMarkup(
    <SocialPostCard
      payload={payload}
      brand={brand}
      frame={WIDE}
      progress={RESTING_SOCIAL_PROGRESS}
    />,
  )
}

describe('SocialPostCard', () => {
  it('renders the author name', () => {
    expect(render(BASE_PAYLOAD)).toContain('Dana Okafor')
  })

  it('renders the handle and the published date', () => {
    expect(render(BASE_PAYLOAD)).toContain('@danaokafor · 14 March 2023')
  })

  it('draws the initials when there is no avatar', () => {
    const markup = render(BASE_PAYLOAD)
    expect(markup).toContain('DO')
    expect(markup).not.toContain('<img')
  })

  it('draws the initials in the accent colour on an accent-tinted disc (spec 8.4)', () => {
    const markup = render(BASE_PAYLOAD)
    expect(markup).toContain(`background-color:${withAlpha(brand.colors.accent, 0.18)}`)
    expect(markup).toMatch(new RegExp(`color:${brand.colors.accent}[^"]*">DO</span>`))
  })

  it('draws an image when there is an avatar', () => {
    const markup = render({
      ...BASE_PAYLOAD,
      avatar: { r2Key: 'boom-busters/avatars/fixture.png', url: 'https://example.com/avatar.png' },
    })
    expect(markup).toContain('<img')
    expect(markup).toContain('https://example.com/avatar.png')
  })

  it('adds an ellipsis at a cut', () => {
    expect(render(BASE_PAYLOAD)).toContain('…')
  })

  it('colours the mention in the accent colour', () => {
    const markup = render(BASE_PAYLOAD)
    expect(markup).toContain(`style="color:${brand.colors.accent}">@KPMG`)
  })

  it('renders the same markup twice for the same props, with no randomness', () => {
    expect(render(BASE_PAYLOAD)).toBe(render(BASE_PAYLOAD))
  })
})
