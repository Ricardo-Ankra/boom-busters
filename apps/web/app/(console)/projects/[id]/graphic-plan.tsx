'use client'

import type { GraphicCode } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'

/** The review's outcome as the card says it (decision 389). */
const REVIEW_LINE: Record<NonNullable<GraphicCode['review']>, string> = {
  kept: 'Reviewed on its rendered frames: kept as designed.',
  revised: 'Reviewed on its rendered frames: revised.',
}

/**
 * The designer's plan for a graphic or chart written as code (decision 388):
 * the one-line concept, always shown, and the storyboard behind a labelled
 * button, so the card stays short until the owner wants the moments. The
 * storyboard's times are the slot's own clock, so a Redesign steer can name
 * one ("at 2.0 s, raise the figure from the rule"). A design stored before
 * decision 388 carries neither, and shows nothing. Under them, what the
 * review made of it (decision 389), when one ran.
 */
export function GraphicPlan({
  code,
}: {
  code: Pick<GraphicCode, 'concept' | 'storyboard' | 'review'>
}) {
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  const storyboard = code.storyboard ?? []
  if (!code.concept && storyboard.length === 0 && !code.review) return null

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
        <p className="text-[12px] text-[var(--color-text-muted)]">{REVIEW_LINE[code.review]}</p>
      ) : null}
    </div>
  )
}
