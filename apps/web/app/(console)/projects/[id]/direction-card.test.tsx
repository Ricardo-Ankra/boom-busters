import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDirectorsBook } from '@boom-busters/providers'
import type { ActionResult } from './visuals-actions'
import { DirectionCard } from './direction-card'

const saveDirectionAction = vi.fn()
const redraftDirectionAction = vi.fn()
const replanShotsAction = vi.fn()

vi.mock('./visuals-actions', () => ({
  saveDirectionAction: (...args: unknown[]) => saveDirectionAction(...args),
  redraftDirectionAction: (...args: unknown[]) => redraftDirectionAction(...args),
  replanShotsAction: (...args: unknown[]) => replanShotsAction(...args),
}))

const PROJECT = '01J0000000000000000000000A'
const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 })
const act = vi.fn(async (_key: string, run: () => Promise<ActionResult>) => await run())

beforeEach(() => {
  vi.clearAllMocks()
  saveDirectionAction.mockResolvedValue({ ok: true })
  redraftDirectionAction.mockResolvedValue({ ok: true })
  replanShotsAction.mockResolvedValue({ ok: true })
})

describe('DirectionCard', () => {
  it('shows the book’s fields as labelled text areas and saves edits', async () => {
    render(<DirectionCard projectId={PROJECT} direction={book} act={act} />)
    const thesis = screen.getByLabelText('Visual thesis')
    await userEvent.clear(thesis)
    await userEvent.type(thesis, 'A hollow tower.')
    await userEvent.click(screen.getByRole('button', { name: 'Save direction' }))
    expect(saveDirectionAction).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ visualThesis: 'A hollow tower.', motifs: book.motifs }),
    )
  })

  it('round-trips the principals through the one-line form', async () => {
    render(<DirectionCard projectId={PROJECT} direction={book} act={act} />)
    const principals = screen.getByLabelText(/^Principals/)
    await userEvent.clear(principals)
    await userEvent.type(
      principals,
      'Jan Marsalek | chief operating officer | likeness | man in his forties, dark hair | shown in corridors only',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save direction' }))
    expect(saveDirectionAction).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({
        principals: [
          {
            name: 'Jan Marsalek',
            role: 'chief operating officer',
            depiction: 'likeness',
            identityString: 'man in his forties, dark hair',
            guardrail: 'shown in corridors only',
          },
        ],
      }),
    )
  })

  it('offers a priced redraft that names what is lost', async () => {
    render(<DirectionCard projectId={PROJECT} direction={book} act={act} />)
    await userEvent.click(screen.getByRole('button', { name: /Redraft direction · ≈\$0\.05/ }))
    expect(screen.getByText(/Your edits to the book are replaced/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Redraft now' }))
    expect(redraftDirectionAction).toHaveBeenCalledWith(PROJECT)
  })

  it('leaves re-planning to the Shot plan card, where the plan is', () => {
    render(<DirectionCard projectId={PROJECT} direction={book} act={act} />)
    expect(screen.queryByRole('button', { name: /Re-plan shot list/ })).toBeNull()
    expect(replanShotsAction).not.toHaveBeenCalled()
  })

  it('keeps what the owner is typing when a refresh hands back the same book', async () => {
    // The plan checkpoint refreshes itself while the run is parked, and every
    // refresh is a new object for an unchanged book.
    const { rerender } = render(<DirectionCard projectId={PROJECT} direction={book} act={act} />)
    const thesis = screen.getByLabelText('Visual thesis')
    await userEvent.clear(thesis)
    await userEvent.type(thesis, 'Half a thought')

    rerender(
      <DirectionCard
        projectId={PROJECT}
        direction={JSON.parse(JSON.stringify(book)) as typeof book}
        act={act}
      />,
    )
    expect(screen.getByLabelText('Visual thesis')).toHaveValue('Half a thought')

    // A book that really changed (a redraft landed) does replace the form.
    rerender(
      <DirectionCard
        projectId={PROJECT}
        direction={{ ...book, visualThesis: 'The redrafted thesis.' }}
        act={act}
      />,
    )
    expect(screen.getByLabelText('Visual thesis')).toHaveValue('The redrafted thesis.')
  })

  it('spins only the pressed button and holds the other while a plan action runs', () => {
    render(
      <DirectionCard
        projectId={PROJECT}
        direction={book}
        busy
        pressed="direction-save"
        act={act}
      />,
    )
    const save = screen.getByRole('button', { name: 'Save direction' })
    expect(save).toHaveAttribute('aria-busy', 'true')
    const redraft = screen.getByRole('button', { name: /Redraft direction/ })
    expect(redraft).toBeDisabled()
    expect(redraft).not.toHaveAttribute('aria-busy')
  })

  it('with no book yet, offers only the redraft', () => {
    render(<DirectionCard projectId={PROJECT} direction={null} act={act} />)
    expect(screen.getByText(/No direction has been written for this film yet/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save direction' })).toBeNull()
    expect(screen.getByRole('button', { name: /Redraft direction/ })).toBeVisible()
  })
})

describe('toForm and fromForm', () => {
  it('round-trip a book without loss', async () => {
    const { fromForm, toForm } = await import('./direction-card')
    expect(fromForm(toForm(book))).toEqual(book)
  })
})
