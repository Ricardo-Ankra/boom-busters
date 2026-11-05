import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
import { FIRST_CHANNEL_BIBLE, FIRST_CHANNEL_ID as CHANNEL_ID } from '@boom-busters/schemas'
import type { SearchBrief } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CasePanel } from './case-panel'

/** The case panel on its own: header, next step, warnings, sections and footer, in that order. */

const actions = vi.hoisted(() => ({
  acceptCase: vi.fn(),
  addCase: vi.fn(),
  editCase: vi.fn(),
  dismissCase: vi.fn(),
  setStatus: vi.fn(),
  startProjectFromCase: vi.fn(),
  researchCaseAction: vi.fn(),
  caseResearchEstimate: vi.fn(),
  chooseAngleAction: vi.fn(),
  rateAnglesAction: vi.fn(),
  rateAnglesEstimate: vi.fn(),
  setTargetKeywordAction: vi.fn(),
  setCaseFormatAction: vi.fn(),
  estimateStartCostAction: vi.fn(),
}))
vi.mock('./actions', () => actions)
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const ID = '01J0000000000000000000000A'
const CATEGORIES = FIRST_CHANNEL_BIBLE.caseCategories

function kase(overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id: ID,
    title: 'Wirecard',
    category: 'con',
    angle: null,
    demandNotes: null,
    competitorLinks: [],
    subject: 'Wirecard',
    people: ['Markus Braun'],
    sourceLinks: [{ url: 'https://example.com/a' }],
    searchBrief: null,
    searchJob: null,
    formatKey: null,
    priorityScore: 88,
    status: 'shortlisted',
    projectCount: 0,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
    ...overrides,
  }
}

const GOOD_KEYWORD = {
  keyword: 'wirecard documentary',
  volume: 64,
  competition: 38,
  overall: 63,
  estimatedMonthlySearch: 1200,
  growthPct: null,
}

function brief(over: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'Wirecard',
    measuredAt: '2026-10-20T10:00:00.000Z',
    targetKeyword: GOOD_KEYWORD,
    secondaryKeywords: [],
    searchedQuestions: [],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [{ angle: 'The auditors.', keyword: '', answers: [], gap: 'A gap.' }],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: null,
    recommendationReason: null,
    ownAngle: false,
    ...over,
  }
}

const run = vi.fn(async (action: () => Promise<{ ok: boolean }>) => (await action()).ok)

function renderPanel(item: CaseSummary, blocked: string | null = null) {
  render(
    <CasePanel
      slug="psychology"
      channelId={CHANNEL_ID}
      blocked={blocked}
      item={item}
      run={run}
      notices={[]}
      categories={CATEGORIES}
      sort="newest"
      explicit
    />,
  )
  return screen.getByRole('region', { name: item.title })
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.estimateStartCostAction.mockResolvedValue({ usd: null, basis: 'No estimate yet' })
})
afterEach(cleanup)

describe('CasePanel', () => {
  it('is a region named by the case title, with the title as the h2', () => {
    const panel = renderPanel(kase())
    expect(within(panel).getByRole('heading', { level: 2, name: 'Wirecard' })).toBeInTheDocument()
  })

  it('shows the next step: three steps and one sentence', () => {
    const panel = renderPanel(kase())
    const steps = within(within(panel).getByRole('list', { name: 'Progress' })).getAllByRole(
      'listitem',
    )
    expect(steps.map((step) => step.textContent)).toEqual([
      'Researched (next)',
      'Angle chosen (not yet)',
      'Start a project (not yet)',
    ])
    expect(panel).toHaveTextContent('Next: research the subject with VidIQ')
  })

  it('keeps Remove case in the footer, after Edit details, with the consequence', async () => {
    actions.dismissCase.mockResolvedValue({ ok: true })
    const panel = renderPanel(kase({ projectCount: 2 }))
    const names = within(panel)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names.at(-1)).toBe('Remove case')
    expect(names.indexOf('Edit details')).toBeLessThan(names.indexOf('Remove case'))
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove case' }))
    expect(panel).toHaveTextContent(
      'It has projects behind it, so it is retired rather than deleted.',
    )
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove it' }))
    await waitFor(() => expect(actions.dismissCase).toHaveBeenCalledWith(ID))
  })

  it('summarises subject, people and source links in the footer', () => {
    const panel = renderPanel(kase())
    expect(panel).toHaveTextContent('Markus Braun')
    expect(panel).toHaveTextContent('1 source link')
  })

  it('puts Accept and Dismiss in the header of a suggestion, in place of status and research', async () => {
    actions.acceptCase.mockResolvedValue({ ok: true })
    const panel = renderPanel(kase({ status: 'idea' }))
    expect(within(panel).queryByLabelText('Wirecard status')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /^Research/ })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Remove case' })).not.toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(actions.acceptCase).toHaveBeenCalledWith(ID))
    expect(within(panel).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('offers the status select and research in the header of a backlog case', async () => {
    actions.setStatus.mockResolvedValue({ ok: true })
    const panel = renderPanel(kase())
    await userEvent.selectOptions(within(panel).getByLabelText('Wirecard status'), 'published')
    await waitFor(() => expect(actions.setStatus).toHaveBeenCalledWith(ID, 'published'))
    expect(within(panel).getByRole('button', { name: /^Research with VidIQ/ })).toBeInTheDocument()
  })

  it('hides research for a retired case', () => {
    const panel = renderPanel(kase({ status: 'retired', searchBrief: brief() }))
    expect(within(panel).queryByRole('button', { name: /^Research/ })).not.toBeInTheDocument()
    expect(panel).toHaveTextContent('Retired')
  })

  it('shows the research control exactly once: in the header normally', () => {
    const panel = renderPanel(kase({ searchBrief: brief() }))
    expect(
      within(panel).getAllByRole('button', { name: /^Research again with VidIQ/ }),
    ).toHaveLength(1)
  })

  it('moves the research control into the Angle section when the brief needs research', () => {
    const panel = renderPanel(
      kase({ searchBrief: brief({ targetKeyword: { ...GOOD_KEYWORD, overall: 30 } }) }),
    )
    const controls = within(panel).getAllByRole('button', { name: /^Research again with VidIQ/ })
    expect(controls).toHaveLength(1)
    const angle = within(panel)
      .getByRole('heading', { level: 3, name: 'Angle' })
      .closest('section')!
    expect(angle).toContainElement(controls[0]!)
  })

  it('shows the warnings above the Angle section', () => {
    const panel = renderPanel(
      kase({
        subject: 'We Company',
        searchBrief: brief({
          fit: { inScope: false, pillarKey: null, reason: 'It is a sleep guide.' },
        }),
      }),
    )
    const fit = within(panel).getByText(/Outside this channel's pillars/)
    const mismatch = within(panel).getByText(/This research is for Wirecard\./)
    const angle = within(panel).getByRole('heading', { level: 3, name: 'Angle' })
    for (const warning of [fit, mismatch]) {
      expect(warning.compareDocumentPosition(angle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('shows Start a project for a shortlisted case only', () => {
    const shortlisted = renderPanel(kase())
    expect(
      within(shortlisted).getByRole('heading', { level: 3, name: 'Start a project' }),
    ).toBeInTheDocument()
    expect(within(shortlisted).getByRole('button', { name: 'New project' })).toBeEnabled()
    cleanup()
    const published = renderPanel(kase({ status: 'published' }))
    expect(within(published).queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
  })

  it('disables New project with the blocked reason', () => {
    const panel = renderPanel(kase(), 'Complete the channel bible in Settings first')
    expect(within(panel).getByRole('button', { name: 'New project' })).toBeDisabled()
  })
})
