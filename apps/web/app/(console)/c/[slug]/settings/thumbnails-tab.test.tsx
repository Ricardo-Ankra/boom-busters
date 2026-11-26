import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ThumbnailsTab,
  type FinishedTests,
  type IdeaResult,
  type ThumbnailReferenceView,
} from './thumbnails-tab'

const actions = vi.hoisted(() => ({
  uploadThumbnailReference: vi.fn(),
  saveThumbnailReference: vi.fn(),
  removeThumbnailReference: vi.fn(),
  saveThumbnailStyle: vi.fn(),
}))
vi.mock('./thumbnail-reference-actions', () => actions)

const routerRefresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const REFERENCES: ThumbnailReferenceView[] = [
  {
    id: '01JD0000000000000000000001',
    note: 'Huge face, flat red',
    inUse: true,
    url: 'https://r2.example/a.png',
  },
  { id: '01JD0000000000000000000002', note: '', inUse: false, url: null },
]

function renderTab(
  references = REFERENCES,
  styleNote = 'Plain and loud',
  markPlacement = 'tl' as const,
  wins: { results: IdeaResult[]; finished: FinishedTests } = {
    results: [],
    finished: { withWinner: 0, same: 0, inconclusive: 0 },
  },
) {
  return render(
    <ThumbnailsTab
      slug="first"
      styleNote={styleNote}
      markPlacement={markPlacement}
      references={references}
      ideaResults={wins.results}
      finishedTests={wins.finished}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of Object.values(actions)) fn.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('the Thumbnails tab', () => {
  it('lists references with their notes and switches', async () => {
    renderTab()

    const cards = screen.getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    const [first, second] = cards as [HTMLElement, HTMLElement]

    expect(within(first).getByRole('img')).toHaveAttribute('src', 'https://r2.example/a.png')
    expect(within(first).getByRole('textbox', { name: 'Note' })).toHaveValue('Huge face, flat red')
    expect(within(first).getByRole('switch', { name: 'In use' })).toBeChecked()
    expect(within(second).getByRole('switch', { name: 'In use' })).not.toBeChecked()
    expect(within(second).getByText('No preview in mock storage')).toBeInTheDocument()

    // The switch saves at once.
    await userEvent.click(within(second).getByRole('switch', { name: 'In use' }))
    expect(actions.saveThumbnailReference).toHaveBeenCalledWith('first', REFERENCES[1]!.id, {
      inUse: true,
    })

    // The note saves with its own button, and only once it differs.
    const save = within(second).getByRole('button', { name: 'Save note' })
    expect(save).toBeDisabled()
    await userEvent.type(within(second).getByRole('textbox', { name: 'Note' }), 'Shouting caps')
    await userEvent.click(save)
    expect(actions.saveThumbnailReference).toHaveBeenLastCalledWith('first', REFERENCES[1]!.id, {
      note: 'Shouting caps',
    })

    // Remove asks twice.
    await userEvent.click(within(first).getByRole('button', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove reference' }))
    await waitFor(() =>
      expect(actions.removeThumbnailReference).toHaveBeenCalledWith('first', REFERENCES[0]!.id),
    )

    expect(
      screen.getByText('References steer the look. They are never published and never copied.'),
    ).toBeInTheDocument()
  })

  it('shows the counts and how many tests are still needed', () => {
    renderTab(REFERENCES, 'Plain and loud', 'tl', {
      results: [
        { idea: 'person', tests: 3, wins: 2 },
        { idea: 'figure', tests: 1, wins: 0 },
        { idea: 'object', tests: 0, wins: 0 },
        { idea: 'moment', tests: 0, wins: 0 },
        { idea: 'contrast', tests: 0, wins: 0 },
      ],
      finished: { withWinner: 3, same: 2, inconclusive: 1 },
    })

    expect(screen.getByText('What has won')).toBeInTheDocument()
    const card = screen.getByRole('region', { name: 'What has won' })
    const rows = within(card).getAllByTestId('idea-result')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Person2 of 3',
      'Figure0 of 1',
      'ObjectNo tests yet',
      'MomentNo tests yet',
      'ContrastNo tests yet',
    ])
    expect(within(card).getByText('Ended the same: 2. Inconclusive: 1.')).toBeInTheDocument()
    expect(
      within(card).getByText(
        '3 of 5 tests with a winner. The planner is told nothing until there are five.',
      ),
    ).toBeInTheDocument()
  })

  it('stops saying the planner is told nothing once five tests have a winner', () => {
    renderTab(REFERENCES, 'Plain and loud', 'tl', {
      results: [{ idea: 'person', tests: 5, wins: 5 }],
      finished: { withWinner: 5, same: 0, inconclusive: 0 },
    })
    expect(screen.queryByText(/The planner is told nothing/)).not.toBeInTheDocument()
    expect(screen.getByText('Ended the same: 0. Inconclusive: 0.')).toBeInTheDocument()
  })

  it('puts a refused switch back and says why', async () => {
    actions.saveThumbnailReference.mockResolvedValue({
      ok: false,
      error: 'At most three reference thumbnails can be in use.',
    })
    renderTab()
    const second = screen.getAllByRole('listitem')[1]!
    await userEvent.click(within(second).getByRole('switch', { name: 'In use' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'At most three reference thumbnails can be in use.',
          variant: 'error',
        }),
      ),
    )
    expect(within(second).getByRole('switch', { name: 'In use' })).not.toBeChecked()
  })

  it('offers no bottom right corner', async () => {
    renderTab()

    const corner = screen.getByRole('combobox', { name: 'Mark on thumbnails' })
    expect(Array.from(corner.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'Top left',
      'Top right',
      'Bottom left',
      'None',
    ])
    expect(corner).toHaveValue('tl')
    expect(
      screen.getByText('Bottom right is where YouTube draws the duration.'),
    ).toBeInTheDocument()

    // The style note and the corner save together, with one button.
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await userEvent.selectOptions(corner, 'bl')
    await userEvent.clear(screen.getByRole('textbox', { name: 'Style note' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Style note' }), 'Calm')
    await userEvent.click(save)
    expect(actions.saveThumbnailStyle).toHaveBeenCalledWith('first', {
      styleNote: 'Calm',
      markPlacement: 'bl',
    })
  })

  it('uploads a picture and stops at six references', async () => {
    renderTab()
    const file = new File(['x'], 'ref.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText('Choose a reference thumbnail'), file)
    await waitFor(() => expect(actions.uploadThumbnailReference).toHaveBeenCalledTimes(1))
    const sent = actions.uploadThumbnailReference.mock.calls[0]![0] as FormData
    expect(sent.get('slug')).toBe('first')
    expect(sent.get('file')).toBeInstanceOf(File)

    cleanup()
    renderTab(
      Array.from({ length: 6 }, (_, index) => ({
        id: `01JD000000000000000000010${index}`,
        note: '',
        inUse: false,
        url: null,
      })),
    )
    expect(screen.getByRole('button', { name: 'Add a reference thumbnail' })).toBeDisabled()
  })
})
