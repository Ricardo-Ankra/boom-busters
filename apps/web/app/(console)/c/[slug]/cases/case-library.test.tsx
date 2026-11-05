import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
import {
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID as CHANNEL_ID,
  defaultFormat,
} from '@boom-busters/schemas'
import type { Notice, SearchBrief } from '@boom-busters/schemas'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaseLibrary } from './case-library'
import { resolveSelected } from './case-progress'
import { researchStepLabel } from './research-steps'

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
  setCaseFormatAction: vi.fn(),
  estimateStartCostAction: vi.fn(),
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

type LibraryProps = Omit<ComponentProps<typeof CaseLibrary>, 'selectedId' | 'explicit'> &
  Partial<Pick<ComponentProps<typeof CaseLibrary>, 'selectedId' | 'explicit'>>

/** The library as the page renders it: the open case is what `resolveSelected` picks, unless a test says. */
function Library({ selectedId, explicit, ...props }: LibraryProps) {
  const resolved = resolveSelected(props.cases, undefined)
  return (
    <CaseLibrary
      {...props}
      selectedId={selectedId === undefined ? resolved.selectedId : selectedId}
      explicit={explicit ?? resolved.explicit}
    />
  )
}

/** The open case's panel: every control for the case sits inside it. */
const panelOf = (title: string) => screen.getByRole('region', { name: title })

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
  actions.estimateStartCostAction.mockResolvedValue({
    usd: null,
    basis: 'No estimate yet: no finished projects',
  })
})

describe('CaseLibrary notices (decision 293)', () => {
  it("shows a case's notice in its own panel and no other", () => {
    const cases = [kase({}), kase({ id: THERANOS, title: 'Theranos', status: 'shortlisted' })]
    const view = render(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={cases}
        sort="priority"
        notices={[trimmed]}
        selectedId={WIRECARD}
      />,
    )
    const wirecard = panelOf('Wirecard')
    expect(within(wirecard).getByRole('status')).toHaveTextContent(
      'Trimmed to fit: the angle of Wirecard.',
    )
    // The panel has the case's own Dismiss too; the notice's sits on its line.
    const noticeLine = within(wirecard).getByRole('status').parentElement!
    expect(within(noticeLine).getByRole('button', { name: 'Dismiss note' })).toBeInTheDocument()

    view.rerender(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={cases}
        sort="priority"
        notices={[trimmed]}
        selectedId={THERANOS}
      />,
    )
    expect(within(panelOf('Theranos')).queryByRole('status')).not.toBeInTheDocument()
  })

  it("asks before a suggestion's Dismiss deletes it (decision 294)", async () => {
    actions.dismissCase.mockResolvedValue({ ok: true })
    render(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[kase({})]}
        sort="priority"
        notices={[trimmed]}
      />,
    )
    const row = panelOf('Wirecard')

    await userEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))
    expect(actions.dismissCase).not.toHaveBeenCalled()
    expect(row).toHaveTextContent('This suggestion is deleted.')

    await userEvent.click(within(row).getByRole('button', { name: 'Dismiss it' }))
    await waitFor(() => expect(actions.dismissCase).toHaveBeenCalledWith(WIRECARD))
  })

  it('says a suggestion with projects behind it is retired, not deleted', async () => {
    render(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[kase({ projectCount: 2 })]}
        sort="priority"
      />,
    )
    const row = panelOf('Wirecard')

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
      <Library
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
      .getAllByText(/^(Subject|Angle idea|Title|Category|People|Source links)$/, {
        selector: 'label',
      })
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
      <Library
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
    const row = panelOf('Wirecard')
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
      <Library
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
      <Library
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
      <Library
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
      <Library
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
      <Library
        slug="psychology"
        channelId={SECOND_CHANNEL_ID}
        categories={PSYCHOLOGY_CATEGORIES}
        cases={[kase({ category: 'collapse', status: 'shortlisted' })]}
        sort="priority"
      />,
    )
    const row = panelOf('Wirecard')
    expect(row).toHaveTextContent('collapse')
  })

  it('has no Suggest cases button on any channel', () => {
    for (const [id, categories] of [
      [SECOND_CHANNEL_ID, PSYCHOLOGY_CATEGORIES],
      [CHANNEL_ID, CATEGORIES],
    ] as const) {
      const { unmount } = render(
        <Library
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
  formatKey: null,
  fit: null,
  searchedTitles: [],
  otherLanguages: [],
  recommendedAngle: null,
  recommendationReason: null,
  ownAngle: false,
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
    <Library
      slug="psychology"
      channelId={CHANNEL_ID}
      categories={CATEGORIES}
      cases={[item]}
      sort="newest"
    />,
  )
  return panelOf(item.title)
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
      'keywords-format': 'Finding search terms for the format',
      'keywords-filter': 'Keeping the terms about the subject',
      fit: 'Checking the subject fits the channel',
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

describe('the case panel and its research', () => {
  it('says the research is for another subject, offers Research again, and hides the choosers', () => {
    const row = renderRow(researched({ subject: 'We Company' }))
    expect(row).toHaveTextContent('This research is for WeWork. Research again for We Company.')
    expect(
      within(row).getByRole('button', { name: 'Research again with VidIQ (about 20 credits)' }),
    ).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /^Use this angle/ })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /^Make target/ })).not.toBeInTheDocument()
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
})

