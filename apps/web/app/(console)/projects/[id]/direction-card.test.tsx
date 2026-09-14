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
const act = vi.fn(async (_key: string, run: () => Promise<ActionResult>) => {
  await run()
})

beforeEach(() => {
  vi.clearAllMocks()
  saveDirectionAction.mockResolvedValue({ ok: true })
  redraftDirectionAction.mockResolvedValue({ ok: true })
  replanShotsAction.mockResolvedValue({ ok: true })
})

describe('DirectionCard', () => {
  it('shows the book’s fields as labelled text areas and saves edits', async () => {
    render(<DirectionCard projectId={PROJECT} direction={book} slotsFetched={0} act={act} />)
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
    render(<DirectionCard projectId={PROJECT} direction={book} slotsFetched={0} act={act} />)
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

  it('offers a priced redraft and a priced re-plan that name what is lost', async () => {
    render(<DirectionCard projectId={PROJECT} direction={book} slotsFetched={3} act={act} />)
    await userEvent.click(screen.getByRole('button', { name: /Redraft direction · ≈\$0\.05/ }))
    expect(screen.getByText(/Your edits to the book are replaced/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Redraft now' }))
    expect(redraftDirectionAction).toHaveBeenCalledWith(PROJECT)

    await userEvent.click(screen.getByRole('button', { name: /Re-plan shot list · ≈\$0\.15/ }))
    expect(screen.getByText(/3 slots already fetched are discarded/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Re-plan now' }))
    expect(replanShotsAction).toHaveBeenCalledWith(PROJECT)
  })

  it('with no book yet, offers only the redraft', () => {
    render(<DirectionCard projectId={PROJECT} direction={null} slotsFetched={0} act={act} />)
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
