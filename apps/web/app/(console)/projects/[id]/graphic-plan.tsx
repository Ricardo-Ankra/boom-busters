'use client'

import { CRITIC_AXES } from '@boom-busters/schemas'
import type { GraphicCode } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'

/** The review's outcome as the card says it: the designer's own review (decision 389), then the critic's (spec 2026-11-04, section 10.4). */
const REVIEW_LINE: Record<NonNullable<GraphicCode['review']>, string> = {
  kept: 'Reviewed on its rendered frames: kept as designed.',
  revised: 'Reviewed on its rendered frames: revised.',
}
const CRITIC_LINE: Record<NonNullable<GraphicCode['review']>, string> = {
  kept: 'Reviewed by the critic: kept as designed.',
  revised: 'Reviewed by the critic: revised on its fixes.',
}

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * The designer's plan for a graphic or chart written as code (decision 388):
 * the one-line concept, always shown, and the storyboard behind a labelled
 * button, so the card stays short until the owner wants the moments. The
 * storyboard's times are the slot's own clock, so a Redesign steer can name
 * one ("at 2.0 s, raise the figure from the rule"). A design stored before
 * decision 388 carries neither, and shows nothing. Under them, what the
 * review made of it (decision 389), when one ran: with the critic's report
 * (spec 2026-11-04, section 11), its five scores and the fixes it asked for
 * sit behind "Show review".
 */
export function GraphicPlan({
  code,
}: {
  code: Pick<GraphicCode, 'concept' | 'storyboard' | 'review' | 'critique'>
}) {
  const [open, setOpen] = React.useState(false)
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const listId = React.useId()
  const reviewId = React.useId()
  const storyboard = code.storyboard ?? []
  if (!code.concept && storyboard.length === 0 && !code.review) return null
  const critique = code.critique

  return (
    <div className="flex flex-col items-start gap-1">
      {code.concept ? (
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          <span className="text-[var(--color-text-primary)]">Concept:</span> {code.concept}
        </p>
      ) : null}
      {storyboard.length > 0 ? (
        <>
          <Button
            type="button"
            variant="ghost"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((shown) => !shown)}
          >
            {open ? 'Hide storyboard' : `Show storyboard (${storyboard.length})`}
          </Button>
          <ol
            id={listId}
            hidden={!open}
            className="flex list-none flex-col gap-1 pl-0 text-[12px] text-[var(--color-text-secondary)]"
          >
            {storyboard.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
        </>
      ) : null}
      {code.review ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">
          {critique ? CRITIC_LINE[code.review] : REVIEW_LINE[code.review]}
        </p>
      ) : null}
      {critique ? (
        <>
          <Button
            type="button"
            variant="ghost"
            aria-expanded={reviewOpen}
            aria-controls={reviewId}
            onClick={() => setReviewOpen((shown) => !shown)}
          >
            {reviewOpen ? 'Hide review' : 'Show review'}
          </Button>
          <ul
            id={reviewId}
            hidden={!reviewOpen}
            className="flex list-none flex-col gap-1 pl-0 text-[12px] text-[var(--color-text-secondary)]"
          >
            {CRITIC_AXES.map((axis) => (
              <li key={axis}>
                {capitalised(axis)} {critique.scores[axis].score}: {critique.scores[axis].line}
              </li>
            ))}
            {critique.fixes.length > 0 ? (
              <li>
                Fixes asked: {critique.fixes.map((fix, index) => `${index + 1}. ${fix}`).join(' ')}
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
    </div>
  )
}
