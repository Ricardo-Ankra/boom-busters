import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
import { DEFAULT_RESEARCH_THRESHOLDS } from '@boom-busters/schemas'
import type { FieldResult, SearchBrief } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WhoRanks } from './who-ranks'

/** The Who ranks now block: the top ten for the target, the other candidates behind a toggle. */

const actions = vi.hoisted(() => ({ checkWhoRanksAction: vi.fn() }))
vi.mock('./actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const CASE_ID = '01J0000000000000000000000A'
const CHECKED_AT = '2026-11-04T10:00:00.000Z'
const grouped = (n: number) => new Intl.NumberFormat('en-US').format(n)

const result = (overrides: Partial<FieldResult>): FieldResult => ({
  videoId: 'v1',
  title: 'A title',
  channelTitle: 'Small Channel',
  subscribers: 5000,
  views: 45_000,
  publishedAt: '2024-11-04T10:00:00.000Z',
  seconds: 725,
  ...overrides,
})

function brief(overrides: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'Wirecard',
    measuredAt: CHECKED_AT,
    targetKeyword: {
      keyword: 'wirecard documentary',
      volume: 64,
      competition: 38,
      overall: 63,
      estimatedMonthlySearch: 6200,
      growthPct: null,
      fit: 'fits',
    },
    secondaryKeywords: [],
    searchedQuestions: [],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: null,
    recommendationReason: null,
    ownAngle: false,
    fieldChecks: [],
    ...overrides,
  }
}

function kase(searchBrief: SearchBrief): CaseSummary {
  return {
    id: CASE_ID,
    title: 'Wirecard',
    category: 'con',
    angle: null,
    demandNotes: null,
    competitorLinks: [],
    subject: 'Wirecard',
    people: [],
    sourceLinks: [],
    searchBrief,
    searchJob: null,
    formatKey: null,
    priorityScore: 80,
    status: 'shortlisted',
    projectCount: 0,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
  } as CaseSummary
}

const run = vi.fn(async (action: () => Promise<{ ok: boolean; error?: string }>) => {
  const outcome = await action()
  return outcome.ok
})

beforeEach(() => {
  vi.clearAllMocks()
  actions.checkWhoRanksAction.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('WhoRanks', () => {
  it('marks open doors and offers a check for an unchecked target', async () => {
    const { rerender } = render(<WhoRanks item={kase(brief())} run={run} />)
    await userEvent.click(screen.getByRole('button', { name: 'Check who ranks now' }))
    expect(screen.getByText('About 5 VidIQ credits.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(actions.checkWhoRanksAction).toHaveBeenCalledWith(CASE_ID))

    const checked = brief({
      fieldChecks: [
        {
          keyword: 'wirecard documentary',
          checkedAt: CHECKED_AT,
          results: [
            result({ videoId: 'a' }),
            result({ videoId: 'b', channelTitle: 'Big News', subscribers: 2_000_000 }),
            result({
              videoId: 'c',
              channelTitle: 'Quick Takes',
              seconds: 45,
              subscribers: 900_000,
            }),
          ],
        },
      ],
    })
    rerender(<WhoRanks item={kase(checked)} run={run} />)
    expect(screen.queryByRole('button', { name: 'Check who ranks now' })).not.toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: /wirecard documentary/ })).getAllByRole(
      'listitem',
    )
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('Open door')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('Small Channel')
    expect(rows[0]).toHaveTextContent(`${grouped(5000)} subscribers`)
    expect(rows[0]).toHaveTextContent(`${grouped(45_000)} views`)
    expect(rows[0]).toHaveTextContent('2.0 years')
    expect(rows[0]).toHaveTextContent('12:05')
    expect(within(rows[1]!).queryByText('Open door')).not.toBeInTheDocument()
    expect(within(rows[2]!).getByText('Short')).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent('0:45')
  })

  it('formats an hour-long video as h:mm:ss', () => {
    const checked = brief({
      fieldChecks: [
        {
          keyword: 'wirecard documentary',
          checkedAt: CHECKED_AT,
          results: [result({ seconds: 3725 })],
        },
      ],
    })
    render(<WhoRanks item={kase(checked)} run={run} />)
    expect(screen.getByText(/1:02:05/)).toBeInTheDocument()
  })

  it("who ranks counts open doors with the channel's thresholds", () => {
    const checked = brief({
      fieldChecks: [
        {
          keyword: 'wirecard documentary',
          checkedAt: CHECKED_AT,
          results: [result({ subscribers: 150_000 })],
        },
      ],
    })
    const { rerender } = render(<WhoRanks item={kase(checked)} run={run} />)
    expect(screen.queryByText('Open door')).not.toBeInTheDocument()
    expect(screen.getByText(/0 open doors/)).toBeInTheDocument()
    expect(screen.getByText(/under 100,000 subscribers/)).toBeInTheDocument()

    const tuned = { ...DEFAULT_RESEARCH_THRESHOLDS, openDoorMaxSubscribers: 200_000 }
    rerender(<WhoRanks item={kase(checked)} run={run} thresholds={tuned} />)
    expect(screen.getByText('Open door')).toBeInTheDocument()
    expect(screen.getByText(/ 1 open door$/)).toBeInTheDocument()
    expect(screen.getByText(/under 200,000 subscribers/)).toBeInTheDocument()
  })

  it('keeps the other keywords behind a toggle', async () => {
    const checked = brief({
      fieldChecks: [
        { keyword: 'wirecard documentary', checkedAt: CHECKED_AT, results: [result({})] },
        {
          keyword: 'wirecard scandal',
          checkedAt: CHECKED_AT,
          results: [result({ videoId: 'z', channelTitle: 'Other Channel' })],
        },
      ],
    })
    render(<WhoRanks item={kase(checked)} run={run} />)
    expect(screen.queryByText('Other Channel')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Show the other keywords checked' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getByText('Other Channel')).toBeInTheDocument()
    expect(screen.getByText('wirecard scandal')).toBeInTheDocument()
  })

  it('shows nothing for an old brief', () => {
    const { fieldChecks: _unused, ...rest } = brief()
    const { fit: _fit, ...target } = rest.targetKeyword!
    const old: SearchBrief = { ...rest, targetKeyword: target }
    const { container } = render(<WhoRanks item={kase(old)} run={run} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reports a failed purchase instead of throwing', async () => {
    actions.checkWhoRanksAction.mockRejectedValue(new Error('vidiq down'))
    const errors: string[] = []
    const guarded = vi.fn(async (action: () => Promise<{ ok: boolean; error?: string }>) => {
      const outcome = await action()
      if (!outcome.ok) errors.push(outcome.error ?? '')
      return outcome.ok
    })
    render(<WhoRanks item={kase(brief())} run={guarded} />)
    await userEvent.click(screen.getByRole('button', { name: 'Check who ranks now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(errors).toEqual(['Could not check who ranks. Try again.']))
  })
})
