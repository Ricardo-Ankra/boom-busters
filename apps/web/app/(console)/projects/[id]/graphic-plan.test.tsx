import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GraphicCode } from '@boom-busters/schemas'
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

  const AXES = ['engagement', 'intent', 'composition', 'temporal', 'craft'] as const
  const critique = (over: Partial<NonNullable<GraphicCode['critique']>> = {}) => ({
    scores: Object.fromEntries(
      AXES.map((axis) => [axis, { score: 8, line: `${axis} holds` }]),
    ) as NonNullable<GraphicCode['critique']>['scores'],
    defects: [],
    fixes: [],
    mechanisms: [],
    keep: true,
    ...over,
  })

  it("shows the critic's five scores behind Show review, and the fixes asked (spec 2026-11-04, section 11)", async () => {
    render(
      <GraphicPlan
        code={{
          concept: 'one bar per year',
          review: 'revised',
          critique: critique({
            scores: {
              ...critique().scores,
              engagement: { score: 8, line: 'holds the eye' },
              temporal: { score: 6, line: 'the end fades early' },
            },
            fixes: ['bigger type', 'hold the end'],
            keep: false,
          }),
        }}
      />,
    )
    expect(screen.getByText('Reviewed by the critic: revised on its fixes.')).toBeVisible()
    const toggle = screen.getByRole('button', { name: 'Show review' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Engagement 8: holds the eye')).not.toBeVisible()
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide review' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByText('Engagement 8: holds the eye')).toBeVisible()
    expect(screen.getByText('Temporal 6: the end fades early')).toBeVisible()
    expect(screen.getByText('Fixes asked: 1. bigger type 2. hold the end')).toBeVisible()
  })

  it("shows the critic's scores on a kept design with no fixes line, and the old line on a design reviewed before the critic", () => {
    const { rerender } = render(<GraphicPlan code={{ review: 'kept', critique: critique() }} />)
    expect(screen.getByText('Reviewed by the critic: kept as designed.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Show review' })).toBeInTheDocument()
    expect(screen.queryByText(/Fixes asked/)).toBeNull()
    rerender(<GraphicPlan code={{ review: 'kept' }} />)
    expect(screen.getByText('Reviewed on its rendered frames: kept as designed.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Show review' })).toBeNull()
  })

  it('shows nothing for a design stored before the plan', () => {
    const { container } = render(<GraphicPlan code={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
