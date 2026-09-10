'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, Loader2, Save, Search, X } from 'lucide-react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ShortCardModel, TeaserBeatProp } from '@/lib/shorts-review'
import {
  assembleTeaser,
  fetchTeaserShotOptions,
  generateTeaserStill,
  pickFetchedTeaserShot,
  rebuildTeaser,
  saveTeaserScript,
  saveTeaserShot,
} from './shorts-actions'
import { useAction } from './project-controls'

/**
 * The teaser studio (decisions 227, 230): the teaser's own mini pipeline in
 * one place — Script, Voice, Shots, then Assemble & render — mirroring the
 * full video's stages without pretending to be them. It is deliberately not
 * a tab on the Script/Voice/Assembly gates: those approve the master, and a
 * teaser tab there would spend most of the project's life empty and go
 * stale on every upstream re-run.
 *
 * The spend contract mirrors the console: saving the script and picking
 * shots are free; "Voice the script" buys only beats whose words changed
 * (idempotency re-serves the rest); "Assemble & render" compiles for free
 * and spends only on the render.
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
  const router = useRouter()
  const beats = short.teaser?.beats ?? []
  const [texts, setTexts] = React.useState(() => beats.map((beat) => beat.text))
  const dirty = texts.some((text, index) => text !== beats[index]?.text)
  const allVoiced = beats.length > 0 && beats.every((beat) => beat.voiced)
  const staleCount = beats.filter((beat) => !beat.voiced).length

  // A fetch or generation is running server-side (decision 231): re-read the
  // page until the runner's result lands, so the strip fills in by itself.
  const fetching = beats.some((beat) => beat.fetchState?.state === 'fetching')
  React.useEffect(() => {
    if (!fetching) return
    const timer = window.setInterval(() => router.refresh(), 2500)
    return () => window.clearInterval(timer)
  }, [fetching, router])

  const voiceButton = (
    <ConfirmButton
      label={live ? 'Voice the script' : 'Voice the script (mock)'}
      confirmLabel="Synthesise the beats"
      consequence={
        live
          ? `${staleCount === 0 ? 'Every beat' : `${staleCount} of ${beats.length || 'the'} beats`} ` +
            'will be synthesised — a few cents per changed beat; unchanged text is re-served ' +
            'free. Nothing is cut yet: Assemble & render is the next act.'
          : 'Mock mode: the bookkeeping runs; no vendor is called and nothing is spent.'
      }
      confirmVariant="primary"
      onConfirm={() => act(() => rebuildTeaser(short.id), 'Voicing the teaser')}
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
          Script → Voice → Shots → Assemble &amp; render. Edits and shot picks are free; voicing
          buys only changed beats, and assembling spends only on the render.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!short.teaser?.hasScript ? (
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              This teaser predates the studio, so its script was never stored. Voice the script to
              write one from the outline, store it for editing, and synthesise its beats.
            </p>
            <div className="flex flex-wrap items-center gap-2">{voiceButton}</div>
          </>
        ) : (
          <>
            {beats.map((beat, index) => (
              <BeatWorkbench
                key={index}
                shortId={short.id}
                index={index}
                beat={beat}
                live={live}
                stillEstimateUsd={short.teaser?.stillEstimateUsd ?? 0}
                text={texts[index] ?? ''}
                onText={(value) =>
                  setTexts((current) => current.map((text, at) => (at === index ? value : text)))
                }
              />
            ))}

            <div className="flex flex-wrap items-center gap-2">
              {dirty ? (
                <>
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
                  <p className="text-[12px] text-[var(--color-text-muted)]">
                    Save first — voicing and assembling read what is stored.
                  </p>
                </>
              ) : (
                <>
                  {voiceButton}
                  <ConfirmButton
                    label={live ? 'Assemble & render' : 'Assemble & render (mock)'}
                    confirmLabel="Cut it and start the render"
                    consequence={
                      !allVoiced
                        ? 'Some beats are not voiced for the current words yet — the assemble will refuse until Voice the script has run.'
                        : live
                          ? `Compiles the cut from your voice and shots — free — then renders on Remotion Lambda for about $${short.estimatedCostUsd.toFixed(2)}.`
                          : 'Mock mode: the cut is compiled and stored; no Lambda is invoked and nothing is spent.'
                    }
                    confirmVariant="primary"
                    onConfirm={() =>
                      act(() => assembleTeaser(short.id), 'Assembled — the render starts now')
                    }
                  />
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** One beat's whole workbench: words, voice state and audio, shot picker. */
function BeatWorkbench({
  shortId,
  index,
  beat,
  live,
  stillEstimateUsd,
  text,
  onText,
}: {
  shortId: string
  index: number
  beat: TeaserBeatProp
  live: boolean
  stillEstimateUsd: number
  text: string
  onText: (value: string) => void
}) {
  const act = useAction()
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-text-muted)]">
        <span>
          Beat {index + 1} · cut over {beat.chapterTitle ?? `chapter ${beat.chapterIndex + 1}`}
        </span>
        <span>
          {beat.voiced
            ? `voiced · ${((beat.durationMs ?? 0) / 1000).toFixed(1)}s`
            : 'not voiced for these words yet'}
        </span>
      </div>

      <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
        Beat {index + 1} words
        <textarea
          value={text}
          rows={2}
          onChange={(event) => onText(event.target.value)}
          className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        />
      </label>

      {beat.audioUrl ? (
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

      {/* The shot picker (decision 230): the chapter's resolved board shots,
          plus Auto — exactly the pool the auto-pick chooses from. */}
      {beat.pool.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            Shot — reuse any of this chapter&apos;s board shots
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={beat.autoSelected}
              onClick={() =>
                void act(() => saveTeaserShot(shortId, index, null), 'Back to the auto-pick')
              }
              className={
                'flex h-[72px] min-w-[72px] flex-col items-center justify-center gap-1 rounded-[8px] border px-2 text-[11px] ' +
                (beat.autoSelected
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')
              }
            >
              {beat.auto?.url ? (
                // Presigned preview of what auto would take — plain img.
                <img
                  src={beat.auto.url}
                  alt=""
                  className="h-[44px] w-[64px] rounded-[4px] object-cover"
                />
              ) : null}
              Auto
            </button>
            {beat.pool.map((option, optionIndex) => (
              <button
                key={optionIndex}
                type="button"
                aria-pressed={option.selected}
                aria-label={`Beat ${index + 1} shot option ${optionIndex + 1} (${option.kind})`}
                onClick={() =>
                  void act(() => saveTeaserShot(shortId, index, option.slot), 'Shot picked')
                }
                className={
                  'flex h-[72px] min-w-[72px] items-center justify-center rounded-[8px] border p-1 ' +
                  (option.selected
                    ? 'border-[var(--color-accent)]'
                    : 'border-[var(--color-border)]')
                }
              >
                {option.url && option.kind === 'image' ? (
                  <img
                    src={option.url}
                    alt=""
                    className="h-full w-[88px] rounded-[4px] object-cover"
                  />
                ) : option.url && option.kind === 'video' ? (
                  <video
                    src={option.url}
                    muted
                    preload="metadata"
                    className="h-full w-[88px] rounded-[4px] object-cover"
                  />
                ) : (
                  <span className="px-2 text-[11px] text-[var(--color-text-secondary)] capitalize">
                    {option.kind}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <NewShots
        shortId={shortId}
        index={index}
        beat={beat}
        live={live}
        stillEstimateUsd={stillEstimateUsd}
      />
    </div>
  )
}

/**
 * The beat's new material (decision 231): a free stock search with an
 * editable query, a paid still generation with an editable prompt, and the
 * strip of what came back. A fetched option whose bytes are settled is
 * picked like any board shot; live stock is ingested first, so its pick
 * shows "preparing" words until the runner has the bytes.
 */
function NewShots({
  shortId,
  index,
  beat,
  live,
  stillEstimateUsd,
}: {
  shortId: string
  index: number
  beat: TeaserBeatProp
  live: boolean
  stillEstimateUsd: number
}) {
  const act = useAction()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState(beat.text)
  const [prompt, setPrompt] = React.useState(beat.text)
  const busy = beat.fetchState?.state === 'fetching'

  return (
    <div className="flex flex-col gap-1.5">
      {beat.fetched.length > 0 ? (
        <>
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            New shots fetched for this beat
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {beat.fetched.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.selected}
                aria-label={`Beat ${index + 1} new shot ${option.id} (${option.origin} ${option.kind})`}
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      option.slot
                        ? saveTeaserShot(shortId, index, option.slot)
                        : pickFetchedTeaserShot(shortId, index, option.id),
                    option.slot
                      ? 'Shot picked'
                      : 'Preparing the clip. It becomes the pick once stored',
                  )
                }
                className={
                  'flex h-[72px] min-w-[72px] items-center justify-center rounded-[8px] border p-1 ' +
                  (option.selected
                    ? 'border-[var(--color-accent)]'
                    : 'border-[var(--color-border)]')
                }
              >
                {option.url && option.previewKind === 'video' ? (
                  // The preview URL is the clip itself (no picture thumb
                  // exists), so preview it the way the pool strip does.
                  <video
                    src={option.url}
                    muted
                    preload="metadata"
                    className="h-full w-[88px] rounded-[4px] object-cover"
                  />
                ) : option.url ? (
                  <img
                    src={option.url}
                    alt=""
                    className="h-full w-[88px] rounded-[4px] object-cover"
                  />
                ) : (
                  <span className="px-2 text-[11px] text-[var(--color-text-secondary)] capitalize">
                    {option.origin} {option.kind}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {beat.fetchState?.state === 'fetching' ? (
        <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]">
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          {beat.fetchState.what === 'stock'
            ? 'Searching the stock providers…'
            : beat.fetchState.what === 'still'
              ? 'Generating the still…'
              : 'Preparing the picked clip…'}
        </p>
      ) : null}
      {beat.fetchState?.state === 'failed' ? (
        <p className="text-[12px] text-[var(--color-danger)]">
          The last {beat.fetchState.what === 'ingest' ? 'pick' : 'fetch'} stopped:{' '}
          {beat.fetchState.reason}
        </p>
      ) : null}

      <div>
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <ImagePlus aria-hidden className="h-4 w-4" />
          {open ? 'Hide the new-shot tools' : 'Fetch new shots for this beat'}
        </Button>
      </div>

      {open ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Beat {index + 1} stock search
            <Input
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(
                  () => fetchTeaserShotOptions(shortId, index, query),
                  'Searching. Results land in the strip above',
                )
              }
            >
              <Search aria-hidden className="h-4 w-4" />
              {live ? 'Fetch stock options (free)' : 'Fetch stock options (mock)'}
            </Button>
          </div>

          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Beat {index + 1} still prompt
            <textarea
              value={prompt}
              rows={2}
              maxLength={2000}
              onChange={(event) => setPrompt(event.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            />
          </label>
          <div>
            <ConfirmButton
              label={
                live
                  ? `Generate a still · est. $${stillEstimateUsd.toFixed(2)}`
                  : 'Generate a still (mock)'
              }
              confirmLabel="Generate it"
              consequence={
                live
                  ? `Buys a generation pass from the routed model for about $${stillEstimateUsd.toFixed(2)}. The images land in the strip above; nothing is picked for you.`
                  : 'Mock mode: the bookkeeping runs; no generator is called and nothing is spent.'
              }
              confirmVariant="primary"
              disabled={busy}
              onConfirm={() =>
                act(
                  () => generateTeaserStill(shortId, index, prompt),
                  'Generating. The stills land in the strip above',
                )
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
