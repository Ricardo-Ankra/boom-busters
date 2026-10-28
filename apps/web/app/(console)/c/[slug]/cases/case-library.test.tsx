import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
import { FIRST_CHANNEL_ID as CHANNEL_ID } from '@boom-busters/schemas'
import type { Notice } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaseLibrary } from './case-library'

/**
 * The Case Library's notices (decision 293): a suggestion's repairs on its
 * own row, and a dropped suggestion, which has no row, in the toast.
 */

const actions = vi.hoisted(() => ({
  acceptCase: vi.fn(),
  addCase: vi.fn(),
  editCase: vi.fn(),
  dismissCase: vi.fn(),
  setStatus: vi.fn(),
  startProjectFromCase: vi.fn(),
  suggestCases: vi.fn(),
}))
vi.mock('./actions', () => actions)
// The notice's Dismiss is a server action whose module loads next-auth,
// which cannot load under jsdom.
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
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
        cases={[kase({})]}
        sort="priority"
        notices={[trimmed]}
      />,
    )
    const row = screen.getByText('Wirecard').closest('li')!

    await userEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))
    expect(actions.dismissCase).not.toHaveBeenCalled()
    expect(row).toHaveTextContent('This suggestion is deleted. Suggest cases again for new ones.')

    await userEvent.click(within(row).getByRole('button', { name: 'Dismiss it' }))
    await waitFor(() => expect(actions.dismissCase).toHaveBeenCalledWith(WIRECARD))
  })

  it('says a suggestion with projects behind it is retired, not deleted', async () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
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

  it('names a dropped suggestion in the success toast', async () => {
    const dropped =
      'Dropped suggestion 3 ("The very long case..."): its title ran over 200 characters.'
    actions.suggestCases.mockResolvedValue({
      ok: true,
      created: 2,
      skipped: 0,
      mocked: false,
      notice: dropped,
    })
    render(<CaseLibrary slug="psychology" channelId={CHANNEL_ID} cases={[]} sort="priority" />)

    await userEvent.click(screen.getByRole('button', { name: 'Suggest cases' }))
    await userEvent.click(screen.getByRole('button', { name: 'Get suggestions' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: '2 new, 0 already in your library',
        description: dropped,
      }),
    )
  })
})

describe('the case form: subject, people and source links', () => {
  async function openAddForm() {
    render(<CaseLibrary slug="psychology" channelId={CHANNEL_ID} cases={[]} sort="priority" />)
    await userEvent.click(screen.getByRole('button', { name: 'Add case' }))
  }

  it('prefills Subject from the title before its first colon while the box is empty', async () => {
    await openAddForm()
    await userEvent.type(screen.getByLabelText('Title'), 'Wirecard: the missing billion')
    expect(screen.getByLabelText('Subject')).toHaveValue('Wirecard')
    await userEvent.clear(screen.getByLabelText('Subject'))
    await userEvent.type(screen.getByLabelText('Subject'), 'Wirecard AG')
    await userEvent.type(screen.getByLabelText('Title'), ' and more')
    expect(screen.getByLabelText('Subject')).toHaveValue('Wirecard AG')
  })

  it('sends the three fields to addCase', async () => {
    actions.addCase.mockResolvedValue({ ok: true })
    await openAddForm()
    await userEvent.type(screen.getByLabelText('Title'), 'Wirecard')
    await userEvent.type(screen.getByLabelText('People'), 'Markus Braun, Jan Marsalek')
    await userEvent.type(
      screen.getByLabelText('Source links'),
      'https://example.com/a{enter}https://example.com/b',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() =>
      expect(actions.addCase).toHaveBeenCalledWith(
        CHANNEL_ID,
        expect.objectContaining({
          title: 'Wirecard',
          subject: 'Wirecard',
          people: ['Markus Braun', 'Jan Marsalek'],
          sourceLinks: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
        }),
      ),
    )
  })

  it('shows the same three fields when editing, and saves them', async () => {
    actions.editCase.mockResolvedValue({ ok: true })
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
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
  it('disables Suggest cases and New project and links to the Channel tab', () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        cases={[kase({ status: 'shortlisted' })]}
        sort="priority"
        bibleComplete={false}
      />,
    )

    expect(screen.getByRole('button', { name: /Suggest cases/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Complete the channel bible in Settings first',
    )
    expect(screen.getByRole('link', { name: 'Open the Channel tab' })).toHaveAttribute(
      'href',
      '/c/psychology/settings?tab=channel',
    )
  })

  it('leaves both enabled once the bible is complete', () => {
    render(
      <CaseLibrary
        slug="psychology"
        channelId={CHANNEL_ID}
        cases={[kase({ status: 'shortlisted' })]}
        sort="priority"
      />,
    )
    expect(screen.getByRole('button', { name: /Suggest cases/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('CaseLibrary for an archived channel', () => {
  it('disables Suggest, Add and New project with the archived notice', () => {
    render(
      <CaseLibrary
        slug="old"
        channelId={CHANNEL_ID}
        cases={[kase({ status: 'shortlisted' })]}
        sort="priority"
        archived
      />,
    )

    expect(screen.getByRole('button', { name: /Suggest cases/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Add case/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('This channel is archived')
  })
})
