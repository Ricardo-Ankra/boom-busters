import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
import { FIRST_CHANNEL_BIBLE, FIRST_CHANNEL_ID as CHANNEL_ID } from '@boom-busters/schemas'
import type { Notice, SearchBrief } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaseLibrary } from './case-library'
import { researchStepLabel } from './search-brief-panel'

/**
 * The Case Library's notices (decision 293): a suggestion's repairs on its own row.
 */

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
  setTargetKeywordAction: vi.fn(),
}))
vi.mock('./actions', () => actions)
// The notice's Dismiss is a server action whose module loads next-auth,
// which cannot load under jsdom.
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))
const refresh = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const WIRECARD = '01J0000000000000000000000A'
const THERANOS = '01J0000000000000000000000B'

function kase(overrides: Partial<CaseSummary>): CaseSummary {
  return {
    id: WIRECARD,
    title: 'Wirecard',
    category: 'con',
    angle: 'The auditor sign-offs are the story, not the missing billion.',
    demandNotes: null,
    competitorLinks: [],
    subject: null,
    people: [],
    sourceLinks: [],
    searchBrief: null,
    searchJob: null,
    formatKey: null,
    priorityScore: 88,
    status: 'idea',
    projectCount: 0,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
    ...overrides,
  }
}

const trimmed: Notice = {
  id: '01J0000000000000000000000N',
  projectId: null,
  subject: 'case',
  subjectId: WIRECARD,
  kind: 'trimmed',
  message: 'Trimmed to fit: the angle of Wirecard.',
  createdAt: new Date('2026-10-09T10:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CaseLibrary notices (decision 293)', () => {
  it("shows a case's notice on its own row and no other", () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[kase({}), kase({ id: THERANOS, title: 'Theranos', status: 'shortlisted' })]}
        sort="priority"
        notices={[trimmed]}
      />,
    )
    const wirecard = screen.getByText('Wirecard').closest('li')!
    expect(within(wirecard).getByRole('status')).toHaveTextContent(
      'Trimmed to fit: the angle of Wirecard.',
    )
    // The row has the case's own Dismiss too; the notice's sits on its line.
    const noticeLine = within(wirecard).getByRole('status').parentElement!
    expect(within(noticeLine).getByRole('button', { name: 'Dismiss note' })).toBeInTheDocument()
    const theranos = screen.getByText('Theranos').closest('li')!
    expect(within(theranos).queryByRole('status')).not.toBeInTheDocument()
  })

  it("asks before a suggestion's Dismiss deletes it (decision 294)", async () => {
    actions.dismissCase.mockResolvedValue({ ok: true })
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[kase({})]}
        sort="priority"
        notices={[trimmed]}
      />,
    )
    const row = screen.getByText('Wirecard').closest('li')!

    await userEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))
    expect(actions.dismissCase).not.toHaveBeenCalled()
    expect(row).toHaveTextContent('This suggestion is deleted.')

    await userEvent.click(within(row).getByRole('button', { name: 'Dismiss it' }))
    await waitFor(() => expect(actions.dismissCase).toHaveBeenCalledWith(WIRECARD))
  })

  it('says a suggestion with projects behind it is retired, not deleted', async () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[kase({ projectCount: 2 })]}
        sort="priority"
      />,
    )
    const row = screen.getByText('Wirecard').closest('li')!

    await userEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))
    expect(row).toHaveTextContent(
      'It has projects behind it, so it is retired rather than deleted.',
    )
    expect(within(row).getByRole('button', { name: 'Dismiss it' })).toBeInTheDocument()
  })
})

