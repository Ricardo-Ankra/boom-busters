import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MasterAnalytics } from '@/lib/publish-review'
import { RetentionOverlay } from './retention-overlay'

/**
 * The one picture M8 owes the project page: the watch-ratio curve with the
 * video's own chapter boundaries on it, and an honest line while YouTube has
 * not produced a curve yet.
 */

const analytics: MasterAnalytics = {
  videoId: 'yt-master-1',
  snapshotDateIso: '2026-08-27T00:00:00.000Z',
  views: 15_320,
  avgViewDurationSec: 372,
  retentionCurve: [
    { pct: 0, ratio: 0.96 },
    { pct: 25, ratio: 0.72 },
    { pct: 50, ratio: 0.55 },
    { pct: 75, ratio: 0.41 },
    { pct: 95, ratio: 0.3 },
  ],
}

const chapters = [
  { title: 'The audit', startMs: 0 },
  { title: 'The collapse', startMs: 300_000 },
  { title: 'The trial', startMs: 600_000 },
]

describe('RetentionOverlay', () => {
  it('draws the curve with one boundary per chapter, and names them', () => {
    render(<RetentionOverlay analytics={analytics} chapters={chapters} durationMs={900_000} />)

    expect(
      screen.getByRole('img', { name: 'Retention curve with 3 chapter boundaries' }),
    ).toBeInTheDocument()
    expect(screen.getByText('The collapse')).toBeInTheDocument()
    // The header carries the topline numbers and the snapshot's freshness.
    expect(screen.getByText(/15,320 views/)).toBeInTheDocument()
    expect(screen.getByText(/6m12s average view/)).toBeInTheDocument()
    expect(screen.getByText(/snapshot 2026-08-27/)).toBeInTheDocument()
  })

  it('says plainly when YouTube has no curve yet, instead of an empty chart', () => {
    render(
      <RetentionOverlay
        analytics={{ ...analytics, retentionCurve: [] }}
        chapters={chapters}
        durationMs={900_000}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/no retention curve for this video yet/)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
