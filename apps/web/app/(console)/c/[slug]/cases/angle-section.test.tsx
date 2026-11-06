import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
import type { SearchBrief, SearchKeyword } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AngleSection } from './angle-section'

/** The Angle section: option cards with Demand, the recommendation, and the choices. */

const actions = vi.hoisted(() => ({
  chooseAngleAction: vi.fn(),
  rateAnglesAction: vi.fn(),
  rateAnglesEstimate: vi.fn(),
  setTargetKeywordAction: vi.fn(),
  testAngleAction: vi.fn(),
}))
vi.mock('./actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const CASE_ID = '01J0000000000000000000000A'

const keyword = (overrides: Partial<SearchKeyword>): SearchKeyword => ({
  keyword: 'stellantis jeep',
  volume: 61,
  competition: 29,
  overall: 80,
  estimatedMonthlySearch: 12_400,
  growthPct: 38,
  ...overrides,
})

const QUESTION_A = 'why is jeep losing sales'
const QUESTION_B = 'who runs stellantis'

function brief(overrides: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'Stellantis',
    measuredAt: '2026-11-04T10:00:00.000Z',
    targetKeyword: keyword({}),
    secondaryKeywords: [],
    searchedQuestions: [QUESTION_A, QUESTION_B],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [
      {
        angle: 'Treat the slide as a documented chain of decisions inside one company.',
        keyword: 'stellantis jeep',
        answers: [QUESTION_A, QUESTION_B],
        gap: 'Nobody lays the decisions end to end.',
      },
      {
        angle: 'Follow one Jeep dealer through 2023 to 2025 and the stock that would not move.',
        keyword: 'stellantis jeep',
        answers: [QUESTION_A],
        gap: 'Existing videos stay in the boardroom.',
      },
    ],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: null,
    recommendationReason: null,
    ownAngle: false,
    ...overrides,
  }
}

function kase(overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id: CASE_ID,
    title: 'Stellantis',
    category: 'meltdown',
    angle: null,
    demandNotes: null,
    competitorLinks: [],
    subject: 'Stellantis',
    people: [],
    sourceLinks: [],
    searchBrief: brief(),
    searchJob: null,
    formatKey: null,
    priorityScore: 80,
    status: 'shortlisted',
    projectCount: 0,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
    ...overrides,
  } as CaseSummary
}

/** What the console would toast, in order. */
const toasts: string[] = []
const run = vi.fn(
  async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string | (() => string),
  ) => {
    const result = await action()
    toasts.push(
      result.ok
        ? typeof success === 'function'
          ? success()
          : success
        : `error: ${result.error ?? ''}`,
    )
    return result.ok
  },
)

function renderSection(item: CaseSummary) {
  return render(
    <AngleSection item={item} run={run} researchControl={<button>Research again</button>} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  toasts.length = 0
  actions.testAngleAction.mockResolvedValue({ ok: true })
  actions.chooseAngleAction.mockResolvedValue({ ok: true })
  actions.rateAnglesAction.mockResolvedValue({ ok: true })
  actions.rateAnglesEstimate.mockResolvedValue({ ok: true, usd: 0.0312, model: 'gemini-pro' })
})
afterEach(cleanup)