describe('the case form: subject, people and source links', () => {
  async function openAddForm() {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[]}
        sort="priority"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add case' }))
  }

  it('leads with Subject, then Angle idea, and defaults Title from the subject until it is typed in', async () => {
    await openAddForm()
    const labels = screen
      .getAllByText(/^(Subject|Angle idea|Title|Category|People|Source links)$/)
      .map((label) => label.textContent)
    expect(labels.slice(0, 3)).toEqual(['Subject', 'Angle idea', 'Title'])
    expect(screen.queryByLabelText('Priority')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Subject'), 'Iomega')
    expect(screen.getByLabelText('Title')).toHaveValue('Iomega')
    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Iomega: the zip drive')
    await userEvent.type(screen.getByLabelText('Subject'), ' Corp')
    expect(screen.getByLabelText('Title')).toHaveValue('Iomega: the zip drive')
  })

  it('sends the subject, the angle idea and the other fields to addCase, with no priority', async () => {
    actions.addCase.mockResolvedValue({ ok: true })
    await openAddForm()
    await userEvent.type(screen.getByLabelText('Subject'), 'Wirecard')
    await userEvent.type(screen.getByLabelText('Angle idea'), 'The auditors are the story')
    await userEvent.type(screen.getByLabelText('People'), 'Markus Braun, Jan Marsalek')
    await userEvent.type(
      screen.getByLabelText('Source links'),
      'https://example.com/a{enter}https://example.com/b',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() =>
      expect(actions.addCase).toHaveBeenCalledWith(CHANNEL_ID, {
        title: 'Wirecard',
        category: 'collapse',
        angle: 'The auditors are the story',
        subject: 'Wirecard',
        people: ['Markus Braun', 'Jan Marsalek'],
        sourceLinks: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      }),
    )
  })

  it('shows the duplicate-subject refusal as a toast', async () => {
    actions.addCase.mockResolvedValue({
      ok: false,
      error: 'A case for this subject already exists',
    })
    await openAddForm()
    await userEvent.type(screen.getByLabelText('Subject'), 'Wirecard')
    await userEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'That did not work',
        description: 'A case for this subject already exists',
        variant: 'error',
      }),
    )
  })

  it('shows the same three fields when editing, and saves them', async () => {
    actions.editCase.mockResolvedValue({ ok: true })
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[
          kase({
            status: 'shortlisted',
            subject: 'Wirecard',
            people: ['Markus Braun'],
            sourceLinks: [{ url: 'https://example.com/a' }],
          }),
        ]}
        sort="priority"
      />,
    )
    const row = screen.getByText('Wirecard', { selector: 'p' }).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Edit details' }))
    expect(within(row).getByLabelText('Subject')).toHaveValue('Wirecard')
    expect(within(row).getByLabelText('People')).toHaveValue('Markus Braun')
    expect(within(row).getByLabelText('Source links')).toHaveValue('https://example.com/a')
    await userEvent.clear(within(row).getByLabelText('People'))
    await userEvent.type(within(row).getByLabelText('People'), 'Markus Braun, Jan Marsalek')
    await userEvent.click(within(row).getByRole('button', { name: 'Save details' }))
    await waitFor(() =>
      expect(actions.editCase).toHaveBeenCalledWith(WIRECARD, {
        subject: 'Wirecard',
        people: ['Markus Braun', 'Jan Marsalek'],
        sourceLinks: [{ url: 'https://example.com/a' }],
      }),
    )
  })
})

