'use client'

import * as React from 'react'
import type { Notice } from '@boom-busters/schemas'
import { Notices } from '@/components/notices'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TalkingPointCard, TalkingPointsModel } from '@/lib/talking-points-review'
import { useAction } from './project-controls'
import {
  addTalkingPoint,
  approveTalkingPoints,
  redoTalkingPoint,
  redoTalkingPoints,
  removeTalkingPoint,
} from './talking-points-actions'

/**
 * The Talking points screen (playbook Shorts design 3.3): the Shorts stage is
 * parked at phase `points` and nothing is built until the owner approves a
 * set. The cards show what each Short would ask and answer; every change is a
 * labelled button, and while a redo runs the whole screen waits for it, since
 * a second request would be a second paid call.
 */

const NOTE_BOX =
  'w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 ' +
  'text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--color-accent)] disabled:opacity-50'

export function TalkingPointsScreen({
  projectId,
  model,
  notices = [],
}: {
  projectId: string
  model: TalkingPointsModel
  /** The `points` notices: what a repair trimmed, or why the proposal stopped. */
  notices?: readonly Notice[]
}) {
  const { act, busy: acting, pressed } = useAction()
  const [note, setNote] = React.useState('')
  const locked = model.busy || acting
  const hasPoints = model.points.length > 0

  return (
    <div className="flex flex-col gap-4">
      <Notices notices={notices} />

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold">Talking points</h2>
        {model.version > 0 ? (
          <span className="font-mono text-[12px] text-[var(--color-text-muted)]">
            Version {model.version}
          </span>
        ) : null}
      </header>

      {model.busy ? (
        <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">
          Redoing the talking points…
        </p>
      ) : null}

      {!hasPoints && !model.busy ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          There are no talking points yet. Redo the talking points to propose a set.
        </p>
      ) : null}

      <section aria-label="Talking points" className="flex flex-col gap-3">
        {model.points.map((point) => (
          <PointCard
            key={point.id}
            point={point}
            projectId={projectId}
            locked={locked}
            act={act}
            pressed={pressed}
          />
        ))}
      </section>

      <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
        <label htmlFor="points-note" className="text-[13px] font-medium">
          Suggest changes
        </label>
        <textarea
          id="points-note"
          rows={2}
          value={note}
          disabled={locked}
          onChange={(event) => setNote(event.target.value)}
          className={NOTE_BOX}
        />
        <p className="text-[12px] text-[var(--color-text-muted)]">
          For example &quot;make one about the auditors&quot; or &quot;fewer contrarian ones&quot;.
          The note goes with Redo talking points and with Add a point.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={locked}
            busy={pressed === 'redo-all'}
            onClick={() =>
              void act(
                () => redoTalkingPoints(projectId, note),
                'Redoing the talking points',
                'redo-all',
              ).then((ok) => {
                if (ok) setNote('')
              })
            }
          >
            Redo talking points
          </Button>
          {hasPoints ? (
            <Button
              variant="outline"
              disabled={locked}
              busy={pressed === 'add'}
              onClick={() =>
                void act(() => addTalkingPoint(projectId, note), 'Adding a point', 'add').then(
                  (ok) => {
                    if (ok) setNote('')
                  },
                )
              }
            >
              Add a point
            </Button>
          ) : null}
        </div>
      </div>

      {model.history.length > 0 ? (
        <section aria-label="History" className="flex flex-col gap-1">
          <h3 className="text-[13px] font-medium">History</h3>
          <ul className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            {model.history.map((entry) => (
              <li key={entry.version}>
                <span className="font-mono">Version {entry.version}</span>
                {entry.note ? `: ${entry.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasPoints ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[13px] tabular-nums">
            Estimated cost to build: ${model.estimateUsd.toFixed(2)} (estimate)
          </p>
          <Button
            variant="primary"
            size="lg"
            disabled={locked}
            busy={pressed === 'approve'}
            onClick={() =>
              void act(
                () => approveTalkingPoints(projectId, model.version),
                'Building the Shorts',
                'approve',
              )
            }
          >
            Approve talking points
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function PointCard({
  point,
  projectId,
  locked,
  act,
  pressed,
}: {
  point: TalkingPointCard
  projectId: string
  locked: boolean
  act: ReturnType<typeof useAction>['act']
  pressed: string | null
}) {
  const [redoing, setRedoing] = React.useState(false)
  const [note, setNote] = React.useState('')
  const noteId = `point-note-${point.id}`

  return (
    <Card>
      <article aria-label={point.title}>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2">
          <Badge>{point.typeLabel}</Badge>
          <CardTitle className="text-[15px]">{point.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-[13px]">
          <Field label="Question">{point.question}</Field>
          <Field label="Payoff">{point.payoff}</Field>
          <Field label="Bridge">{point.bridge}</Field>
          <Field label="Facts from">{point.sourceChapters.map((c) => c.title).join(', ')}</Field>
          <Field label="Bridges to">{point.bridgeChapters.map((c) => c.title).join(', ')}</Field>

          {redoing ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={noteId} className="font-medium">
                Note for this point
              </label>
              <textarea
                id={noteId}
                rows={2}
                value={note}
                disabled={locked}
                onChange={(event) => setNote(event.target.value)}
                className={NOTE_BOX}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={locked}
                  busy={pressed === `redo-${point.id}`}
                  onClick={() =>
                    void act(
                      () => redoTalkingPoint(projectId, point.id, note),
                      'Redoing that point',
                      `redo-${point.id}`,
                    ).then((ok) => {
                      if (ok) {
                        setNote('')
                        setRedoing(false)
                      }
                    })
                  }
                >
                  Redo
                </Button>
                <Button variant="ghost" disabled={locked} onClick={() => setRedoing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={locked} onClick={() => setRedoing(true)}>
                Redo this one
              </Button>
              <Button
                variant="outline"
                disabled={locked}
                busy={pressed === `remove-${point.id}`}
                onClick={() =>
                  void act(
                    () => removeTalkingPoint(projectId, point.id),
                    'Removed that point',
                    `remove-${point.id}`,
                  )
                }
              >
                Remove
              </Button>
            </div>
          )}
        </CardContent>
      </article>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-medium text-[var(--color-text-secondary)]">{label}: </span>
      {children}
    </p>
  )
}
