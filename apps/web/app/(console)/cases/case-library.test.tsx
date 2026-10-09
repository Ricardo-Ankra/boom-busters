import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
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
    expect(within(noticeLine).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    const theranos = screen.getByText('Theranos').closest('li')!
    expect(within(theranos).queryByRole('status')).not.toBeInTheDocument()
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
    render(<CaseLibrary cases={[]} sort="priority" />)

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