describe('New project and a stale brief', () => {
  const OLD_BRIEF = { ...BRIEF, measuredAt: new Date(Date.now() - 45 * 86_400_000).toISOString() }

  it('starts directly with no brief', async () => {
    actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
    const row = renderRow(kase({ status: 'shortlisted' }))
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    await waitFor(() =>
      expect(actions.startProjectFromCase).toHaveBeenCalledWith(WIRECARD, 15, undefined),
    )
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
    await waitFor(() =>
      expect(actions.startProjectFromCase).toHaveBeenCalledWith(WIRECARD, 15, undefined),
    )
    expect(actions.researchCaseAction).not.toHaveBeenCalled()
  })

  it('starts directly when the old brief is for another subject, since none is frozen', async () => {
    actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
    const row = renderRow(researched({ subject: 'We Company', searchBrief: OLD_BRIEF }))
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    await waitFor(() => expect(actions.startProjectFromCase).toHaveBeenCalledTimes(1))
  })
})

describe('the case format picker', () => {
  const sleep = {
    ...defaultFormat('Sleep'),
    key: 'sleep',
    primary: false,
    keywords: ['sleep documentary'],
  }
  const two = [defaultFormat('Main'), sleep]

  function renderWith(formats: typeof two, item: CaseSummary) {
    render(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[item]}
        sort="newest"
        formats={formats}
      />,
    )
    return panelOf(item.title)
  }

  it('shows no picker for a channel with one format', () => {
    const row = renderWith([defaultFormat('Main')], kase({ status: 'shortlisted' }))
    expect(within(row).queryByLabelText('Format')).not.toBeInTheDocument()
  })

  it('shows a Format select with an option per format, and choosing saves it', async () => {
    actions.setCaseFormatAction.mockResolvedValue({ ok: true })
    const row = renderWith(two, kase({ status: 'shortlisted' }))
    const select = within(row).getByLabelText('Format')
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Main', 'Sleep'])
    expect(select).toHaveValue('main')
    await userEvent.selectOptions(select, 'sleep')
    await waitFor(() => expect(actions.setCaseFormatAction).toHaveBeenCalledWith(WIRECARD, 'sleep'))
  })

  it('shows the primary selected when the stored key is no longer in the bible', () => {
    const row = renderWith(two, kase({ status: 'shortlisted', formatKey: 'gone' }))
    expect(within(row).getByLabelText('Format')).toHaveValue('main')
  })

  it('labels the research button 25 credits when the selected format has a lead keyword', () => {
    const withSeed = renderWith(
      two,
      kase({ status: 'shortlisted', subject: 'Iomega', formatKey: 'sleep' }),
    )
    expect(
      within(withSeed).getByRole('button', { name: 'Research with VidIQ (about 25 credits)' }),
    ).toBeInTheDocument()
  })

  it('keeps 20 credits when the selected format has no keyword', () => {
    const row = renderWith(two, kase({ status: 'shortlisted', subject: 'Iomega' }))
    expect(
      within(row).getByRole('button', { name: 'Research with VidIQ (about 20 credits)' }),
    ).toBeInTheDocument()
  })
})

