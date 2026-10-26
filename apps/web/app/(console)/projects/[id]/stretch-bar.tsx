'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import type { VisualsReviewModel } from '@/lib/visuals-review'
import { timecode } from '@/lib/visuals-reuse'
import { replanStretchAction, type ActionResult } from './visuals-actions'

/**
 * Selecting shots for a stretch re-plan, and the bar that sends them (the
 * stretch re-plan design, 3.3). The rule here mirrors `cutStretch`'s (one or
 * more shots, neighbours, one chapter), so the owner is told before pressing
 * rather than after; the server action stays the authority.
 */

/** One planner call for the stretch; the designer and fetch calls come after. */
export const STRETCH_REPLAN_ESTIMATE = '≈$0.03'

const GAP_COPY = 'Re-plan works on neighbouring shots in one chapter.'

type Chapters = VisualsReviewModel['chapters']

export function useStretchSelection(chapters: Chapters): {
  selected: readonly string[]
  toggle: (slotId: string) => void
  selectStretch: (slotIds: readonly string[]) => void
  clear: () => void
  /** null when valid; the refusal copy otherwise. */
  problem: string | null
  /** The chapter the selection sits in (its index, as the board knows it), or null. */
  chapterId: string | null
} {
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(() => new Set())

  // Screen order, and only shots still on the board: a refresh that removes a
  // selected shot must not leave a ghost id for the action.
  const selected = React.useMemo(
    () =>
      chapters.flatMap((chapter) =>
        chapter.slots.filter((slot) => picked.has(slot.id)).map((slot) => slot.id),
      ),
    [chapters, picked],
  )

  const toggle = React.useCallback((slotId: string) => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(slotId)) next.add(slotId)
      return next
    })
  }, [])
  const selectStretch = React.useCallback(
    (slotIds: readonly string[]) => setPicked(new Set(slotIds)),
    [],
  )
  const clear = React.useCallback(() => setPicked(new Set()), [])

  let problem: string | null = null
  let chapterId: string | null = null
  if (selected.length > 0) {
    const inChapters = chapters.filter((chapter) =>
      chapter.slots.some((slot) => selected.includes(slot.id)),
    )
    const only = inChapters.length === 1 ? inChapters[0]! : null
    if (only) {
      chapterId = String(only.chapterIndex)
      const at = only.slots.flatMap((slot, index) => (selected.includes(slot.id) ? [index] : []))
      if (at[at.length - 1]! - at[0]! + 1 !== at.length) problem = GAP_COPY
    } else {
      problem = GAP_COPY
    }
  }

  return { selected, toggle, selectStretch, clear, problem, chapterId }
}

/** The board's one runner, as `VisualBoardContent` defines it. */
type Act = (
  key: string,
  run: () => Promise<ActionResult>,
  success: string,
  press?: string,
) => Promise<ActionResult>

export function StretchBar({
  projectId,
  selection,
  chapters,
  act,
}: {
  projectId: string
  selection: ReturnType<typeof useStretchSelection>
  chapters: Chapters
  act: Act
}): React.ReactElement | null {
  const [note, setNote] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const { selected, problem, clear } = selection
  if (selected.length === 0) return null

  // Shots outside the selection that show a selected shot's image: the
  // foreign key drops that link when the shot is deleted.
  const chosen = new Set(selected)
  const borrowers = chapters
    .flatMap((chapter) => chapter.slots)
    .filter(
      (slot) => !chosen.has(slot.id) && slot.reuse !== null && chosen.has(slot.reuse.sourceSlotId),
    )

  const send = async () => {
    setSending(true)
    try {
      const result = await act(
        'stretch',
        () => replanStretchAction(projectId, [...selected], note),
        'Re-planning these shots',
        'stretch',
      )
      if (result.ok) {
        clear()
        setNote('')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      role="region"
      aria-label="Re-plan the selected shots"
      className="sticky bottom-0 z-20 flex flex-col gap-2 rounded-[8px] border border-[var(--color-accent)] bg-[var(--color-surface)] p-3 shadow-lg"
    >
      {borrowers.map((slot) => (
        <p key={slot.id} className="text-[12px] text-[var(--color-warning)]">
          {`The shot at ${timecode(slot.startMs)} uses this shot's image and will lose it.`}
        </p>
      ))}
      <div className="flex flex-col gap-1">
        <Label htmlFor="stretch-note">What should change? (optional)</Label>
        <Input
          id="stretch-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="keep the headline card up through the CNBC line"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          busy={sending}
          disabled={problem !== null}
          onClick={() => void send()}
        >
          {`${selected.length === 1 ? 'Re-plan this shot' : `Re-plan these ${selected.length} shots`} · ${STRETCH_REPLAN_ESTIMATE}`}
        </Button>
        <Button variant="ghost" disabled={sending} onClick={clear}>
          Clear selection
        </Button>
        {problem ? <p className="text-[12px] text-[var(--color-warning)]">{problem}</p> : null}
      </div>
    </div>
  )
}