describe('CaseLibrary with an incomplete channel bible', () => {
  it('disables New project and links to the Bible tab', () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[kase({ status: 'shortlisted' })]}
        sort="priority"
        bibleComplete={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Complete the channel bible in Settings first',
    )
    expect(screen.getByRole('link', { name: 'Open the Bible tab' })).toHaveAttribute(
      'href',
      '/c/psychology/settings?tab=bible',
    )
  })

  it('leaves New project enabled once the bible is complete', () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[kase({ status: 'shortlisted' })]}
        sort="priority"
      />,
    )
    expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('CaseLibrary for an archived channel', () => {
  it('disables Add and New project with the archived notice', () => {
    render(
      <CaseLibrary
        slug="old"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[kase({ status: 'shortlisted' })]}
        sort="priority"
        archived
      />,
    )

    expect(screen.getByRole('button', { name: /Add case/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('This channel is archived')
  })
})

const CATEGORIES = FIRST_CHANNEL_BIBLE.caseCategories
const SECOND_CHANNEL_ID = '01J0000000000000000000000S'
const PSYCHOLOGY_CATEGORIES = [
  { key: 'experiment', label: 'Experiment' },
  { key: 'bias', label: 'Bias' },
]

describe('categories come from the channel bible', () => {
  it("lists the bible's categories in the add form, labelled", async () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={SECOND_CHANNEL_ID}
        categories={PSYCHOLOGY_CATEGORIES}
        cases={[]}
        sort="priority"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add case' }))
    const options = within(screen.getByLabelText('Category')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Experiment', 'Bias'])
    expect(screen.getByLabelText('Category')).toHaveValue('experiment')
  })

  it('renders a case whose key the bible no longer lists, as the key', () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={SECOND_CHANNEL_ID}
        categories={PSYCHOLOGY_CATEGORIES}
        cases={[kase({ category: 'collapse', status: 'shortlisted' })]}
        sort="priority"
      />,
    )
    const row = screen.getByText('Wirecard').closest('li')!
    expect(row).toHaveTextContent('collapse')
  })

  it('has no Suggest cases button on any channel', () => {
    for (const [id, categories] of [
      [SECOND_CHANNEL_ID, PSYCHOLOGY_CATEGORIES],
      [CHANNEL_ID, CATEGORIES],
    ] as const) {
      const { unmount } = render(
        <CaseLibrary
          slug="psychology"
          channelId={id}
          categories={categories}
          cases={[]}
          sort="priority"
        />,
      )
      expect(screen.queryByRole('button', { name: /Suggest cases/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add case' })).toBeInTheDocument()
      unmount()
    }
  })
})

const BRIEF: SearchBrief = {
  subject: 'WeWork',
  measuredAt: '2026-10-20T10:00:00.000Z',
  targetKeyword: {
    keyword: 'wework documentary',
    volume: 64,
    competition: 38,
    overall: 63,
    estimatedMonthlySearch: 1200,
    growthPct: null,
  },
  secondaryKeywords: [
    {
      keyword: 'what happened to wework',
      volume: 50,
      competition: 30,
      overall: 55,
      estimatedMonthlySearch: null,
      growthPct: null,
    },
    {
      keyword: 'wework $47 billion to bankruptcy',
      volume: 40,
      competition: 20,
      overall: 70,
      estimatedMonthlySearch: null,
      growthPct: null,
    },
  ],
  searchedQuestions: ['why did wework fail'],
  outliers: [
    {
      videoId: 'v1',
      title: 'The WeWork Collapse',
      channel: 'Some Channel',
      subscribers: 1000,
      views: 172000,
      breakoutScore: 40,
      publishedAt: null,
      tags: [],
    },
  ],
  titlePatterns: [],
  toldAlready: ['The Adam Neumann exit package'],
  angleOptions: [
    {
      angle: 'The valuation was the product, not the offices.',
      keyword: 'wework documentary',
      answers: ['why did wework fail'],
      gap: 'Nobody explains the lease arithmetic.',
    },
    {
      angle: 'How a landlord sold itself as a tech company.',
      keyword: 'what happened to wework',
      answers: [],
      gap: 'The IPO filing is skimmed.',
    },
  ],
  chosenAngle: 1,
}

function researched(over: Partial<CaseSummary> = {}) {
  return kase({
    status: 'shortlisted',
    title: 'WeWork',
    subject: 'WeWork',
    searchBrief: BRIEF,
    ...over,
  })
}

function renderRow(item: CaseSummary) {
  render(
    <CaseLibrary
      slug="psychology"
      channelId={CHANNEL_ID}
      categories={CATEGORIES}
      cases={[item]}
      sort="newest"
    />,
  )
  return screen.getByText(item.title, { selector: 'p' }).closest('li')!
}

const ESTIMATE = { ok: true, credits: 20, capLeft: 980, balance: 1443 }

describe('the case row: priority is gone', () => {
  it('shows no priority fact and no Priority sort button', () => {
    const row = renderRow(kase({ status: 'shortlisted', priorityScore: 88 }))
    expect(row).not.toHaveTextContent(/priority/i)
    expect(screen.queryByRole('button', { name: 'Priority' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Newest' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Research with VidIQ', () => {
  it('asks first, showing the estimate, cap left and balance, then starts the run', async () => {
    actions.caseResearchEstimate.mockResolvedValue(ESTIMATE)
    actions.researchCaseAction.mockResolvedValue({ ok: true })
    const row = renderRow(kase({ status: 'shortlisted', subject: 'Iomega' }))

    await userEvent.click(
      within(row).getByRole('button', { name: 'Research with VidIQ (about 20 credits)' }),
    )
    expect(actions.researchCaseAction).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(row).toHaveTextContent("About 20 credits. 980 left of this month's cap"),
    )
    expect(row).toHaveTextContent('VidIQ balance 1,443')

    await userEvent.click(within(row).getByRole('button', { name: 'Start research' }))
    await waitFor(() => expect(actions.researchCaseAction).toHaveBeenCalledWith(WIRECARD))
  })

  it('shows the refusal from the estimate in the confirm step', async () => {
    actions.caseResearchEstimate.mockResolvedValue({
      ok: false,
      error: 'Add a VidIQ key in Settings, Connections',
    })
    const row = renderRow(kase({ status: 'shortlisted', subject: 'Iomega' }))
    await userEvent.click(within(row).getByRole('button', { name: /^Research with VidIQ/ }))
    await waitFor(() => expect(row).toHaveTextContent('Add a VidIQ key in Settings, Connections'))
  })

  it('is disabled for a case with no subject', () => {
    const row = renderRow(kase({ status: 'shortlisted', subject: null }))
    expect(within(row).getByRole('button', { name: /^Research with VidIQ/ })).toBeDisabled()
  })

  it('shows the current step while the run goes, and polls every 3 seconds', () => {
    vi.useFakeTimers()
    try {
      const row = renderRow(
        kase({
          status: 'shortlisted',
          subject: 'Iomega',
          searchJob: {
            state: 'running',
            current: 'keywords-terms',
            error: null,
            startedAt: new Date().toISOString(),
            subject: 'Iomega',
          },
        }),
      )
      expect(row).toHaveTextContent('Finding search terms')
      expect(row).not.toHaveTextContent('keywords-terms')
      expect(within(row).queryByRole('button', { name: /^Research with VidIQ/ })).toBeNull()
      expect(refresh).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(refresh).toHaveBeenCalledTimes(1)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(refresh).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('names every step the researcher reports in plain words, and falls back to Researching', () => {
    const steps = {
      load: 'Starting',
      'keywords-terms': 'Finding search terms',
      'keywords-filter': 'Keeping the terms about the subject',
      'keywords-questions': 'Finding the questions people search',
      outliers: 'Finding the winning videos',
      'outlier-details': 'Reading the winning videos',
      winners: 'Studying the winning titles',
      angles: 'Drafting angle options',
      'save-brief': 'Saving the brief',
    }
    for (const [id, label] of Object.entries(steps)) {
      expect(researchStepLabel(id)).toBe(label)
    }
    expect(researchStepLabel('some-new-step')).toBe('Researching')
    expect(researchStepLabel(null)).toBe('Researching')
    for (const label of Object.values(steps)) expect(label).not.toMatch(/[\u2013\u2014]/)
  })

  it('shows a failed run with its error and Try again, which asks and then starts', async () => {
    actions.caseResearchEstimate.mockResolvedValue(ESTIMATE)
    actions.researchCaseAction.mockResolvedValue({ ok: true })
    const row = renderRow(
      kase({
        status: 'shortlisted',
        subject: 'Iomega',
        searchJob: {
          state: 'failed',
          current: null,
          error: 'VidIQ did not answer',
          startedAt: '2026-10-25T09:00:00.000Z',
          subject: 'Iomega',
        },
      }),
    )
    expect(row).toHaveTextContent('VidIQ did not answer')
    await userEvent.click(within(row).getByRole('button', { name: 'Try again' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Start research' }))
    await waitFor(() => expect(actions.researchCaseAction).toHaveBeenCalledWith(WIRECARD))
  })

  it('shows a run that stopped answering as failed, with Try again', () => {
    const row = renderRow(
      kase({
        status: 'shortlisted',
        subject: 'Iomega',
        searchJob: {
          state: 'running',
          current: 'Reading keyword demand',
          error: null,
          startedAt: '2026-01-01T09:00:00.000Z',
          subject: 'Iomega',
        },
      }),
    )
    expect(row).not.toHaveTextContent('Researching:')
    expect(row).toHaveTextContent('The research run stopped answering')
    expect(within(row).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('the Search brief panel', () => {
  it('is a collapsed details with the measured date, keywords, questions, outliers and told-already', () => {
    const row = renderRow(researched())
    const panel = within(row).getByText('Search brief').closest('details')!
    expect(panel).not.toHaveAttribute('open')
    expect(panel).toHaveTextContent('Measured 20 October 2026')
    expect(panel).toHaveTextContent('wework documentary')
    expect(panel).toHaveTextContent('volume 64')
    expect(panel).toHaveTextContent('what happened to wework')
    expect(panel).toHaveTextContent('why did wework fail')
    expect(panel).toHaveTextContent('The WeWork Collapse')
    expect(panel).toHaveTextContent('Some Channel')
    expect(panel).toHaveTextContent('172,000 views')
    expect(panel).toHaveTextContent('40x')
    expect(panel).toHaveTextContent('The Adam Neumann exit package')
    expect(panel).toHaveTextContent('The valuation was the product, not the offices.')
  })

  it('has no panel for a case without a brief', () => {
    const row = renderRow(kase({ status: 'shortlisted', subject: 'Iomega' }))
    expect(within(row).queryByText('Search brief')).not.toBeInTheDocument()
  })

  it('Use this angle chooses the option by its index, and the chosen option is marked', async () => {
    actions.chooseAngleAction.mockResolvedValue({ ok: true })
    const row = renderRow(researched({ searchBrief: { ...BRIEF, chosenAngle: 0 } }))
    const uses = within(row).getAllByRole('button', { name: 'Use this angle' })
    expect(within(row).getAllByText('Chosen')).toHaveLength(1)
    // The marked option is the first, so the one left to use is the second.
    expect(uses).toHaveLength(1)
    await userEvent.click(uses[0]!)
    await waitFor(() =>
      expect(actions.chooseAngleAction).toHaveBeenCalledWith(WIRECARD, { option: 1 }),
    )
  })

  it('Keep my own angle opens a box and saves the words as the angle', async () => {
    actions.chooseAngleAction.mockResolvedValue({ ok: true })
    const row = renderRow(researched({ angle: 'My own take' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Keep my own angle' }))
    const box = within(row).getByLabelText('Your angle')
    expect(box).toHaveValue('My own take')
    await userEvent.clear(box)
    await userEvent.type(box, 'The auditors are the story')
    await userEvent.click(within(row).getByRole('button', { name: 'Save my angle' }))
    await waitFor(() =>
      expect(actions.chooseAngleAction).toHaveBeenCalledWith(WIRECARD, {
        own: 'The auditors are the story',
      }),
    )
  })

  it('Make target is on each secondary keyword except one with a figure', async () => {
    actions.setTargetKeywordAction.mockResolvedValue({ ok: true })
    const row = renderRow(researched())
    const makes = within(row).getAllByRole('button', { name: 'Make target' })
    expect(makes).toHaveLength(1)
    await userEvent.click(makes[0]!)
    await waitFor(() =>
      expect(actions.setTargetKeywordAction).toHaveBeenCalledWith(
        WIRECARD,
        'what happened to wework',
      ),
    )
  })

  it('says the research is for another subject, offers Research again, and hides the choosers', () => {
    const row = renderRow(researched({ subject: 'We Company' }))
    expect(row).toHaveTextContent('This research is for WeWork. Research again for We Company.')
    expect(
      within(row).getByRole('button', { name: 'Research again with VidIQ (about 20 credits)' }),
    ).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Use this angle' })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Make target' })).not.toBeInTheDocument()
  })

  it('does not call a matching subject a mismatch, whatever its case or spacing', () => {
    const row = renderRow(researched({ subject: '  wework ' }))
    expect(row).not.toHaveTextContent('This research is for')
    expect(
      within(row).getByRole('button', { name: 'Research again with VidIQ (about 20 credits)' }),
    ).toBeInTheDocument()
  })

  it('offers Research again whenever a brief exists, and plain Research when none does', () => {
    const withBrief = renderRow(researched())
    expect(
      within(withBrief).getByRole('button', { name: /^Research again with VidIQ/ }),
    ).toBeInTheDocument()
    const without = renderRow(kase({ status: 'shortlisted', subject: 'Iomega' }))
    expect(
      within(without).getByRole('button', { name: 'Research with VidIQ (about 20 credits)' }),
    ).toBeInTheDocument()
  })

  it('hides "Searched as" for an option with no keyword', () => {
    const options = BRIEF.angleOptions.map((option, at) => ({
      ...option,
      keyword: at === 0 ? '' : option.keyword,
    }))
    const row = renderRow(researched({ searchBrief: { ...BRIEF, angleOptions: options } }))
    expect(within(row).getAllByText(/Searched as/)).toHaveLength(options.length - 1)
    expect(row).not.toHaveTextContent('Searched as .')
    expect(row).toHaveTextContent(options[0]!.gap)
  })

  it('Use this angle and Make target are locked while one is pending, so a double click sends once', async () => {
    let release: (value: { ok: boolean }) => void = () => {}
    actions.chooseAngleAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const row = renderRow(researched())
    const use = within(row).getAllByRole('button', { name: 'Use this angle' })[0]!
    await userEvent.dblClick(use)
    expect(actions.chooseAngleAction).toHaveBeenCalledTimes(1)
    expect(use).toBeDisabled()
    // The other chooser waits too, so two choices cannot race.
    expect(within(row).getByRole('button', { name: 'Make target' })).toBeDisabled()
    release({ ok: true })
    await waitFor(() => expect(use).not.toBeDisabled())

    let release2: (value: { ok: boolean }) => void = () => {}
    actions.setTargetKeywordAction.mockReturnValue(
      new Promise((resolve) => {
        release2 = resolve
      }),
    )
    const make = within(row).getByRole('button', { name: 'Make target' })
    await userEvent.dblClick(make)
    expect(actions.setTargetKeywordAction).toHaveBeenCalledTimes(1)
    release2({ ok: true })
  })
})

describe('New project and a stale brief', () => {
  const OLD_BRIEF = { ...BRIEF, measuredAt: new Date(Date.now() - 45 * 86_400_000).toISOString() }

  it('starts directly with no brief', async () => {
    actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
    const row = renderRow(kase({ status: 'shortlisted' }))
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    await waitFor(() => expect(actions.startProjectFromCase).toHaveBeenCalledWith(WIRECARD))
    expect(push).toHaveBeenCalledWith('/c/psychology/projects')
  })

  it('starts directly with a fresh brief', async () => {
    actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
    const fresh = { ...BRIEF, measuredAt: new Date().toISOString() }
    const row = renderRow(researched({ searchBrief: fresh }))
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    await waitFor(() => expect(actions.startProjectFromCase).toHaveBeenCalledTimes(1))
  })

  it('asks first when the brief is over 30 days old; Refresh research starts the run and no project', async () => {
    actions.researchCaseAction.mockResolvedValue({ ok: true })
    const row = renderRow(researched({ searchBrief: OLD_BRIEF }))
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    expect(actions.startProjectFromCase).not.toHaveBeenCalled()
    expect(row).toHaveTextContent('The search research is 45 days old.')

    await userEvent.click(
      within(row).getByRole('button', { name: 'Refresh research (about 20 credits)' }),
    )
    await waitFor(() => expect(actions.researchCaseAction).toHaveBeenCalledWith(WIRECARD))
    expect(actions.startProjectFromCase).not.toHaveBeenCalled()
  })

  it('Start without refreshing starts the project', async () => {
    actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
    const row = renderRow(researched({ searchBrief: OLD_BRIEF }))
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Start without refreshing' }))
    await waitFor(() => expect(actions.startProjectFromCase).toHaveBeenCalledWith(WIRECARD))
    expect(actions.researchCaseAction).not.toHaveBeenCalled()
  })

  it('starts directly when the old brief is for another subject, since none is frozen', async () => {
    actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
    const row = renderRow(researched({ subject: 'We Company', searchBrief: OLD_BRIEF }))
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    await waitFor(() => expect(actions.startProjectFromCase).toHaveBeenCalledTimes(1))
  })
})
