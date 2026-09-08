'use client'

import * as React from 'react'
import { Save, X } from 'lucide-react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShortCardModel } from '@/lib/shorts-review'
import { rebuildTeaser, saveTeaserScript } from './shorts-actions'
import { useAction } from './project-controls'

/**
 * The teaser studio (decision 227): the teaser's script, voice and cut in
 * ONE place, at the one moment everything it depends on is final. It is
 * deliberately not a tab on the Script/Voice/Assembly gates — those approve
 * the master, and a teaser tab there would spend most of the project's life
 * empty and go stale on every upstream re-run.
 *
 * The contract mirrors the rest of the console: a Save never spends; the
 * Re-voice & recut button is the spend decision, and unchanged beats are
 * re-served by the vendor's idempotency, not re-billed.
 */

export function TeaserStudio({
  short,
  live,
  onClose,
}: {
  short: ShortCardModel
  live: boolean
  onClose: () => void
}) {
  const act = useAction()
  const beats = short.teaser?.beats ?? []
  const [texts, setTexts] = React.useState(() => beats.map((beat) => beat.text))
  const dirty = texts.some((text, index) => text !== beats[index]?.text)

  const rebuild = (
    <ConfirmButton
      label={live ? 'Re-voice & recut' : 'Re-voice & recut (mock)'}
      confirmLabel="Rebuild the teaser"
      consequence={
        live
          ? 'Edited beats are synthesised again — a few cents each; unchanged beats are ' +
            're-served free. The teaser is recut over the current board and a fresh render starts.'
          : 'Mock mode: the bookkeeping runs; no vendor is called and nothing is spent.'
      }
      confirmVariant="primary"
      onConfirm={() => act(() => rebuildTeaser(short.id), 'Rebuilding the teaser')}
    />
  )

  return (
    <Card aria-label="Teaser studio">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px]">
          <span className="truncate">Teaser studio — {short.title}</span>
          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            <X aria-hidden className="h-4 w-4" />
            Close the studio
          </Button>
        </CardTitle>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          The script below is what the teaser speaks. Saving costs nothing; Re-voice &amp; recut is
          the spend, and it queues a fresh render.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!short.teaser?.hasScript ? (
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              This teaser predates the studio, so its script was never stored. Re-voice &amp; recut
              writes a fresh script from the outline, stores it for editing, and rebuilds the cut.
            </p>
            <div className="flex flex-wrap items-center gap-2">{rebuild}</div>
          </>
        ) : (
          <>
            {beats.map((beat, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-text-muted)]">
                  <span>
                    Beat {index + 1} · cut over{' '}
                    {beat.chapterTitle ?? `chapter ${beat.chapterIndex + 1}`}
                  </span>
                  <span>
                    {beat.durationMs !== null
                      ? `${(beat.durationMs / 1000).toFixed(1)}s as voiced`
                      : 'not voiced yet'}
                  </span>
                </div>
                <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
                  Beat {index + 1} words
                  <textarea
                    value={texts[index] ?? ''}
                    rows={2}
                    onChange={(event) =>
                      setTexts((current) =>
                        current.map((text, at) => (at === index ? event.target.value : text)),
                      )
                    }
                    className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                  />
                </label>
                {beat.audioUrl ? (
                  // The beat's current voice — presigned straight from R2.
                  <audio
                    controls
                    preload="none"
                    src={beat.audioUrl}
                    aria-label={`Beat ${index + 1} audio`}
                    className="w-full"
                  />
                ) : (
                  <p className="text-[12px] text-[var(--color-text-muted)]">
                    No playable audio for this beat here — it plays inside the rendered teaser.
                  </p>
                )}
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              {dirty ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    void act(
                      () =>
                        saveTeaserScript(
                          short.id,
                          texts.map((text, index) => ({
                            text,
                            chapterIndex: beats[index]?.chapterIndex ?? 0,
                          })),
                        ),
                      'Teaser script saved',
                    )
                  }
                >
                  <Save aria-hidden className="h-4 w-4" />
                  Save the script
                </Button>
              ) : null}
              {dirty ? (
                <p className="text-[12px] text-[var(--color-text-muted)]">
                  Save the script first — the rebuild reads what is stored.
                </p>
              ) : (
                rebuild
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
