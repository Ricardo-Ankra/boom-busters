'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw, Save, Search, X } from 'lucide-react'
import { SHORT_RULES } from '@boom-busters/schemas'
import type { CropFocus, PointShotMotion, ShortPhase } from '@boom-busters/schemas'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { PointStudioModel, PointStudioShot } from '@/lib/point-studio-model'
import type { ShortCardModel } from '@/lib/shorts-review'
import {
  assemblePoint,
  fetchPointShotOptions,
  generatePointStill,
  rebuildPointFromScript,
  replanPoint,
  revoicePoint,
  savePointScript,
  savePointShot,
} from './point-studio-actions'
import { useAction } from './project-controls'

/**
 * The point Short studio (playbook Shorts design 6): Script, Voice, Shots,
 * then Assemble and render, in one place below the card grid, the way the
 * teaser studio works for a teaser. Saving the script and picking shots are
 * free and take effect at Assemble; Re-voice buys only paragraphs whose words
 * changed; Re-plan shots buys one plan call and any new pictures; assembling
 * compiles for free and spends only on the render. Findings tell the owner
 * what the rule book would flag; they never block a render.
 */

const PHASE_LABELS: Record<ShortPhase, string> = {
  hook: 'Hook',
  stakes: 'Stakes',
  delivery: 'Delivery',
  resolution: 'Resolution',
  bridge: 'Bridge',
}

const PHASE_WINDOWS: Record<ShortPhase, string> = {
  hook: '0 to 3 s',
  stakes: '3 to 15 s',
  delivery: '15 to 42 s',
  resolution: '42 to 52 s',
  bridge: '52 to 60 s',
}

const CROPS: { value: CropFocus; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'centre', label: 'Centre' },
  { value: 'right', label: 'Right' },
]

const MOTIONS: { value: PointShotMotion; label: string }[] = [
  { value: 'static', label: 'Still' },
  { value: 'kenburns-in', label: 'Push in' },
  { value: 'kenburns-out', label: 'Pull out' },
  { value: 'punch', label: 'Punch' },
]

const WORKING_WORDS: Record<string, string> = {
  voice: 'Re-voicing the script…',
  plan: 'Re-planning the shots…',
  stock: 'Searching the stock providers…',
  still: 'Generating the still…',
  ingest: 'Preparing the picked clip…',
  assemble: 'Assembling the cut…',
  rebuild: 'Rebuilding from the new script…',
}

