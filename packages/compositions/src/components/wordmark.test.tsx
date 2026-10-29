import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import { EndCta } from './EndCta'
import { Watermark } from './Watermark'

// The two components only read the frame clock and the canvas from Remotion.
vi.mock('remotion', () => ({
  AbsoluteFill: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  Img: () => <span />,
  useCurrentFrame: () => 30,
  useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920 }),
}))

/**
 * The wordmark is the channel's name. A snapshot compiled before
 * `brand.identity` existed has none and keeps drawing "Boom & Busters", so
 * existing timelines render as they always did.
 */

const legacy = resolveBrandKit(DEFAULT_SETTINGS)
const other = resolveBrandKit(DEFAULT_SETTINGS, { name: 'Coin Cases', handle: '@coincases' })

describe('the channel wordmark', () => {
  it('falls back to Boom & Busters when the snapshot has no identity', () => {
    expect(renderToStaticMarkup(<Watermark brand={legacy} />)).toContain('Boom &amp; Busters')
    expect(renderToStaticMarkup(<EndCta text="Watch on" brand={legacy} />)).toContain(
      'Boom &amp; Busters',
    )
  })

  it('draws the channel name from the identity', () => {
    const watermark = renderToStaticMarkup(<Watermark brand={other} />)
    expect(watermark).toContain('Coin Cases')
    expect(watermark).not.toContain('Busters')
    const cta = renderToStaticMarkup(<EndCta text="Watch on" brand={other} />)
    expect(cta).toContain('Coin Cases')
    expect(cta).not.toContain('Busters')
  })
})
