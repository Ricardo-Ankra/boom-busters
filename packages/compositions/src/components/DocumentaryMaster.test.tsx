import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TimelineSlot } from '@boom-busters/schemas'
import { FIXTURE_BRAND } from '../fixtures/timeline'
import { GRADE_FILTER, SlotView } from './DocumentaryMaster'

describe('GRADE_FILTER (decision 287)', () => {
  it('leaves an ungraded film alone', () => {
    expect(GRADE_FILTER.none).toBeUndefined()
  })

  it('mutes photographs, and strong goes further', () => {
    expect(GRADE_FILTER.muted).toMatch(/saturate\(0\.\d+\)/)
    const sat = (f: string | undefined) => Number(/saturate\(([\d.]+)\)/.exec(f ?? '')?.[1])
    expect(sat(GRADE_FILTER.strong)).toBeLessThan(sat(GRADE_FILTER.muted))
  })
})

/**
 * `SlotView` reads `useCurrentFrame`/`useVideoConfig`, which only resolve
 * inside a mounted composition; the two are stubbed here rather than
 * bundling the whole master through headless Chrome for a check that is
 * really about one inline style. The three payload renderers are mocked
 * out too — this suite is about the wrapper around them, not their own
 * markup, which the snapshot suite already renders for real.
 */
vi.mock('remotion', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useCurrentFrame: () => 0,
    useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 120 }),
  }
})
vi.mock('./KenBurnsImage', () => ({ KenBurnsImage: () => <div data-testid="image" /> }))
vi.mock('./StockClip', () => ({ StockClip: () => <div data-testid="video" /> }))
vi.mock('./ChartReveal', () => ({ ChartReveal: () => <div data-testid="chart" /> }))

const IMAGE_SLOT: TimelineSlot = {
  type: 'stock',
  startMs: 0,
  durationMs: 4000,
  transition: 'cut',
  motion: { kind: 'kenburns', direction: 'in', intensity: 0.1 },
  payload: { kind: 'image', src: { r2Key: 'x', url: 'https://example.com/image.png' } },
}

const VIDEO_SLOT: TimelineSlot = {
  type: 'stock',
  startMs: 0,
  durationMs: 4000,
  transition: 'cut',
  motion: { kind: 'static' },
  payload: {
    kind: 'video',
    src: { r2Key: 'y', url: 'https://example.com/clip.mp4' },
    muted: true,
  },
}

const CHART_SLOT: TimelineSlot = {
  type: 'chart',
  startMs: 0,
  durationMs: 4000,
  transition: 'cut',
  motion: { kind: 'draw-on' },
  payload: {
    kind: 'chart',
    chartKind: 'line',
    series: [
      {
        label: 'Share price',
        unit: '€',
        points: [
          { x: 'a', y: 1 },
          { x: 'b', y: 2 },
        ],
      },
    ],
    dataRefs: ['01HQ00000000000000000000AA'],
    takeaway: 'Nine days.',
    reveal: 'draw-on',
  },
}

describe('SlotView grade wrapper (spec §10, decision 287 final review)', () => {
  // `resolveBrandKit` already defaults an unset preset to 'muted', so the
  // fixture brand is graded as it stands.
  const gradedBrand = FIXTURE_BRAND
  const ungradedBrand = {
    ...FIXTURE_BRAND,
    look: { ...FIXTURE_BRAND.look, gradePreset: undefined },
  }

  it('wraps an image slot in the grade filter', () => {
    const markup = renderToStaticMarkup(<SlotView slot={IMAGE_SLOT} brand={gradedBrand} />)
    expect(markup).toContain(`filter:${GRADE_FILTER.muted}`)
  })

  it('wraps a video slot in the grade filter', () => {
    const markup = renderToStaticMarkup(<SlotView slot={VIDEO_SLOT} brand={gradedBrand} />)
    expect(markup).toContain(`filter:${GRADE_FILTER.muted}`)
  })

  it('never grades a chart', () => {
    const markup = renderToStaticMarkup(<SlotView slot={CHART_SLOT} brand={gradedBrand} />)
    expect(markup).not.toContain('filter:')
  })

  it('carries no filter on any slot once the brand sets no grade', () => {
    for (const slot of [IMAGE_SLOT, VIDEO_SLOT, CHART_SLOT]) {
      const markup = renderToStaticMarkup(<SlotView slot={slot} brand={ungradedBrand} />)
      expect(markup).not.toContain('filter:')
    }
  })
})
