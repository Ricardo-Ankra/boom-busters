import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { GraphicPlan } from './graphic-plan'

describe('GraphicPlan (decision 388)', () => {
  it('shows the concept and keeps the storyboard behind a labelled button', async () => {
    render(
      <GraphicPlan
        code={{
          concept: 'the sentence parts and the figure rises out of it',
          storyboard: [
            '0.0 s the rule draws across',
            '2.0 s "1.2bn": the figure rises out of the gap',
          ],
        }}
      />,
    )
    expect(screen.getByText('the sentence parts and the figure rises out of it')).toBeVisible()
    const toggle = screen.getByRole('button', { name: 'Show storyboard (2)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('0.0 s the rule draws across')).not.toBeVisible()

    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide storyboard' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByText('0.0 s the rule draws across')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // The button controls a list that is always in the document, so aria-controls never dangles.
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).not.toBeNull()
  })

  it('shows a concept alone with no button when there is no storyboard', () => {
    render(<GraphicPlan code={{ concept: 'one bar per year' }} />)
    expect(screen.getByText('one bar per year')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says what the review made of the design, when one ran (decision 389)', () => {
    const { rerender } = render(
      <GraphicPlan code={{ concept: 'one bar per year', review: 'revised' }} />,
    )
    expect(screen.getByText('Reviewed on its rendered frames: revised.')).toBeVisible()
    rerender(<GraphicPlan code={{ review: 'kept' }} />)
    expect(screen.getByText('Reviewed on its rendered frames: kept as designed.')).toBeVisible()
  })

  it('shows nothing for a design stored before the plan', () => {
    const { container } = render(<GraphicPlan code={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