describe('the channel fit on the case row', () => {
  const fitted = (fit: NonNullable<typeof BRIEF.fit>, category = 'con') =>
    researched({ category, searchBrief: { ...BRIEF, fit } })

  it('warns when the subject is outside the pillars, with the reason', () => {
    const row = renderRow(
      fitted({ inScope: false, pillarKey: null, reason: 'It is a sleep guide.' }),
    )
    expect(row).toHaveTextContent("Outside this channel's pillars: It is a sleep guide.")
  })

  it("names the better pillar by its label when it is not the case's own", () => {
    const row = renderRow(fitted({ inScope: true, pillarKey: 'collapse', reason: 'A slow fall.' }))
    expect(row).toHaveTextContent('Fits Collapse better: A slow fall.')
  })

  it("says nothing when the fit is the case's own pillar, and blocks nothing", () => {
    const row = renderRow(fitted({ inScope: true, pillarKey: 'con', reason: 'A con.' }))
    expect(row).not.toHaveTextContent('better')
    expect(row).not.toHaveTextContent('Outside this channel')
    expect(within(row).getByRole('button', { name: 'New project' })).toBeEnabled()
  })
})

describe('the start control: format, length and cost', () => {
  const long = {
    ...defaultFormat('Long'),
    key: 'long',
    primary: false,
    runtime: { default: 90, min: 3, max: 180 },
  }
  const short = {
    ...defaultFormat('Short'),
    key: 'short',
    primary: false,
    runtime: { default: 8, min: 5, max: 10 },
  }
  const formats = [defaultFormat('Main'), long, short]

  function renderStart(item: CaseSummary, withFormats = formats) {
    render(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[item]}
        sort="newest"
        formats={withFormats}
      />,
    )
    return panelOf(item.title)
  }

  it('defaults the length to the format default clamped to 30, with the not-supported note', async () => {
    actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
    const row = renderStart(kase({ status: 'shortlisted', formatKey: 'long' }))
    expect(within(row).getByLabelText('Length in minutes')).toHaveValue(30)
    expect(row).toHaveTextContent('Videos longer than 30 minutes are not supported yet')
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    await waitFor(() =>
      expect(actions.startProjectFromCase).toHaveBeenCalledWith(WIRECARD, 30, undefined),
    )
  })

  it('shows no note for a format inside the start limit', () => {
    const row = renderStart(kase({ status: 'shortlisted', formatKey: 'short' }))
    expect(within(row).getByLabelText('Length in minutes')).toHaveValue(8)
    expect(row).not.toHaveTextContent('not supported yet')
  })

  it('sets the field range from the format, capped at 30', () => {
    const row = renderStart(kase({ status: 'shortlisted', formatKey: 'long' }))
    const field = within(row).getByLabelText('Length in minutes')
    expect(field).toHaveAttribute('min', '3')
    expect(field).toHaveAttribute('max', '30')
  })

  it('offers a start format only for more than one format, and starting with another sends its key and default', async () => {
    actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
    const one = renderStart(kase({ status: 'shortlisted' }), [defaultFormat('Main')])
    expect(within(one).queryByLabelText('Start format')).not.toBeInTheDocument()
    cleanup()

    const row = renderStart(kase({ status: 'shortlisted' }))
    const select = within(row).getByLabelText('Start format')
    expect(select).toHaveValue('main')
    await userEvent.selectOptions(select, 'short')
    expect(within(row).getByLabelText('Length in minutes')).toHaveValue(8)
    await userEvent.click(within(row).getByRole('button', { name: 'New project' }))
    await waitFor(() =>
      expect(actions.startProjectFromCase).toHaveBeenCalledWith(WIRECARD, 8, 'short'),
    )
  })

  it('shows the estimate for the length and asks again when it changes', async () => {
    actions.estimateStartCostAction.mockResolvedValue({
      usd: 12.4,
      basis: 'About $12.40, from 6 finished projects',
    })
    const row = renderStart(kase({ status: 'shortlisted' }))
    await waitFor(() => expect(row).toHaveTextContent('About $12.40, from 6 finished projects'))
    expect(actions.estimateStartCostAction).toHaveBeenLastCalledWith(CHANNEL_ID, 15)
    const field = within(row).getByLabelText('Length in minutes')
    await userEvent.clear(field)
    await userEvent.type(field, '20')
    await waitFor(() =>
      expect(actions.estimateStartCostAction).toHaveBeenLastCalledWith(CHANNEL_ID, 20),
    )
  })

  it('disables New project while the length is outside the range', async () => {
    const row = renderStart(kase({ status: 'shortlisted', formatKey: 'short' }))
    const field = within(row).getByLabelText('Length in minutes')
    await userEvent.clear(field)
    await userEvent.type(field, '45')
    expect(within(row).getByRole('button', { name: 'New project' })).toBeDisabled()
    expect(row).toHaveTextContent('This format runs 5 to 10 minutes')
  })

  it('for a format longer than the start limit disables the field and the button, showing only the note', () => {
    const huge = {
      ...defaultFormat('Huge'),
      key: 'huge',
      primary: false,
      runtime: { default: 90, min: 90, max: 180 },
    }
    const row = renderStart(kase({ status: 'shortlisted', formatKey: 'huge' }), [...formats, huge])
    const field = within(row).getByLabelText('Length in minutes')
    expect(field).toBeDisabled()
    expect(field).not.toHaveAttribute('min')
    expect(within(row).getByRole('button', { name: 'New project' })).toBeDisabled()
    expect(row).toHaveTextContent('Videos longer than 30 minutes are not supported yet')
    expect(row).not.toHaveTextContent('This format runs')
  })

  describe('a brief researched for another format', () => {
    const briefFor = (formatKey: string | null) =>
      researched({ formatKey: null, searchBrief: { ...BRIEF, formatKey } })

    it("says so in one line, naming the brief's format, and still lets the project start", async () => {
      actions.startProjectFromCase.mockResolvedValue({ ok: true, projectId: 'P1' })
      const row = renderStart(briefFor('short'))
      expect(within(row).getByLabelText('Start format')).toHaveValue('main')
      expect(row).toHaveTextContent('Researched for the Short format.')
      expect(within(row).getByRole('button', { name: 'New project' })).toBeEnabled()
    })

    it('follows the chosen format: the note goes when the start format matches the brief', async () => {
      const row = renderStart(briefFor('short'))
      await userEvent.selectOptions(within(row).getByLabelText('Start format'), 'short')
      expect(row).not.toHaveTextContent('Researched for the')
    })

    it('says nothing when the brief was researched for the chosen format, or for none', () => {
      const same = renderStart(
        researched({ formatKey: 'short', searchBrief: { ...BRIEF, formatKey: 'short' } }),
      )
      expect(same).not.toHaveTextContent('Researched for the')
      cleanup()
      const none = renderStart(briefFor(null))
      expect(none).not.toHaveTextContent('Researched for the')
    })

    it("names the key when the brief's format is no longer in the bible", () => {
      const row = renderStart(briefFor('retired'))
      expect(row).toHaveTextContent('Researched for the retired format.')
    })
  })

  it("follows the case's format when the row picker changes it", async () => {
    actions.setCaseFormatAction.mockResolvedValue({ ok: true })
    const item = kase({ status: 'shortlisted', formatKey: 'short' })
    const view = render(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[item]}
        sort="newest"
        formats={formats}
      />,
    )
    const row = panelOf(item.title)
    expect(within(row).getByLabelText('Length in minutes')).toHaveValue(8)
    view.rerender(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[{ ...item, formatKey: 'main' }]}
        sort="newest"
        formats={formats}
      />,
    )
    expect(within(row).getByLabelText('Start format')).toHaveValue('main')
    expect(within(row).getByLabelText('Length in minutes')).toHaveValue(15)
  })
})

