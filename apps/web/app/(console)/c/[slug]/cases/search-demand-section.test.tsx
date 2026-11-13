import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
import type { SearchBrief, SearchKeyword } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchDemandSection } from './search-demand-section'

/** The Search demand section: the target's figures, the other keywords, titles and evidence. */

const actions = vi.hoisted(() => ({
  setTargetKeywordAction: vi.fn(),
  chooseAngleAction: vi.fn(),
  rateAnglesAction: vi.fn(),
  rateAnglesEstimate: vi.fn(),
  checkWhoRanksAction: vi.fn(),
  addCaseKeywordAction: vi.fn(),
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

function brief(overrides: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'Stellantis',
    measuredAt: '2026-11-04T10:00:00.000Z',
    targetKeyword: keyword({}),
    secondaryKeywords: [
      keyword({
        keyword: 'stellantis news',
        volume: 59,
        competition: 41,
        estimatedMonthlySearch: 9900,
        growthPct: null,
      }),
      keyword({ keyword: 'stellantis 2025 loss', volume: 40, competition: 50 }),
    ],
    searchedQuestions: ['why is jeep losing sales', 'who runs stellantis'],
    outliers: [
      {
        videoId: 'v1',
        title: 'Jeep made billions',
        channel: 'Cars Explained',
        subscribers: 1000,
        views: 1_200_000,
        breakoutScore: 41,
        publishedAt: null,
        tags: [],
      },
      {
        videoId: 'v2',
        title: 'The dealer squeeze',
        channel: null,
        subscribers: null,
        views: null,
        breakoutScore: 12,
        publishedAt: null,
        tags: [],
      },
    ],
    titlePatterns: [],
    toldAlready: ['The pricing push'],
    angleOptions: [],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [
      keyword({
        keyword: 'stellantis is losing everything: jeep, dodge and fiat on the brink',
        estimatedMonthlySearch: 109_212,
        growthPct: 567,
      }),
    ],
    otherLanguages: [
      keyword({ keyword: 'stellantis esta perdendo tudo', estimatedMonthlySearch: 3200 }),
    ],
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

const run = vi.fn(async (action: () => Promise<{ ok: boolean; error?: string }>) => {
  const result = await action()
  return result.ok
})

beforeEach(() => {
  vi.clearAllMocks()
  actions.setTargetKeywordAction.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('SearchDemandSection', () => {
  it('labels scores out of 100 apart from searches a month', () => {
    render(<SearchDemandSection item={kase()} run={run} />)
    const card = screen.getByTestId('target-card')
    expect(within(card).getByText('Searches a month')).toBeInTheDocument()
    expect(within(card).getByText('~12,400')).toBeInTheDocument()
    expect(within(card).getByText('VidIQ estimate')).toBeInTheDocument()
    expect(within(card).getByText('Search volume')).toBeInTheDocument()
    expect(within(card).getByTestId('volume')).toHaveTextContent('61/100')
    expect(within(card).getByText('moderate')).toBeInTheDocument()
    expect(within(card).getByTestId('competition')).toHaveTextContent('29/100')
    expect(within(card).getByText('low')).toBeInTheDocument()
    expect(within(card).getByText('+38%')).toBeInTheDocument()
  })

  it('omits a figure that was not measured', () => {
    render(
      <SearchDemandSection
        item={kase({
          searchBrief: brief({ targetKeyword: keyword({ volume: null, growthPct: -12 }) }),
        })}
        run={run}
      />,
    )
    expect(screen.queryByText('Search volume')).not.toBeInTheDocument()
    expect(screen.getByText('-12%')).toBeInTheDocument()
  })

  it('says so when no keyword was measured', () => {
    render(
      <SearchDemandSection
        item={kase({ searchBrief: brief({ targetKeyword: null }) })}
        run={run}
      />,
    )
    expect(
      screen.getByText(/No keyword people search for this subject was measured/),
    ).toBeInTheDocument()
  })

  it('names the keyword in Make target', async () => {
    render(<SearchDemandSection item={kase()} run={run} />)
    const button = screen.getByRole('button', { name: 'Make target: stellantis news' })
    // A keyword with a figure in it is not a target.
    expect(
      screen.queryByRole('button', { name: 'Make target: stellantis 2025 loss' }),
    ).not.toBeInTheDocument()
    await userEvent.click(button)
    await waitFor(() =>
      expect(actions.setTargetKeywordAction).toHaveBeenCalledWith(CASE_ID, 'stellantis news'),
    )
  })

  it('lets only one Make target be in flight', async () => {
    let release: (value: { ok: boolean }) => void = () => {}
    actions.setTargetKeywordAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    render(
      <SearchDemandSection
        item={kase({
          searchBrief: brief({
            secondaryKeywords: [
              keyword({ keyword: 'stellantis news' }),
              keyword({ keyword: 'stellantis layoffs' }),
            ],
          }),
        })}
        run={run}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Make target: stellantis news' }))
    await userEvent.click(screen.getByRole('button', { name: 'Make target: stellantis layoffs' }))
    expect(actions.setTargetKeywordAction).toHaveBeenCalledTimes(1)
    release({ ok: true })
  })

  it('offers no Make target for a brief on another subject', () => {
    render(<SearchDemandSection item={kase({ subject: 'Fiat' })} run={run} />)
    expect(screen.queryByRole('button', { name: /Make target/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add keyword' })).not.toBeInTheDocument()
  })

  it("marks the owner's own keyword (decision 467)", () => {
    render(
      <SearchDemandSection
        item={kase({
          searchBrief: brief({
            secondaryKeywords: [keyword({ keyword: 'stellantis collapse', owner: true })],
          }),
        })}
        run={run}
      />,
    )
    const row = screen.getByText('stellantis collapse').closest('tr')!
    expect(within(row).getByText('Your keyword')).toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'Make target: stellantis collapse' }),
    ).toBeInTheDocument()
  })

  it('Add keyword asks first with its cost, then measures the typed phrase and clears the box (decision 467)', async () => {
    actions.addCaseKeywordAction.mockResolvedValue({ ok: true })
    render(<SearchDemandSection item={kase()} run={run} />)
    const add = screen.getByRole('button', { name: 'Add keyword' })
    expect(add).toBeDisabled()
    const box = screen.getByLabelText('Add a keyword of your own')
    await userEvent.type(box, 'stellantis collapse explained')
    await userEvent.click(add)
    expect(screen.getByText('About 5 VidIQ credits.')).toBeInTheDocument()
    expect(actions.addCaseKeywordAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Measure and add' }))
    await waitFor(() =>
      expect(actions.addCaseKeywordAction).toHaveBeenCalledWith(
        CASE_ID,
        'stellantis collapse explained',
      ),
    )
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('keeps the typed phrase when Add keyword is refused', async () => {
    actions.addCaseKeywordAction.mockResolvedValue({
      ok: false,
      error: 'That keyword is already on this brief',
    })
    render(<SearchDemandSection item={kase()} run={run} />)
    const box = screen.getByLabelText('Add a keyword of your own')
    await userEvent.type(box, 'stellantis news')
    await userEvent.click(screen.getByRole('button', { name: 'Add keyword' }))
    await userEvent.click(screen.getByRole('button', { name: 'Measure and add' }))
    await waitFor(() => expect(actions.addCaseKeywordAction).toHaveBeenCalled())
    expect(box).toHaveValue('stellantis news')
  })

  it('lists searched titles apart', () => {
    render(<SearchDemandSection item={kase()} run={run} />)
    expect(screen.getByRole('heading', { name: 'Searched video titles' })).toBeInTheDocument()
    expect(screen.getByText(/People typing the title of one specific video/)).toBeInTheDocument()
    expect(screen.getByText(/stellantis is losing everything: jeep/)).toBeInTheDocument()
    expect(screen.getByText('~109,212')).toBeInTheDocument()
    expect(screen.getByText('+567%')).toBeInTheDocument()
  })

  it('offers no Make target on a title', () => {
    render(<SearchDemandSection item={kase()} run={run} />)
    expect(
      screen.queryByRole('button', { name: /Make target: stellantis is losing/ }),
    ).not.toBeInTheDocument()
  })

  it('summarises evidence while collapsed', () => {
    render(<SearchDemandSection item={kase()} run={run} />)
    expect(screen.getByText('2 videos · best 41x breakout')).toBeInTheDocument()
    expect(screen.getByText('2 questions')).toBeInTheDocument()
    expect(screen.getByText('1 beat to avoid retelling')).toBeInTheDocument()
    expect(screen.getByText('1 search in other languages')).toBeInTheDocument()
    const details = document.querySelectorAll('details')
    expect(details).toHaveLength(4)
    details.forEach((d) => expect(d).not.toHaveAttribute('open'))
    // The content sits inside for when it opens.
    expect(screen.getByText('who runs stellantis')).toBeInTheDocument()
    expect(screen.getByText('The pricing push')).toBeInTheDocument()
    expect(screen.getByText(/stellantis esta perdendo tudo/)).toBeInTheDocument()
  })

  it('explains why a figure row has no Make target', () => {
    render(<SearchDemandSection item={kase()} run={run} />)
    const row = screen.getByText('stellantis 2025 loss').closest('tr')!
    expect(within(row).getByText("Has a figure, can't be the target")).toBeInTheDocument()
    const other = screen.getByText('stellantis news').closest('tr')!
    expect(within(other).queryByText("Has a figure, can't be the target")).toBeNull()
  })

  it('shows the intent phrase, fit and topic on the target card', () => {
    render(
      <SearchDemandSection
        item={kase({
          searchBrief: brief({
            targetKeyword: keyword({
              fit: 'partly',
              intent: 'wants the latest company news',
              topic: 'stellantis news',
            }),
          }),
        })}
        run={run}
      />,
    )
    const card = screen.getByTestId('target-card')
    expect(card).toHaveAttribute('id', 'evidence-intent')
    expect(card).toHaveTextContent('wants the latest company news')
    expect(card).toHaveTextContent('Partly fits this channel')
    const topic = within(card).getByText(/Topic: stellantis news/)
    expect(topic).toHaveAttribute('id', 'evidence-demand')
    expect(topic).toHaveTextContent('about 12,400 searches a month')
  })

  it('groups keywords by topic and hides off-intent rows in their own group', () => {
    render(
      <SearchDemandSection
        item={kase({
          searchBrief: brief({
            targetKeyword: keyword({ topic: 'jeep sales' }),
            secondaryKeywords: [
              keyword({
                keyword: 'jeep sales slump',
                topic: 'jeep sales',
                intent: 'wants the numbers',
                fit: 'fits',
              }),
              keyword({
                keyword: 'stellantis ceo',
                topic: 'leadership',
                intent: 'wants a profile',
                fit: 'partly',
              }),
            ],
            offIntent: [
              keyword({
                keyword: 'stellantis stock price',
                topic: 'shares',
                intent: 'wants a share quote',
                fit: 'off',
              }),
            ],
          }),
        })}
        run={run}
      />,
    )
    expect(screen.getByRole('heading', { level: 5, name: 'jeep sales' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 5, name: 'leadership' })).toBeInTheDocument()
    const slump = screen.getByText('jeep sales slump').closest('tr')!
    expect(slump).toHaveTextContent('wants the numbers')
    const group = screen.getByText("Doesn't fit this channel").closest('details')!
    expect(group).not.toHaveAttribute('open')
    expect(group).toHaveTextContent('stellantis stock price')
    expect(group).toHaveTextContent('wants a share quote')
    expect(within(group).queryByRole('button')).toBeNull()
    expect(screen.getByText('stellantis ceo').closest('details')).toBeNull()
  })

  it('puts who ranks under the target for a full brief', () => {
    render(
      <SearchDemandSection
        item={kase({
          searchBrief: brief({ targetKeyword: keyword({ fit: 'fits' }), fieldChecks: [] }),
        })}
        run={run}
      />,
    )
    expect(document.getElementById('evidence-competition')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check who ranks now' })).toBeInTheDocument()
  })
})
