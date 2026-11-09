import { buildSearchReport, DEFAULT_RESEARCH_THRESHOLDS } from '@boom-busters/schemas'
import type { Checkpoint, SearchReport } from '@boom-busters/schemas'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchReportsModel } from '@/lib/publish-review'
import { SearchReportCard } from './search-report-card'

/**
 * The Search report card (publish screen): checkpoint buttons, the outcome,
 * the term lists, the delivery numbers against their baselines and the rank
 * check. Every action is a visible labelled button.
 */

const checkRankAction = vi.fn()
const dismissTermAction = vi.fn()
const addTermToKeywordsAction = vi.fn()
vi.mock('./search-report-actions', () => ({
  checkRankAction: (...args: unknown[]) => checkRankAction(...args),
  dismissTermAction: (...args: unknown[]) => dismissTermAction(...args),
  addTermToKeywordsAction: (...args: unknown[]) => addTermToKeywordsAction(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

beforeEach(() => {
  vi.clearAllMocks()
  checkRankAction.mockResolvedValue({ ok: true, position: 4, keyword: 'enron collapse' })
  dismissTermAction.mockResolvedValue({ ok: true })
  addTermToKeywordsAction.mockResolvedValue({ ok: true, message: 'Added to the Main keywords.' })
})

const PROJECT = '01J0000000000000000000000A'
const PUBLISHED = '2026-10-01T15:00:00.000Z'

const term = (
  name: string,
  views: number,
  minutes: number,
  bucket: 'target' | 'researched' | 'unresearched' | 'unmatched',
  reason?: string,
) => ({ term: name, views, minutes, bucket, ...(reason ? { reason } : {}) })

function report(
  checkpoint: Checkpoint,
  overrides: Partial<Parameters<typeof buildSearchReport>[0]> = {},
): SearchReport {
  return buildSearchReport({
    checkpoint,
    range: { start: '2026-10-01', end: '2026-10-29' },
    publishedAt: PUBLISHED,
    durationSec: 900,
    views: 5_000,
    searchViews: 1_200,
    avgViewDurationSec: 300,
    subscribersGained: 20,
    likes: 150,
    comments: 12,
    retentionCurve: null,
    terms: [
      term('enron collapse', 400, 2_000, 'target'),
      term('enron documentary', 100, 150, 'researched'),
      // 200 views at a 30 s hold: below 0.8 x the 300 s baseline.
      term('worldcom fraud', 200, 100, 'unresearched', 'a different scandal'),
      // 100 views at 600 s hold: good.
      term('accounting tricks', 100, 1_000, 'unresearched'),
      term('arthur andersen', 50, 20, 'unmatched'),
    ],
    targetKeyword: 'enron collapse',
    matching: 'full',
    rank: null,
    baselineInputs: {
      holdBand: [300, 300, 300, 300],
      holdChannel: [],
      dropBand: [0.3, 0.3, 0.3, 0.3],
      dropChannel: [],
      subsBand: [4, 4, 4, 4],
      subsChannel: [],
    },
    thresholds: DEFAULT_RESEARCH_THRESHOLDS,
    now: new Date('2026-11-02T06:00:00Z'),
    ...overrides,
  })
}

function reports(overrides: Partial<SearchReportsModel> = {}): SearchReportsModel {
  return {
    frozen: [],
    live: null,
    rankChecks: [],
    dismissed: [],
    language: 'en',
    publishedAt: PUBLISHED,
    ...overrides,
  }
}

function live(overrides: Partial<Parameters<typeof buildSearchReport>[0]> = {}): SearchReport {
  return report(7, {
    range: { start: '2026-10-01', end: '2026-11-09' },
    matching: 'none',
    baselineInputs: {
      holdBand: [],
      holdChannel: [],
      dropBand: [],
      dropChannel: [],
      subsBand: [],
      subsChannel: [],
    },
    terms: [term('enron collapse', 400, 800, 'target'), term('odd search', 50, 20, 'unmatched')],
    ...overrides,
  })
}

describe('SearchReportCard', () => {
  it('shows the frozen day 28 report by default once it exists, else Latest', () => {
    const { unmount } = render(
      <SearchReportCard
        projectId={PROJECT}
        reports={reports({ live: live(), frozen: [report(7)] })}
      />,
    )
    // Only day 7 is frozen, so the card opens on Latest: no verdict.
    expect(screen.getByText('Live numbers, not a verdict')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'true')
    unmount()

    render(
      <SearchReportCard
        projectId={PROJECT}
        reports={reports({ live: live(), frozen: [report(7), report(28)] })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Day 28' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Hit and held')).toBeInTheDocument()
    expect(screen.queryByText('Live numbers, not a verdict')).not.toBeInTheDocument()
  })

  it('says too early to judge on Latest before any report has frozen', () => {
    render(<SearchReportCard projectId={PROJECT} reports={reports({ live: live() })} />)
    expect(screen.getByText('Too early to judge')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to channel keywords' })).toBeNull()
  })

  it('switches to another frozen checkpoint with its own button', async () => {
    const user = userEvent.setup()
    render(
      <SearchReportCard
        projectId={PROJECT}
        reports={reports({ live: live(), frozen: [report(7), report(28)] })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Day 7' }))
    expect(screen.getByRole('button', { name: 'Day 7' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/2026-10-01 to 2026-10-29/)).toBeInTheDocument()
  })

  it('labels whole-video and all-viewers numbers', () => {
    render(<SearchReportCard projectId={PROJECT} reports={reports({ frozen: [report(28)] })} />)
    expect(screen.getByText(/Early drop \(all viewers\)/)).toBeInTheDocument()
    expect(screen.getByText(/Subscribers per 1,000 views \(whole video\)/)).toBeInTheDocument()
    expect(screen.getByText(/Likes per 1,000 views \(whole video\)/)).toBeInTheDocument()
    expect(screen.getByText(/Comments per 1,000 views \(whole video\)/)).toBeInTheDocument()
    expect(
      screen.getByText(/YouTube lists the top 25 search terms and hides rare ones/),
    ).toBeTruthy()
  })

  it('words each baseline basis with the count the freeze used', () => {
    const { unmount } = render(
      <SearchReportCard projectId={PROJECT} reports={reports({ frozen: [report(28)] })} />,
    )
    // holdBand, dropBand and subsBand all hold four values in the fixture.
    expect(screen.getAllByText(/against 4 videos of similar length/).length).toBe(3)
    unmount()

    // The three inputs differ in length: each row prints its own count and group.
    const mixed = report(28, {
      baselineInputs: {
        holdBand: [300, 300, 300, 300, 300],
        holdChannel: [],
        dropBand: [],
        dropChannel: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
        subsBand: [4, 4, 4],
        subsChannel: [],
      },
    })
    const second = render(
      <SearchReportCard projectId={PROJECT} reports={reports({ frozen: [mixed] })} />,
    )
    const rowOf = (label: RegExp) => screen.getByText(label)
    expect(rowOf(/Search hold \(search viewers\)/)).toHaveTextContent(
      'against 5 videos of similar length',
    )
    expect(rowOf(/Early drop \(all viewers\)/)).toHaveTextContent('against all 7 earlier videos')
    expect(rowOf(/Subscribers per 1,000 views/)).toHaveTextContent(
      'against 3 videos of similar length',
    )
    second.unmount()

    // A report frozen before counts were kept words it without a number.
    const older = report(28)
    const stripped = {
      ...older,
      baselines: {
        searchHoldSec: { value: 300, basis: 'band' as const },
        earlyDrop: { value: 0.3, basis: 'channel' as const },
        subscribersPer1k: { value: 4, basis: 'band' as const },
      },
    }
    const third = render(
      <SearchReportCard projectId={PROJECT} reports={reports({ frozen: [stripped] })} />,
    )
    expect(rowOf(/Search hold/)).toHaveTextContent('against videos of similar length')
    expect(rowOf(/Early drop/)).toHaveTextContent('against all earlier videos')
    third.unmount()

    render(<SearchReportCard projectId={PROJECT} reports={reports({ live: live() })} />)
    expect(screen.getAllByText(/against this video's own average/).length).toBeGreaterThan(0)
  })

  it('disables a checkpoint button until it has frozen and names its due day', () => {
    render(
      <SearchReportCard
        projectId={PROJECT}
        reports={reports({ live: live(), frozen: [report(7)] })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Day 7' })).toBeEnabled()
    const day28 = screen.getByRole('button', { name: 'Day 28' })
    expect(day28).toBeDisabled()
    // Publish day 1 Oct + 28 + 3 lag days = 1 Nov 2026.
    expect(day28).toHaveAttribute('title', 'Due 1 Nov 2026')
    expect(screen.getByRole('button', { name: 'Day 90' })).toHaveAttribute(
      'title',
      'Due 2 Jan 2027',
    )
  })

  it('offers Add to channel keywords and Not for us only on unresearched terms that held', async () => {
    const user = userEvent.setup()
    render(<SearchReportCard projectId={PROJECT} reports={reports({ frozen: [report(28)] })} />)
    // Hold baseline 300 s x 0.8 = 240 s: "accounting tricks" held at 600 s, "worldcom fraud" at 30 s.
    expect(screen.getAllByRole('button', { name: 'Add to channel keywords' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Not for us' })).toHaveLength(1)
    const row = screen.getByText('accounting tricks').closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Add to channel keywords' }))
    expect(addTermToKeywordsAction).toHaveBeenCalledWith(PROJECT, 'accounting tricks')
    expect(await screen.findByText('Added to the Main keywords.')).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: 'Not for us' }))
    expect(dismissTermAction).toHaveBeenCalledWith(PROJECT, 'accounting tricks')
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the reason on an unresearched term', () => {
    render(<SearchReportCard projectId={PROJECT} reports={reports({ frozen: [report(28)] })} />)
    expect(screen.getByText(/a different scandal/)).toBeInTheDocument()
  })

  it('hides dismissed terms', () => {
    render(
      <SearchReportCard
        projectId={PROJECT}
        reports={reports({ frozen: [report(28)], dismissed: ['accounting trick'] })}
      />,
    )
    expect(screen.queryByText('accounting tricks')).not.toBeInTheDocument()
    expect(screen.getByText('worldcom fraud')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to channel keywords' })).toBeNull()
  })

  it('Check where it ranks calls the action and shows the new position', async () => {
    const user = userEvent.setup()
    render(
      <SearchReportCard
        projectId={PROJECT}
        reports={reports({
          frozen: [report(28)],
          rankChecks: [
            { keyword: 'enron collapse', position: null, checkedAt: '2026-11-01T08:00:00.000Z' },
          ],
        })}
      />,
    )
    // The earlier manual check is listed with its date, keyword and position.
    expect(screen.getAllByText(/1 Nov 2026/)).toHaveLength(2)
    expect(screen.getByText(/^Latest manual check, 1 Nov 2026:/)).toBeInTheDocument()
    expect(screen.getAllByText(/Not in the top 10 for enron collapse/)).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Check where it ranks (5 credits)' }))
    expect(checkRankAction).toHaveBeenCalledWith(PROJECT)
    expect(await screen.findByText('Ranked 4 for enron collapse')).toBeInTheDocument()
  })

  it('shows the action error when the rank check is refused', async () => {
    const user = userEvent.setup()
    checkRankAction.mockResolvedValue({
      ok: false,
      error: 'The monthly VidIQ credit cap is reached.',
    })
    render(<SearchReportCard projectId={PROJECT} reports={reports({ frozen: [report(28)] })} />)
    await user.click(screen.getByRole('button', { name: 'Check where it ranks (5 credits)' }))
    expect(await screen.findByText('The monthly VidIQ credit cap is reached.')).toBeInTheDocument()
  })

  it('prints no baseline for early drop and subscribers that are the video itself', () => {
    const ownBaselines = report(28, {
      baselineInputs: {
        holdBand: [],
        holdChannel: [],
        dropBand: [],
        dropChannel: [],
        subsBand: [],
        subsChannel: [],
      },
    })
    render(<SearchReportCard projectId={PROJECT} reports={reports({ frozen: [ownBaselines] })} />)
    expect(screen.getByText(/Early drop \(all viewers\)/)).not.toHaveTextContent('baseline')
    expect(screen.getByText(/Subscribers per 1,000 views/)).not.toHaveTextContent('baseline')
    // Hold keeps its own-basis fallback.
    expect(screen.getByText(/Search hold \(search viewers\)/)).toHaveTextContent(
      "against this video's own average",
    )
  })

  it('shows each group views and hold in its header', () => {
    render(<SearchReportCard projectId={PROJECT} reports={reports({ frozen: [report(28)] })} />)
    // Target: 400 views, 2,000 minutes: 300 s hold.
    expect(screen.getByText('The target')).toHaveTextContent('400 views · 300 s hold')
  })

  it('says why a frozen report has no rank, and dates the manual check in its place', () => {
    const skipped = (reason: string) => report(28, { rankSkipped: reason, rank: null })
    const manual = [
      { keyword: 'enron collapse', position: 6, checkedAt: '2026-11-12T10:00:00.000Z' },
    ]
    const cases: [string, string][] = [
      ['credit cap', 'Rank not checked: the monthly VidIQ credit cap was reached'],
      ['rank check failed', 'Rank not checked: the check failed'],
      [
        'too late for a day-28 rank',
        'Rank not checked: the report was made too late for a day-28 rank',
      ],
    ]
    for (const [reason, words] of cases) {
      const { unmount } = render(
        <SearchReportCard
          projectId={PROJECT}
          reports={reports({ frozen: [skipped(reason)], rankChecks: manual })}
        />,
      )
      expect(screen.getByText(words)).toBeInTheDocument()
      expect(
        screen.getByText('Latest manual check, 12 Nov 2026: Ranked 6 for enron collapse'),
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('has nothing to show without any numbers', () => {
    const { container } = render(<SearchReportCard projectId={PROJECT} reports={reports()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