describe('the two panes', () => {
  const second = kase({ id: THERANOS, title: 'Theranos', status: 'shortlisted' })
  const first = kase({ title: 'Wirecard', status: 'in_production', projectCount: 1 })

  function renderLibrary(over: Partial<LibraryProps> = {}) {
    return render(
      <Library
        slug="psychology"
        channelId={CHANNEL_ID}
        categories={CATEGORIES}
        cases={[first, second]}
        sort="status"
        {...over}
      />,
    )
  }

  it('opens the first case without a case id', () => {
    renderLibrary()
    expect(screen.getByRole('heading', { level: 2, name: 'Wirecard' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Theranos' })).not.toBeInTheDocument()
  })

  it('links each row to its case and keeps the sort', () => {
    renderLibrary()
    const list = screen.getByRole('navigation', { name: 'Cases' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/c/psychology/cases?sort=status&case=${WIRECARD}`,
      `/c/psychology/cases?sort=status&case=${THERANOS}`,
    ])
  })

  it('marks the open row current', () => {
    renderLibrary({ selectedId: THERANOS, explicit: true })
    const list = screen.getByRole('navigation', { name: 'Cases' })
    const current = within(list).getAllByRole('link', { current: true })
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Theranos')
  })

  it('shows each row as title, status, projects and the angle signal', () => {
    renderLibrary()
    const row = within(screen.getByRole('navigation', { name: 'Cases' })).getByRole('link', {
      name: /Wirecard/,
    })
    expect(row).toHaveTextContent('In production')
    expect(row).toHaveTextContent('1 project')
    expect(row).toHaveTextContent('Not researched')
  })

  it('groups suggestions apart from the backlog', () => {
    renderLibrary({ cases: [kase({ id: THERANOS, title: 'Idea one' }), first] })
    const list = screen.getByRole('navigation', { name: 'Cases' })
    expect(list).toHaveTextContent('Suggested')
    expect(list).toHaveTextContent('Backlog')
  })

  it('shows the list alone below xl until a case is named, then the case with Back to cases', () => {
    const view = renderLibrary()
    const list = screen.getByRole('navigation', { name: 'Cases' }).parentElement!
    const panel = panelOf('Wirecard').parentElement!
    expect(list.className).not.toContain('hidden')
    expect(panel.className).toContain('hidden xl:block')
    expect(screen.queryByRole('link', { name: 'Back to cases' })).not.toBeInTheDocument()

    view.unmount()
    renderLibrary({ selectedId: THERANOS, explicit: true })
    expect(screen.getByRole('navigation', { name: 'Cases' }).parentElement!.className).toContain(
      'hidden xl:flex',
    )
    expect(panelOf('Theranos').parentElement!.className).not.toContain('hidden')
    const back = screen.getByRole('link', { name: 'Back to cases' })
    expect(back).toHaveAttribute('href', '/c/psychology/cases?sort=status')
    expect(back.className).toContain('xl:hidden')
  })

  it('opens the add form in the panel area, and Cancel closes it', async () => {
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Add case' }))
    expect(screen.getByLabelText('Subject')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Wirecard' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument()
    expect(panelOf('Wirecard')).toBeInTheDocument()
  })

  it('prompts to add a case in the panel when the library is empty', async () => {
    renderLibrary({ cases: [] })
    expect(screen.getByRole('heading', { name: 'Add a case' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add case' }))
    expect(screen.getByLabelText('Subject')).toBeInTheDocument()
  })

  it('keeps the sort buttons, and a sort change keeps an explicitly open case', async () => {
    renderLibrary({ selectedId: THERANOS, explicit: true })
    await userEvent.click(screen.getByRole('button', { name: 'Newest' }))
    expect(push).toHaveBeenCalledWith(`/c/psychology/cases?sort=newest&case=${THERANOS}`)
  })
})
