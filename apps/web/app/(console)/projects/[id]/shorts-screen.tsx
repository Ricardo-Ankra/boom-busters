'use client'

import * as React from 'react'
import { Check, Clapperboard, Loader2, Save } from 'lucide-react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ShortCardModel } from '@/lib/shorts-review'
import {
  requestShortRender,
  setShortEnding,
  setShortRelatedLink,
  updateShortDetails,
} from './shorts-actions'
import { advanceToPublish } from './publish-actions'
import { useAction } from './project-controls'

/**
 * The Shorts screen (build spec section 11.3): a card grid — vertical 9:16
 * player, segment source line, ending toggle, editable title + description,
 * render state, and the related-link checklist chip that must be ticked
 * before the Short can be scheduled (the Publish screen enforces it; this
 * screen collects it).
 *
 * There is no gate here. The human curates the cards — retitle, re-end,
 * re-render, tick the chip — and the publish decision happens per item on
 * the Publish screen (M7.7).
 */

export function ShortsScreen({
  projectId,
  shorts,
  live,
  canAdvance = false,
}: {
  projectId: string
  shorts: ShortCardModel[]
  live: boolean
  /** True while the project is ON the shorts stage with nothing running. */
  canAdvance?: boolean
}) {
  const act = useAction()
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Shorts" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {shorts.map((short) => (
          <ShortCard key={short.id} short={short} live={live} />
        ))}
      </section>
      {/* The handover. Not a gate — no run waits on curation — so the button
          moves the stage itself. The cards stay reachable from the rail. */}
      {canAdvance ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--color-border)] p-3">
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Done curating? Scheduling — slots, titles, thumbnails — happens on the Publish
            screen. Un-rendered Shorts can still be rendered from here afterwards.
          </p>
          <Button
            variant="primary"
            onClick={() =>
              void act(() => advanceToPublish(projectId), 'On to the Publish screen')
            }
          >
            Continue to Publish
          </Button>
        </section>
      ) : null}
    </div>
  )
}