const AREA_CLASS =
  'rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function PointStudio({
  short,
  live,
  onClose,
}: {
  short: ShortCardModel
  live: boolean
  onClose: () => void
}) {
  const studio = short.studio
  const router = useRouter()
  const { act, busy: acting, pressed } = useAction()
  const [note, setNote] = React.useState('')

  // The script's paragraphs, flat in phase order, each with its words as edited.
  const flat = React.useMemo(
    () =>
      studio
        ? studio.phases.flatMap((block) =>
            block.paragraphs.map((paragraph) => ({ phase: block.phase, ...paragraph })),
          )
        : [],
    [studio],
  )
  const [texts, setTexts] = React.useState(() => flat.map((paragraph) => paragraph.text))
  const dirty = texts.some((text, index) => text !== flat[index]?.text)

  // Work is running server-side: read the page again until it lands, so the
  // shots and the voice fill in by themselves.
  const pending = studio?.pending ?? null
  React.useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => router.refresh(), 2500)
    return () => window.clearInterval(timer)
  }, [pending, router])

  if (!studio) return null
  const busy = acting || pending !== null
  const staleCount = flat.filter((paragraph) => !paragraph.voiced).length
  const words = dirty
    ? texts.reduce((sum, text) => sum + text.split(/\s+/).filter(Boolean).length, 0)
    : studio.words
  const inWindow =
    studio.estimatedRuntimeSec * 1000 >= SHORT_RULES.runtimeMinMs &&
    studio.estimatedRuntimeSec * 1000 <= SHORT_RULES.runtimeMaxMs

  return (
    <Card aria-label="Point Short studio">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px]">
          <span className="truncate">Short studio: {short.title}</span>
          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            <X aria-hidden className="h-4 w-4" />
            Close the studio
          </Button>
        </CardTitle>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Script, Voice, Shots, then Assemble and render. Edits and shot picks are free; Re-voice
          buys only changed paragraphs, Re-plan buys one plan and any new pictures, and assembling
          spends only on the render.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pending ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)]"
          >
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            {WORKING_WORDS[pending] ?? 'Working…'}
          </p>
        ) : null}
        {studio.failure ? (
          <p className="text-[13px] text-[var(--color-danger)]">
            The last request stopped: {studio.failure}
          </p>
        ) : null}

        {studio.scriptBehind ? (
          <section
            aria-label="Earlier script"
            className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-warning)] p-3"
          >
            <p className="text-[13px]">This Short was written from an earlier script.</p>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              Nothing is rebuilt or bought until you press the button. A rebuild throws away this
              Short&apos;s script, voice and shots and writes them again from the new script. The
              card leaves the Shorts screen while it rebuilds and comes back, with a fresh render,
              once it is assembled.
            </p>
            <div>
              <ConfirmButton
                label="Rebuild from the new script"
                confirmLabel="Rebuild it"
                consequence={
                  live
                    ? 'Writes the script, the narration, the shot plan and any new pictures again, then renders. This costs about as much as the first build, and the card is hidden until it is done.'
                    : 'Mock mode: the build runs on mock providers and nothing is spent. The card is hidden until it is done.'
                }
                confirmVariant="primary"
                busy={pressed === 'rebuild'}
                disabled={busy}
                onConfirm={() =>
                  act(
                    () => rebuildPointFromScript(short.id),
                    'Rebuilding from the new script',
                    'rebuild',
                  )
                }
              />
            </div>
          </section>
        ) : null}

        {/* Script: five labelled phases, with the words and the runtime read live. */}
        <section aria-label="Script" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-semibold">Script</h3>
            <p
              className={
                'text-[12px] ' +
                (inWindow && !dirty
                  ? 'text-[var(--color-text-muted)]'
                  : 'text-[var(--color-warning)]')
              }
            >
              {words} words
              {dirty
                ? ' (save to see the runtime)'
                : `, about ${studio.estimatedRuntimeSec} s`}{' '}
              against 45 to 60 s
            </p>
          </div>
          {studio.phases.map((block) => (
            <div
              key={block.phase}
              role="group"
              aria-label={`${PHASE_LABELS[block.phase]} phase`}
              className="flex flex-col gap-1.5 rounded-[8px] border border-[var(--color-border)] p-3"
            >
              <div className="flex items-baseline justify-between text-[12px] text-[var(--color-text-muted)]">
                <span className="font-semibold text-[var(--color-text-secondary)]">
                  {PHASE_LABELS[block.phase]}
                </span>
                <span>{PHASE_WINDOWS[block.phase]}</span>
              </div>
              {block.paragraphs.length === 0 ? (
                <p className="text-[12px] text-[var(--color-text-muted)]">
                  This script has no {block.phase} paragraph.
                </p>
              ) : null}
              {flat.map((paragraph, index) =>
                paragraph.phase !== block.phase ? null : (
                  <label
                    key={index}
                    className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {PHASE_LABELS[block.phase]} words, from{' '}
                        {paragraph.chapterTitle ?? `chapter ${paragraph.chapterIndex + 1}`}
                      </span>
                      <span className="text-[var(--color-text-muted)]">
                        {paragraph.voiced && texts[index] === paragraph.text
                          ? 'voiced'
                          : 'not voiced for these words yet'}
                      </span>
                    </span>
                    <textarea
                      value={texts[index] ?? ''}
                      rows={2}
                      maxLength={400}
                      onChange={(event) =>
                        setTexts((current) =>
                          current.map((text, at) => (at === index ? event.target.value : text)),
                        )
                      }
                      className={AREA_CLASS}
                    />
                  </label>
                ),
              )}
            </div>
          ))}
          {dirty ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                busy={pressed === 'save-script'}
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      savePointScript(
                        short.id,
                        flat.map((paragraph, index) => ({
                          phase: paragraph.phase,
                          text: texts[index] ?? '',
                          chapterIndex: paragraph.chapterIndex,
                        })),
                      ),
                    'Script saved',
                    'save-script',
                  )
                }
              >
                <Save aria-hidden className="h-4 w-4" />
                Save the script
              </Button>
              <p className="text-[12px] text-[var(--color-text-muted)]">
                Save first: voicing and assembling read what is stored.
              </p>
            </div>
          ) : null}
        </section>

        {/* Voice */}
        <section aria-label="Voice" className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">Voice</h3>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {staleCount === 0
              ? 'Every paragraph is voiced for its current words.'
              : `${staleCount} of ${flat.length} paragraphs are not voiced for their current words.`}
          </p>
          <div>
            <ConfirmButton
              label={live ? 'Re-voice' : 'Re-voice (mock)'}
              confirmLabel="Synthesise the paragraphs"
              consequence={
                live
                  ? `${staleCount === 0 ? 'Every paragraph' : `${staleCount} of ${flat.length} paragraphs`} ` +
                    'will be synthesised, a few cents each; unchanged words are re-served free. ' +
                    'Nothing is cut yet. Re-plan the shots afterwards if the words changed.'
                  : 'Mock mode: the bookkeeping runs; no vendor is called and nothing is spent.'
              }
              confirmVariant="primary"
              busy={pressed === 'voice'}
              disabled={busy || dirty}
              onConfirm={() => act(() => revoicePoint(short.id), 'Re-voicing the Short', 'voice')}
            />
          </div>
        </section>

        {/* Shots */}
        <section aria-label="Shots" className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">Shots</h3>
          {studio.planBehind ? (
            <p className="text-[12px] text-[var(--color-warning)]">
              These shots were planned for an earlier voice. Re-plan the shots before you assemble.
            </p>
          ) : null}
          <div
            tabIndex={0}
            aria-label="Shot list"
            className="flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-1"
          >
            {studio.shots.map((shot) => (
              <ShotRow
                key={shot.index}
                shortId={short.id}
                shot={shot}
                studio={studio}
                live={live}
                busy={busy}
                stillEstimateUsd={studio.stillEstimateUsd}
              />
            ))}
          </div>

          <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
            <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
              Note for the plan (optional)
              <textarea
                value={note}
                rows={2}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                className={AREA_CLASS}
              />
            </label>
            <div>
              <ConfirmButton
                label={live ? 'Re-plan shots' : 'Re-plan shots (mock)'}
                confirmLabel="Plan the shots again"
                consequence={
                  live
                    ? 'Buys one shot-plan call and any new pictures it asks for, over the voice you have now. Your picks are replaced by the new plan; fetched pictures stay in the pool. Nothing is cut yet.'
                    : 'Mock mode: the bookkeeping runs; no model is called and nothing is spent.'
                }
                confirmVariant="primary"
                busy={pressed === 'replan'}
                disabled={busy || dirty}
                onConfirm={() =>
                  act(() => replanPoint(short.id, note), 'Re-planning the shots', 'replan')
                }
              />
            </div>
          </div>
        </section>

        {/* Findings */}
        <section aria-label="Findings" className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold">Findings</h3>
          {studio.findings.length === 0 ? (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              The rule book has nothing to flag on this cut. Findings read the last assembled cut,
              and never block a render.
            </p>
          ) : (
            <>
              <p className="text-[12px] text-[var(--color-text-muted)]">
                What the rule book would flag on the last assembled cut. They never block a render.
              </p>
              <ul className="flex flex-col gap-1">
                {studio.findings.map((finding, index) => (
                  <li key={index} className="text-[13px] text-[var(--color-warning)]">
                    {finding.message}
                    {finding.shotIndex !== undefined ? ` (shot ${finding.shotIndex + 1})` : ''}
                    {finding.phase ? ` (${PHASE_LABELS[finding.phase]})` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Assemble and render: free compile, then the render's spend. */}
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmButton
            label={live ? 'Assemble and render' : 'Assemble and render (mock)'}
            confirmLabel="Cut it and start the render"
            consequence={
              staleCount > 0
                ? 'Some paragraphs are not voiced for the current words yet, so the assemble will refuse until Re-voice has run.'
                : live
                  ? `Compiles the cut from your script, voice and shots (free), then renders on Remotion Lambda for about $${short.estimatedCostUsd.toFixed(2)}.`
                  : 'Mock mode: the cut is compiled and stored; no Lambda is invoked and nothing is spent.'
            }
            confirmVariant="primary"
            busy={pressed === 'assemble'}
            disabled={busy || dirty}
            onConfirm={() =>
              act(() => assemblePoint(short.id), 'Assembled, the render starts now', 'assemble')
            }
          />
          {dirty ? (
            <p className="text-[12px] text-[var(--color-text-muted)]">Save the script first.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

/** One shot: its picture, its time, Swap, crop and motion. */
function ShotRow({
  shortId,
  shot,
  studio,
  live,
  busy: busyOutside,
  stillEstimateUsd,
}: {
  shortId: string
  shot: PointStudioShot
  studio: PointStudioModel
  live: boolean
  busy: boolean
  stillEstimateUsd: number
}) {
  const { act, busy: acting, pressed } = useAction()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [prompt, setPrompt] = React.useState('')
  const busy = busyOutside || acting
  const n = shot.index + 1

  return (
    <div
      role="group"
      aria-label={`Shot ${n}`}
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-[64px] w-[36px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-[var(--color-border)] bg-black text-[10px] text-[var(--color-text-muted)]">
          {shot.thumbUrl ? (
            <img src={shot.thumbUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="px-0.5 text-center capitalize">{shot.type}</span>
          )}
        </div>
        <div className="flex min-w-[160px] flex-1 flex-col text-[12px] text-[var(--color-text-secondary)]">
          <span className="font-semibold">Shot {n}</span>
          <span>
            {seconds(shot.startMs)} for {seconds(shot.durationMs)} · {shot.type} · {shot.source}
          </span>
        </div>
        <Button
          variant="outline"
          aria-expanded={open}
          aria-label={`Swap shot ${n}`}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          <RefreshCw aria-hidden className="h-4 w-4" />
          {open ? 'Hide the swap options' : 'Swap'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={`Shot ${n} crop`}
        >
          <span className="text-[12px] text-[var(--color-text-secondary)]">Crop</span>
          {CROPS.map((crop) => (
            <Button
              key={crop.value}
              variant={shot.crop === crop.value ? 'primary' : 'outline'}
              aria-pressed={shot.crop === crop.value}
              aria-label={`Shot ${n} crop ${crop.label}`}
              busy={pressed === `crop-${crop.value}`}
              disabled={busy || shot.crop === crop.value}
              onClick={() =>
                void act(
                  () => savePointShot(shortId, shot.index, null, crop.value, shot.motion),
                  `Shot ${n} cropped ${crop.label.toLowerCase()}`,
                  `crop-${crop.value}`,
                )
              }
            >
              {crop.label}
            </Button>
          ))}
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={`Shot ${n} motion`}
        >
          <span className="text-[12px] text-[var(--color-text-secondary)]">Motion</span>
          {MOTIONS.map((motion) => (
            <Button
              key={motion.value}
              variant={shot.motion === motion.value ? 'primary' : 'outline'}
              aria-pressed={shot.motion === motion.value}
              aria-label={`Shot ${n} motion ${motion.label}`}
              busy={pressed === `motion-${motion.value}`}
              disabled={busy || shot.motion === motion.value}
              onClick={() =>
                void act(
                  () => savePointShot(shortId, shot.index, null, shot.crop, motion.value),
                  `Shot ${n} motion set`,
                  `motion-${motion.value}`,
                )
              }
            >
              {motion.label}
            </Button>
          ))}
        </div>
      </div>

      {open ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            Shot {n}: pick from the long form&apos;s shots
          </span>
          <div className="flex max-h-[220px] flex-wrap items-center gap-2 overflow-y-auto">
            {studio.library.map((option, optionIndex) => (
              <button
                key={optionIndex}
                type="button"
                aria-pressed={option.selected}
                aria-label={`Shot ${n} library option ${optionIndex + 1} (${option.kind})`}
                aria-busy={pressed === `lib-${optionIndex}` || undefined}
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      savePointShot(
                        shortId,
                        shot.index,
                        { ref: optionIndex },
                        shot.crop,
                        shot.motion,
                      ),
                    `Shot ${n} swapped`,
                    `lib-${optionIndex}`,
                  )
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

          {studio.fetched.length > 0 ? (
            <>
              <span className="text-[12px] text-[var(--color-text-secondary)]">
                Shot {n}: pick from the pictures fetched for this Short
              </span>
              <div className="flex max-h-[220px] flex-wrap items-center gap-2 overflow-y-auto">
                {studio.fetched.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={option.selected}
                    aria-label={`Shot ${n} fetched option ${option.id} (${option.origin} ${option.kind})`}
                    aria-busy={pressed === `fetched-${option.id}` || undefined}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          savePointShot(
                            shortId,
                            shot.index,
                            { candidateId: option.id },
                            shot.crop,
                            shot.motion,
                          ),
                        `Shot ${n} swapped`,
                        `fetched-${option.id}`,
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

          <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-2">
            <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
              Shot {n} stock search
              <Input
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div>
              <Button
                variant="outline"
                busy={pressed === 'fetch-stock'}
                disabled={busy}
                onClick={() =>
                  void act(
                    () => fetchPointShotOptions(shortId, shot.index, query),
                    'Searched. The results are in the pool above',
                    'fetch-stock',
                  )
                }
              >
                <Search aria-hidden className="h-4 w-4" />
                {live ? 'Fetch stock options (free)' : 'Fetch stock options (mock)'}
              </Button>
            </div>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
              Shot {n} still prompt
              <textarea
                value={prompt}
                rows={2}
                maxLength={2000}
                onChange={(event) => setPrompt(event.target.value)}
                className={AREA_CLASS}
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
                    ? `Buys a generation pass from the routed model for about $${stillEstimateUsd.toFixed(2)}, framed 9:16. The images land in the pool above; nothing is picked for you.`
                    : 'Mock mode: the bookkeeping runs; no generator is called and nothing is spent.'
                }
                confirmVariant="primary"
                busy={pressed === 'generate-still'}
                disabled={busy}
                onConfirm={() =>
                  act(
                    () => generatePointStill(shortId, shot.index, prompt),
                    'Generated. The stills are in the pool above',
                    'generate-still',
                  )
                }
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
