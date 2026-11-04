import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReferencesSection, type ReferenceView } from './references-section'

/**
 * The References section of the Motion tab (spec 2026-11-04, section 11.2):
 * the guideline's short form, the pack as cards, and the buttons that read,
 * edit, archive and open a reference's sheets and reading.
 */

const CH = '01J00000000000000000000001'

const actions = vi.hoisted(() => ({
  createReferenceUploadAction: vi.fn(),
  createReferenceFrameUploadsAction: vi.fn(),
  finaliseReferenceAction: vi.fn(),
  updateReferenceAction: vi.fn(),
  remarkReferenceAction: vi.fn(),
  readReferenceAction: vi.fn(),
  saveReadingAction: vi.fn(),
  archiveReferenceAction: vi.fn(),
  draftMotionIdentityAction: vi.fn(),
}))
vi.mock('./motion-actions', () => actions)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

function view(over: Partial<ReferenceView> = {}): ReferenceView {
  return {
    id: '01J000000000000000000000R1',
    kind: 'video',
    title: 'Numeral over a changing background',
    sourceUrl: 'https://example.com/reel',
    rights: 'Reference only',
    purpose: 'mechanism',
    negative: false,
    windowStartMs: 1000,
    windowEndMs: 3500,
    carryOver: 'borrow the held numeral, not the story',
    avoid: 'not the glow',
    readState: 'reading',
    readError: null,
    reading: null,
    thumbUrl: 'https://r2.example/thumb.jpg',
    denseSheetUrl: null,
    contactSheetUrl: null,
    clipUrl: 'https://r2.example/clip.mp4',
    contentHash: 'a'.repeat(64),
    durationMs: 10_000,
    width: 1920,
    height: 1080,
    ...over,
  }
}

const READ = view({
  id: '01J000000000000000000000R2',
  readState: 'read',
  denseSheetUrl: 'https://r2.example/dense.jpg',
  contactSheetUrl: 'https://r2.example/contact.jpg',
  reading: {
    medium: 'flat typography',
    palette: ['#111', '#eee'],
    type: 'grotesk, heavy',
    enters: 'rises',
    exits: 'cuts',
    motion: 'one numeral holds',
    absent: 'no glow',
    notes: '',
    readAt: '2026-11-04T10:00:00.000Z',
    model: 'anthropic/claude-opus-5-5',
  },
})

function renderSection(
  references: ReferenceView[],
  over: Partial<React.ComponentProps<typeof ReferencesSection>> = {},
) {
  return render(
    <ReferencesSection
      channelId={CH}
      references={references}
      storageReady
      readingEstimateUsd={0.042}
      archived={false}
      {...over}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.readReferenceAction.mockResolvedValue({ ok: true })
  actions.archiveReferenceAction.mockResolvedValue({ ok: true })
  actions.saveReadingAction.mockResolvedValue({ ok: true })
  actions.updateReferenceAction.mockResolvedValue({ ok: true })
})

describe('ReferencesSection', () => {
  it('shows the short guideline and opens the full one', async () => {
    renderSection([])
    expect(screen.getByText(/^Four to eight references/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Read the full guideline' }))
    const dialog = screen.getByRole('dialog', { name: 'The reference guideline' })
    expect(within(dialog).getByText('What makes a good reference')).toBeInTheDocument()
  })

  it('says why uploads need storage and disables Add reference', () => {
    renderSection([], { storageReady: false })
    expect(screen.getByText(/R2 configured/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add reference' })).toBeDisabled()
  })

  it('lists a reference with its purpose, window, carry-over and read state', () => {
    renderSection([
      view(),
      view({ id: 'x', readState: 'failed', readError: 'over budget', negative: true }),
    ])
    expect(screen.getAllByText('Numeral over a changing background')).toHaveLength(2)
    expect(screen.getAllByText('mechanism')).toHaveLength(2)
    expect(screen.getAllByText('1.0 to 3.5 s')).toHaveLength(2)
    expect(screen.getAllByText('borrow the held numeral, not the story')).toHaveLength(2)
    expect(screen.getByText('Reading...')).toBeInTheDocument()
    expect(screen.getByText('Failed: over budget')).toBeInTheDocument()
    expect(screen.getByText('negative')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /first frame/i })[0]).toHaveAttribute(
      'src',
      'https://r2.example/thumb.jpg',
    )
  })

  it("reads an unread reference on the owner's word", async () => {
    renderSection([view({ readState: 'unread' })])
    await userEvent.click(screen.getByRole('button', { name: 'Read' }))
    await waitFor(() => expect(actions.readReferenceAction).toHaveBeenCalledWith(CH, view().id))
    expect(refresh).toHaveBeenCalled()
  })

  it('archives after a second confirmation', async () => {
    renderSection([view({ readState: 'unread' })])
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(actions.archiveReferenceAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Archive for good' }))
    await waitFor(() => expect(actions.archiveReferenceAction).toHaveBeenCalledWith(CH, view().id))
  })

  it('saves an edited reading with every field', async () => {
    renderSection([READ])
    await userEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('img', { name: /dense sheet/i })).toHaveAttribute(
      'src',
      'https://r2.example/dense.jpg',
    )
    expect(screen.getByText('one numeral holds')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit reading' }))
    const motion = screen.getByLabelText('Motion')
    await userEvent.clear(motion)
    await userEvent.type(motion, 'the numeral holds for two seconds')
    await userEvent.click(screen.getByRole('button', { name: 'Save reading' }))
    await waitFor(() => expect(actions.saveReadingAction).toHaveBeenCalled())
    expect(actions.saveReadingAction).toHaveBeenCalledWith(CH, {
      id: READ.id,
      reading: {
        medium: 'flat typography',
        palette: ['#111', '#eee'],
        type: 'grotesk, heavy',
        enters: 'rises',
        exits: 'cuts',
        motion: 'the numeral holds for two seconds',
        absent: 'no glow',
        notes: '',
      },
    })
  })

  it('edits the words on the card', async () => {
    renderSection([READ])
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const title = screen.getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Renamed')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(actions.updateReferenceAction).toHaveBeenCalled())
    expect(actions.updateReferenceAction.mock.calls[0]![1]).toMatchObject({
      id: READ.id,
      input: expect.objectContaining({ title: 'Renamed', purpose: 'mechanism' }),
    })
  })

  it('disables every button on an archived channel', () => {
    renderSection([view({ readState: 'unread' })], { archived: true })
    for (const name of ['Add reference', 'Read', 'Archive', 'Edit', 'Re-mark']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })
})