function fmtClock(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

interface RenderPoll {
  status: NonNullable<ShortCardModel['render']>['status']
  progressPct: number
  outputUrl?: string
  error: { message?: string } | null
}

/**
 * The same 2-second poll the preview screen's render cards use: poll while
 * in flight, one fetch when done — the playable URL only exists on the poll
 * response, freshly presigned. Resets when the card's render changes.
 */
function useShortRenderPoll(render: ShortCardModel['render']) {
  const renderId = render?.id
  const [poll, setPoll] = React.useState<RenderPoll | null>(null)
  const [polledId, setPolledId] = React.useState(renderId)
  if (polledId !== renderId) {
    setPolledId(renderId)
    setPoll(null)
  }

  const current = (polledId === renderId ? poll : null) ?? render
  const inFlight =
    current !== null &&
    current !== undefined &&
    ['queued', 'invoking', 'rendering', 'qc'].includes(current.status)
  const needsUrl = current?.status === 'done' && poll?.outputUrl === undefined

  React.useEffect(() => {
    if (!renderId || (!inFlight && !needsUrl)) return
    let cancelled = false
    const tick = async () => {
      try {
        const response = await fetch(`/api/renders/${renderId}/progress`)
        if (!response.ok || cancelled) return
        setPoll((await response.json()) as RenderPoll)
      } catch {
        // A missed poll is the next poll's problem.
      }
    }
    void tick()
    if (!inFlight) return
    const timer = window.setInterval(() => void tick(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [renderId, inFlight, needsUrl])

  return { current, poll, inFlight }
}

function ShortCard({ short, live }: { short: ShortCardModel; live: boolean }) {
  const act = useAction()
  const [title, setTitle] = React.useState(short.title)
  const [description, setDescription] = React.useState(short.description)
  const { current, poll, inFlight } = useShortRenderPoll(short.render)

  const dirty = title !== short.title || description !== short.description
  const failed = current?.status === 'failed'
  const done = current?.status === 'done'
  const segmentLine =
    `${short.chapterTitle ?? 'Unknown chapter'} · ¶${short.fromParagraph + 1}` +
    (short.toParagraph !== short.fromParagraph ? `–${short.toParagraph + 1}` : '') +
    (short.durationMs !== null ? ` · ${fmtClock(short.durationMs)}` : '')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px]">
          <Clapperboard aria-hidden className="h-4 w-4" />
          <span className="truncate">{short.title}</span>
          {inFlight ? (
            <span className="ml-auto flex items-center gap-1.5 text-[12px] font-normal text-[var(--color-text-muted)]">
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
              Rendering{current && current.progressPct > 0 ? ` ${current.progressPct}%` : '…'}
            </span>
          ) : null}
        </CardTitle>
        <p className="text-[12px] text-[var(--color-text-muted)]">{segmentLine}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* The 9:16 player — the finished file, or an honest placeholder. */}
        <div className="mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-black">
          {done && poll?.outputUrl ? (
            <video
              data-testid={`short-video-${short.id}`}
              src={poll.outputUrl}
              controls
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-[var(--color-text-muted)]">
              {inFlight
                ? 'Rendering…'
                : failed
                  ? 'The render failed.'
                  : short.render === null
                    ? 'Not rendered yet.'
                    : 'Fetching the file…'}
            </div>
          )}
        </div>

        {failed ? (
          <p className="text-[13px] text-[var(--color-danger)]">
            The render failed: {current?.error?.message ?? 'no reason recorded'}
          </p>
        ) : null}

        {/* Editable metadata — a labelled Save, not a silent autosave: the
            title is publish copy, and saving it should feel like an act. */}
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Title
          <Input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Description
          <textarea
            value={description}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        </label>
        {dirty ? (
          <Button
            variant="outline"
            onClick={() =>
              void act(() => updateShortDetails(short.id, { title, description }), 'Short updated')
            }
          >
            <Save aria-hidden className="h-4 w-4" />
            Save title & description
          </Button>
        ) : null}

        {/* The ending toggle. Switching makes the current render a render of
            something else, so it carries that consequence when one exists. */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[var(--color-text-secondary)]">Ending</span>
          {(['loop', 'cta'] as const).map((ending) =>
            short.ending === ending ? (
              <Button key={ending} variant="primary" disabled className="capitalize">
                {ending === 'cta' ? 'CTA' : 'Loop'}
              </Button>
            ) : short.render !== null && !failed ? (
              <ConfirmButton
                key={ending}
                label={ending === 'cta' ? 'CTA' : 'Loop'}
                confirmLabel={`Switch to ${ending === 'cta' ? 'CTA' : 'loop'}`}
                consequence="The current render is of the other ending and will need re-rendering."
                confirmVariant="primary"
                onConfirm={() => act(() => setShortEnding(short.id, ending), 'Ending changed')}
              />
            ) : (
              <Button
                key={ending}
                variant="outline"
                className="capitalize"
                onClick={() => void act(() => setShortEnding(short.id, ending), 'Ending changed')}
              >
                {ending === 'cta' ? 'CTA' : 'Loop'}
              </Button>
            ),
          )}
        </div>

        {/* Render / re-render — the card's spend decision. */}
        {!inFlight ? (
          <ConfirmButton
            label={
              short.render === null
                ? live
                  ? `Render · est. $${short.estimatedCostUsd.toFixed(2)}`
                  : 'Render (mock)'
                : live
                  ? `Render again · est. $${short.estimatedCostUsd.toFixed(2)}`
                  : 'Render again (mock)'
            }
            confirmLabel="Start the render"
            consequence={
              live
                ? `Renders this Short on Remotion Lambda for about $${short.estimatedCostUsd.toFixed(2)}.`
                : 'Mock mode: the bookkeeping runs; no Lambda is invoked and nothing is spent.'
            }
            confirmVariant="primary"
            onConfirm={() => act(() => requestShortRender(short.id), 'Render requested')}
          />
        ) : null}

        {/* The related-link checklist chip (spec section 11.3): a human act
            in YouTube Studio, recorded here, enforced at scheduling. */}
        <button
          type="button"
          aria-pressed={short.relatedLinkChecked}
          onClick={() =>
            void act(
              () => setShortRelatedLink(short.id, !short.relatedLinkChecked),
              short.relatedLinkChecked ? 'Unticked' : 'Related link recorded',
            )
          }
          className={
            'flex min-h-[40px] items-center gap-2 rounded-[8px] border px-3 py-2 text-left text-[13px] ' +
            (short.relatedLinkChecked
              ? 'border-[var(--color-success)] text-[var(--color-success)]'
              : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')
          }
        >
          <Check aria-hidden className="h-4 w-4" />
          {short.relatedLinkChecked
            ? 'Related video link set in Studio'
            : 'Set related video link in Studio → mark done'}
        </button>
      </CardContent>
    </Card>
  )
}
