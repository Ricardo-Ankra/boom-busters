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

  it('words each baseline basis', () => {
    const peers = { 28: { band: 4, channel: 6 } }
    const { unmount } = render(
      <SearchReportCard projectId={PROJECT} reports={reports({ frozen: [report(28)], peers })} />,
    )
    expect(screen.getAllByText(/against 4 videos of similar length/).length).toBeGreaterThan(0)
    unmount()

    const channelOnly = report(28, {
      baselineInputs: {
        holdBand: [],
        holdChannel: [300, 300, 300],
        dropBand: [],
        dropChannel: [0.3, 0.3, 0.3],
        subsBand: [],
        subsChannel: [4, 4, 4],
      },
    })
    const second = render(
      <SearchReportCard
        projectId={PROJECT}
        reports={reports({ frozen: [channelOnly], peers: { 28: { band: 0, channel: 2 } } })}
      />,
    )
    expect(screen.getAllByText(/against all 2 earlier videos/).length).toBeGreaterThan(0)
    second.unmount()

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
    expect(screen.getByText(/1 Nov 2026/)).toBeInTheDocument()
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

  it('has nothing to show without any numbers', () => {
    const { container } = render(<SearchReportCard projectId={PROJECT} reports={reports()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