describe('AngleSection', () => {
  it('marks the recommended angle with its reason', () => {
    renderSection(
      kase({
        searchBrief: brief({
          recommendedAngle: 1,
          recommendationReason: 'It puts the cost on one dealer.',
          chosenAngle: 0,
        }),
      }),
    )
    const cards = screen.getAllByRole('listitem')
    expect(within(cards[1]!).getByText('Recommended')).toBeInTheDocument()
    expect(within(cards[1]!).getByText(/Why recommended: It puts the cost/)).toBeInTheDocument()
    expect(within(cards[0]!).queryByText('Recommended')).not.toBeInTheDocument()
    expect(within(cards[0]!).getByText('Chosen')).toBeInTheDocument()
    expect(within(cards[0]!).getByText(/The gap:/)).toBeInTheDocument()
  })

  it('shows Demand and its parts', () => {
    renderSection(kase())
    const first = screen.getAllByRole('listitem')[0]!
    // round(0.7 x 80 + 6 x 2) = 68
    expect(within(first).getByText('68')).toBeInTheDocument()
    expect(within(first).getByText('Demand')).toBeInTheDocument()
    expect(
      within(first).getByText('overall 80 for stellantis jeep, 2 searched questions'),
    ).toBeVisible()
    expect(first.querySelector('[title]')).toBeNull()
    expect(within(first).queryByText(/^Serves/)).not.toBeInTheDocument()
  })

  it('words the breakdown plainly for a title, a missing score and one question', () => {
    renderSection(
      kase({
        searchBrief: brief({
          searchedTitles: [keyword({ keyword: 'stellantis is losing everything' })],
          angleOptions: [
            {
              angle: 'Treat the slide as a documented chain of decisions inside one company.',
              keyword: 'Stellantis is losing everything',
              answers: [QUESTION_A],
              gap: 'A gap.',
            },
            {
              angle:
                'Follow one Jeep dealer through 2023 to 2025 and the stock that would not move.',
              keyword: '',
              answers: [],
              gap: 'Another gap.',
            },
          ],
        }),
      }),
    )
    expect(screen.getByText('Serves a searched title, 1 searched question')).toBeInTheDocument()
    expect(screen.getByText('No keyword score, no searched questions')).toBeInTheDocument()
  })

  it('ignores a cost estimate from an earlier arm', async () => {
    let first: (value: unknown) => void = () => {}
    actions.rateAnglesEstimate
      .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
      .mockResolvedValueOnce({ ok: true, usd: 0.5, model: 'second-model' })
    renderSection(kase())
    await userEvent.click(screen.getByRole('button', { name: 'Rate the angles' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Rate the angles' }))
    expect(await screen.findByText('About $0.50 on second-model. No VidIQ credits.')).toBeVisible()
    first({ ok: true, usd: 9, model: 'stale-model' })
    await Promise.resolve()
    expect(screen.queryByText(/stale-model/)).not.toBeInTheDocument()
    expect(screen.getByText(/second-model/)).toBeInTheDocument()
  })

  it('names the angle in Use this angle', async () => {
    renderSection(kase())
    const button = screen.getAllByRole('button', { name: /^Use this angle: / })[1]!
    expect(button).toHaveAccessibleName(
      'Use this angle: Follow one Jeep dealer through 2023 to 2025 and the stock th',
    )
    await userEvent.click(button)
    await waitFor(() =>
      expect(actions.chooseAngleAction).toHaveBeenCalledWith(CASE_ID, { option: 1 }),
    )
  })

  it('says when an angle serves a searched title', () => {
    renderSection(
      kase({
        searchBrief: brief({
          searchedTitles: [keyword({ keyword: 'stellantis is losing everything' })],
          angleOptions: [
            {
              angle: 'Treat the slide as a documented chain of decisions inside one company.',
              keyword: 'Stellantis is losing everything',
              answers: [],
              gap: 'A gap.',
            },
          ],
        }),
      }),
    )
    expect(screen.getByText('Serves a searched title, no searched questions')).toBeInTheDocument()
  })

  it('offers Rate the angles only without a recommendation', () => {
    const { unmount } = renderSection(kase())
    expect(screen.getByRole('button', { name: 'Rate the angles' })).toBeEnabled()
    unmount()
    renderSection(
      kase({ searchBrief: brief({ recommendedAngle: 0, recommendationReason: 'Best fit.' }) }),
    )
    expect(screen.queryByRole('button', { name: 'Rate the angles' })).not.toBeInTheDocument()
  })

  it('disables Rate the angles while research runs', () => {
    renderSection(
      kase({
        searchJob: {
          state: 'running',
          current: 'angles',
          error: null,
          startedAt: new Date().toISOString(),
          subject: 'Stellantis',
        },
      }),
    )
    const button = screen.getByRole('button', { name: 'Rate the angles' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Research is running')
  })

  it('rates after confirming the cost', async () => {
    renderSection(kase())
    await userEvent.click(screen.getByRole('button', { name: 'Rate the angles' }))
    expect(await screen.findByText('About $0.03 on gemini-pro. No VidIQ credits.')).toBeVisible()
    expect(actions.rateAnglesEstimate).toHaveBeenCalledWith(CASE_ID)
    expect(actions.rateAnglesAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Rate now' }))
    await waitFor(() => expect(actions.rateAnglesAction).toHaveBeenCalledWith(CASE_ID))
  })

  it('suggests research for a weak target', () => {
    renderSection(kase({ searchBrief: brief({ targetKeyword: keyword({ overall: 20 }) }) }))
    expect(
      screen.getByText(
        'This brief has no strong keyword to aim at. Research again to measure fresh terms.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Research again' })).toBeInTheDocument()
  })

  it('does not suggest research for a strong target', () => {
    renderSection(kase())
    expect(screen.queryByText(/no strong keyword/)).not.toBeInTheDocument()
  })

  it('hides choices for a brief on another subject', () => {
    renderSection(kase({ subject: 'Fiat' }))
    expect(screen.queryByRole('button', { name: /Use this angle/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rate the angles' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write my own angle' })).not.toBeInTheDocument()
  })

  it('keeps my own angle', async () => {
    renderSection(kase())
    await userEvent.click(screen.getByRole('button', { name: 'Write my own angle' }))
    await userEvent.type(screen.getByLabelText('Your angle'), 'Mine.')
    await userEvent.click(screen.getByRole('button', { name: 'Save my angle' }))
    await waitFor(() =>
      expect(actions.chooseAngleAction).toHaveBeenCalledWith(CASE_ID, { own: 'Mine.' }),
    )
  })

  it('lets only one choice be in flight', async () => {
    let release: (value: { ok: boolean }) => void = () => {}
    actions.chooseAngleAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    renderSection(kase())
    const [a, b] = screen.getAllByRole('button', { name: /^Use this angle: / })
    await userEvent.click(a!)
    await userEvent.click(b!)
    expect(actions.chooseAngleAction).toHaveBeenCalledTimes(1)
    release({ ok: true })
  })

  it('toasts the target change when an angle is chosen', async () => {
    actions.chooseAngleAction.mockResolvedValue({
      ok: true,
      targetChange: { to: 'stellantis dealers' },
    })
    renderSection(kase())
    await userEvent.click(screen.getAllByRole('button', { name: /^Use this angle: / })[1]!)
    await waitFor(() => expect(toasts).toEqual(['Target keyword is now stellantis dealers']))
  })

  it('says why the target stayed when an angle is chosen', async () => {
    actions.chooseAngleAction.mockResolvedValue({
      ok: true,
      targetChange: { keptBecause: 'The angle keyword has a figure in it.' },
    })
    renderSection(kase())
    await userEvent.click(screen.getAllByRole('button', { name: /^Use this angle: / })[0]!)
    await waitFor(() => expect(toasts).toEqual(['The angle keyword has a figure in it.']))
  })

  it('keeps the plain toast when the target does not change', async () => {
    renderSection(kase())
    await userEvent.click(screen.getAllByRole('button', { name: /^Use this angle: / })[0]!)
    await waitFor(() => expect(toasts).toEqual(['Angle chosen']))
  })

  it('offers Test this angle for a chosen angle without a test', async () => {
    renderSection(kase({ searchBrief: brief({ chosenAngle: 1, niche: 'car industry' }) }))
    const cards = screen.getAllByRole('listitem')
    expect(within(cards[0]!).queryByRole('button', { name: 'Test this angle' })).toBeNull()
    await userEvent.click(within(cards[1]!).getByRole('button', { name: 'Test this angle' }))
    expect(screen.getByText('About 5 VidIQ credits.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Test it' }))
    await waitFor(() => expect(actions.testAngleAction).toHaveBeenCalledWith(CASE_ID, 1))
  })

  it('offers to collect a paid pending test for free, and ignores an old one', async () => {
    const angle = 'Follow one Jeep dealer through 2023 to 2025 and the stock that would not move.'
    const job = (minutesAgo: number) => ({
      angle,
      jobId: 'job-paid',
      startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    })
    const fresh = renderSection(
      kase({
        searchBrief: brief({ chosenAngle: 1, niche: 'car industry', nicheJobs: [job(5)] }),
      }),
    )
    expect(screen.queryByRole('button', { name: 'Test this angle' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collect the angle test' }))
    expect(screen.getByText('Free: the test was already paid for.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collect it' }))
    await waitFor(() => expect(actions.testAngleAction).toHaveBeenCalledWith(CASE_ID, 1))
    fresh.unmount()
    renderSection(
      kase({
        searchBrief: brief({ chosenAngle: 1, niche: 'car industry', nicheJobs: [job(45)] }),
      }),
    )
    expect(screen.getByRole('button', { name: 'Test this angle' })).toBeInTheDocument()
  })

  it('offers no test without a niche, for an unchosen angle, or once it is tested', () => {
    const tested = {
      angle: 'Follow one Jeep dealer through 2023 to 2025 and the stock that would not move.',
      verdict: 'Viewers want this.',
      direct: true,
      evidence: [{ text: 'Dealer stories pull views', count: 12_400 }],
      notes: 'Based on three channels.',
    }
    const first = renderSection(kase({ searchBrief: brief({ chosenAngle: 1 }) }))
    expect(screen.queryByRole('button', { name: 'Test this angle' })).not.toBeInTheDocument()
    first.unmount()
    const second = renderSection(kase({ searchBrief: brief({ niche: 'car industry' }) }))
    expect(screen.queryByRole('button', { name: 'Test this angle' })).not.toBeInTheDocument()
    second.unmount()
    renderSection(
      kase({ searchBrief: brief({ chosenAngle: 1, niche: 'car industry', nicheTests: [tested] }) }),
    )
    expect(screen.queryByRole('button', { name: 'Test this angle' })).not.toBeInTheDocument()
    const card = screen.getAllByRole('listitem')[1]!
    expect(card).toHaveTextContent('Viewers want this.')
    expect(card).toHaveTextContent('Dealer stories pull views')
    expect(card).toHaveTextContent('(12,400)')
    expect(card).toHaveTextContent('Niche test: Viewers want this.')
    expect(card).toHaveTextContent('Based on three channels.')
  })

  it('reports a failed angle test instead of throwing', async () => {
    actions.testAngleAction.mockRejectedValue(new Error('vidiq down'))
    renderSection(kase({ searchBrief: brief({ chosenAngle: 1, niche: 'car industry' }) }))
    await userEvent.click(screen.getByRole('button', { name: 'Test this angle' }))
    await userEvent.click(screen.getByRole('button', { name: 'Test it' }))
    await waitFor(() => expect(toasts).toEqual(['error: Could not test the angle. Try again.']))
  })

  it('lists an angle card its evidence lines', () => {
    renderSection(
      kase({
        searchBrief: brief({
          angleOptions: [
            {
              angle: 'Treat the slide as a documented chain of decisions inside one company.',
              keyword: 'stellantis jeep',
              answers: [],
              gap: 'A gap.',
              evidence: ['Viewers ask who signed off', 'Three comments want the dealer view'],
            },
          ],
        }),
      }),
    )
    const card = screen.getAllByRole('listitem')[0]!
    expect(within(card).getByText('Viewers ask who signed off')).toBeInTheDocument()
    expect(within(card).getByText('Three comments want the dealer view')).toBeInTheDocument()
  })

  it('says honestly when comments held no requests', () => {
    renderSection(
      kase({
        searchBrief: brief({ commentThemes: [], commentsRead: { videos: 3, comments: 240 } }),
      }),
    )
    expect(screen.getByText('What viewers asked for')).toBeInTheDocument()
    const read = '240'
    expect(
      screen.getByText(`Read ${read} comments on 3 videos; no clear requests.`),
    ).toBeInTheDocument()
  })

  it('uses the singular for one video and one comment', () => {
    renderSection(
      kase({
        searchBrief: brief({ commentThemes: [], commentsRead: { videos: 1, comments: 1 } }),
      }),
    )
    expect(screen.getByText('Read 1 comment on 1 video; no clear requests.')).toBeInTheDocument()
  })

  it('says no comments were read when no video was read, never "no clear requests"', () => {
    renderSection(
      kase({
        searchBrief: brief({ commentThemes: [], commentsRead: { videos: 0, comments: 0 } }),
      }),
    )
    expect(screen.getByText('No comments were read.')).toBeInTheDocument()
    expect(screen.queryByText(/no clear requests/)).not.toBeInTheDocument()
  })

  it('gives the reason when the comments check was skipped', () => {
    renderSection(
      kase({
        searchBrief: brief({
          commentThemes: [],
          commentsRead: { videos: 2, comments: 0 },
          skipped: ['comments: credit cap'],
        }),
      }),
    )
    expect(screen.getByText('No comments were read: credit cap.')).toBeInTheDocument()
    expect(screen.queryByText(/no clear requests/)).not.toBeInTheDocument()
  })

  it('toasts instead of throwing when choosing an angle fails', async () => {
    actions.chooseAngleAction.mockRejectedValue(new Error('db down'))
    renderSection(kase())
    await userEvent.click(screen.getAllByRole('button', { name: /^Use this angle: / })[0]!)
    await waitFor(() => expect(toasts).toEqual(['error: Could not choose the angle. Try again.']))
  })

  it('lists the themes viewers asked for, collapsed', () => {
    renderSection(
      kase({
        searchBrief: brief({
          commentThemes: [
            { theme: 'Show the dealers', count: 14, quote: 'More on dealers', videoId: 'v1' },
          ],
          commentsRead: { videos: 2, comments: 90 },
        }),
      }),
    )
    const block = screen.getByText('What viewers asked for').closest('details')!
    expect(block).not.toHaveAttribute('open')
    expect(block).toHaveTextContent('Show the dealers')
    expect(block).toHaveTextContent('14')
    expect(block).toHaveTextContent('More on dealers')
    expect(block).toHaveTextContent('Read 90 comments on 2 videos.')
  })

  it('is the evidence target for Angle evidence', () => {
    renderSection(kase())
    expect(document.getElementById('evidence-angle')).toContainElement(
      screen.getByRole('heading', { name: 'Angle' }),
    )
  })
})
