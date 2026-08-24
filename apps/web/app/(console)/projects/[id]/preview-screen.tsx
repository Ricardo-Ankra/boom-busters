'use client'

import { Player } from '@remotion/player'
import type { PlayerRef } from '@remotion/player'
import { DocumentaryMaster } from '@boom-busters/compositions'
import { gainAt } from '@boom-busters/schemas'
import type { QcReport, Timeline } from '@boom-busters/schemas'
import { Captions, Clapperboard, Film, Music, Square } from 'lucide-react'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { approveGate, stopProject } from '../actions'
import { chooseMusicBed, requestDraftRender } from './preview-actions'
import { useAction } from './project-controls'

/**
 * Preview & render — Gate 5a (build spec section 11.3). Full-width
 * `@remotion/player` of the compiled timeline with chapter markers, a
 * caption toggle and the music-duck gain line; beside it the stats, the
 * music picker (a swap recompiles the timeline — cheap and free), and two
 * render choices side by side: a half-resolution draft (~a quarter of the
 * price, a real file to check before committing) and "Render master",
 * which IS the gate approval — section 7.6 starts the render-runner on
 * `gate/preview.approved`, so the click that spends the money and the
 * event that closes the gate are one action.
 *
 * There used to be a "Buffer full preview" button and an automatic draft
 * per assembly run. Both existed to work around a glitchy live player,
 * and the glitch turned out to be the page's own 3-second refresh loop
 * handing the player freshly signed URLs mid-play (decision 159/162).
 * With that fixed the player is smooth from the network, so the buffer
 * machinery is gone and the draft is a button, not an automatism.
 */

export interface PreviewChapterProp {
  title: string
  startMs: number
  durationMs: number
}

export interface PreviewRenderProp {
  id: string
  status: 'queued' | 'invoking' | 'rendering' | 'qc' | 'done' | 'failed' | 'cancelled'
  progressPct: number
  costUsd: string
  qcReport: QcReport | null
  error: { message?: string } | null
  startedAt: string | null
  completedAt: string | null
}

/** A draft also says which timeline version it rendered — staleness is visible. */
export type PreviewDraftProp = PreviewRenderProp & { timelineVersion: number }

/**
 * One stage, three cuts (decision 187): the same video at three levels of
 * reality — the live preview (free approximation), the draft (cheap real
 * file) and the master (the deliverable) — share ONE large surface, chosen
 * by tab. Before this they were scattered across two columns and three
 * cards, and the most real artefact played in the smallest box.
 */
type Cut = 'preview' | 'draft' | 'master'

interface RenderPoll {
  status: PreviewRenderProp['status']
  progressPct: number
  outputUrl?: string
  qcReport: QcReport | null
  error: { message?: string } | null
  startedAt: string | null
  completedAt: string | null
  costUsd: string
}

function fmtClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps)
}

function timelineDuration(timeline: Timeline): number {
  let end = 0
  for (const list of [timeline.narration, timeline.slots, timeline.overlays] as const) {
    for (const item of list) end = Math.max(end, item.startMs + item.durationMs)
  }
  return end
}

export function PreviewScreen({
  projectId,
  timeline,
  dropped,
  chapters,
  version,
  slotCount,
  beds,
  currentBedKey,
  estimatedCostUsd,
  estimatedDraftCostUsd,
  live,
  atGate,
  render,
  draft,
}: {
  projectId: string
  /** The MATERIALISED preview copy — every reference already a URL. */
  timeline: Timeline
  dropped: { narration: number; slots: number; music: boolean }
  chapters: PreviewChapterProp[]
  version: number
  slotCount: number
  beds: { r2Key: string; title: string }[]
  currentBedKey: string | null
  estimatedCostUsd: number
  estimatedDraftCostUsd: number
  /** Whether a broker is configured — false means renders run locally, free. */
  live: boolean
  /** Whether the preview gate is open, i.e. Render master would be heard. */
  atGate: boolean
  render: PreviewRenderProp | null
  /** The newest half-resolution draft, if one exists. */
  draft: PreviewDraftProp | null
}) {
  const act = useAction()
  const playerRef = React.useRef<PlayerRef>(null)
  const fileRef = React.useRef<HTMLVideoElement>(null)
  const [captionsOn, setCaptionsOn] = React.useState(true)

  const durationMs = timelineDuration(timeline)
  const durationInFrames = Math.max(1, msToFrames(durationMs, timeline.fps))

  const draftState = useRenderPoll(draft)
  const masterState = useRenderPoll(render)

  // A cut gets a tab only when it has something to stand on. A FAILED cut
  // is a one-line note beside the button that retries it (in the Render
  // card), never a tab of its own.
  const draftCut =
    draftState.current !== null &&
    draftState.current.status !== 'failed' &&
    draftState.current.status !== 'cancelled'
  const masterCut =
    masterState.current !== null &&
    masterState.current.status !== 'failed' &&
    masterState.current.status !== 'cancelled'

  // The hand-off flags cover the gap between a render click and its row
  // appearing; once the run is seen in flight they are spent (the 2026-08-23
  // lesson: keyed on !inFlight alone, the note returned when the render
  // SETTLED and sat on top of the finished master).
  const [draftHandedOff, setDraftHandedOff] = React.useState(false)
  const [masterHandedOff, setMasterHandedOff] = React.useState(false)
  React.useEffect(() => {
    if (draftState.inFlight) setDraftHandedOff(false)
  }, [draftState.inFlight])
  React.useEffect(() => {
    if (masterState.inFlight) setMasterHandedOff(false)
  }, [masterState.inFlight])

  // The most final cut that exists is the default; picking a tab — or
  // starting a render, which picks its tab — overrides it. The override is
  // remembered, so the stage never changes identity under the viewer on a
  // poll tick.
  const [chosenCut, setChosenCut] = React.useState<Cut | null>(null)
  const defaultCut: Cut = masterCut ? 'master' : draftCut ? 'draft' : 'preview'
  const activeCut: Cut = chosenCut ?? defaultCut

  const shown = React.useMemo<Timeline>(
    () =>
      captionsOn ? timeline : { ...timeline, captions: { ...timeline.captions, style: 'none' } },
    [timeline, captionsOn],
  )

  const droppedTotal = dropped.narration + dropped.slots + (dropped.music ? 1 : 0)

  // The chapter buttons drive whichever cut is on stage — the preview
  // through the Player, a rendered file through its <video> element. That
  // is how a QC warning gets checked: Master tab, chapter button, scrub.
  const seekTo = (ms: number) => {
    if (activeCut === 'preview') {
      playerRef.current?.seekTo(msToFrames(ms, timeline.fps))
    } else if (fileRef.current) {
      fileRef.current.currentTime = ms / 1000
    }
  }

  const draftPct = Math.max(0, Math.min(100, draftState.current?.progressPct ?? 0))
  const masterPct = Math.max(0, Math.min(100, masterState.current?.progressPct ?? 0))
  const masterQc = masterState.current?.qcReport ?? null
  const draftLabel = draftState.inFlight
    ? `Draft · rendering ${draftPct}%`
    : draftState.current?.status === 'done' && draft
      ? `Draft · v${draft.timelineVersion} · $${Number(draftState.current.costUsd).toFixed(2)}`
      : 'Draft · starting'
  const masterLabel =
    masterState.current?.status === 'qc'
      ? 'Master · quality check'
      : masterState.inFlight
        ? `Master · rendering ${masterPct}%`
        : masterState.current?.status === 'done'
          ? masterQc
            ? masterQc.passed
              ? `Master · QC passed · $${Number(masterState.current.costUsd).toFixed(2)}`
              : `Master · ${masterQc.issues.length} warning${masterQc.issues.length === 1 ? '' : 's'} · $${Number(masterState.current.costUsd).toFixed(2)}`
            : `Master · $${Number(masterState.current.costUsd).toFixed(2)}`
          : 'Master · starting'

  const tab = (cut: Cut, label: React.ReactNode) => (
    <Button
      key={cut}
      variant={activeCut === cut ? 'primary' : 'outline'}
      aria-pressed={activeCut === cut}
      onClick={() => setChosenCut(cut)}
    >
      {label}
    </Button>
  )

  const draftStale = draft !== null && draft.timelineVersion !== version

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {tab(
            'preview',
            <>
              <Film aria-hidden />
              Preview · v{version}
            </>,
          )}
          {draftCut || draftHandedOff
            ? tab(
                'draft',
                <>
                  <Clapperboard aria-hidden />
                  {draftLabel}
                </>,
              )
            : null}
          {masterCut || masterHandedOff ? tab('master', masterLabel) : null}
        </div>

        {activeCut === 'preview' ? (
          <div
            data-player-shell
            className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-black"
          >
            <Player
              ref={playerRef}
              component={DocumentaryMaster}
              inputProps={{ timeline: shown }}
              durationInFrames={durationInFrames}
              fps={timeline.fps}
              // Half resolution, preview only: the compositions size everything
              // through frameScale, so 960×540 is the same picture with a
              // quarter of the pixels to paint per frame — and the player is
              // CSS-scaled into a ~800px column anyway. The render reads the
              // timeline's real dimensions and is untouched.
              compositionWidth={Math.round(timeline.width / 2)}
              compositionHeight={Math.round(timeline.height / 2)}
              controls
              acknowledgeRemotionLicense
              // The WebCodecs audio path schedules through one AudioContext;
              // keeping it alive across pauses removes the resume latency a
              // fresh context pays on every play press.
              _experimentalKeepAudioContextAlive
              style={{ width: '100%' }}
            />
          </div>
        ) : activeCut === 'draft' ? (
          <FileStage
            state={draftState}
            handedOff={draftHandedOff}
            renderingLabel={`Rendering draft… ${draftPct}%`}
            testId="draft-video"
            fileRef={fileRef}
            durationInFrames={durationInFrames}
            footer={
              draftState.current?.status === 'done' && draft
                ? `Draft of timeline v${draft.timelineVersion} · half resolution · cost $${Number(
                    draftState.current.costUsd,
                  ).toFixed(2)}`
                : undefined
            }
          />
        ) : (
          <FileStage
            state={masterState}
            handedOff={masterHandedOff}
            renderingLabel="Rendering master"
            testId="master-video"
            fileRef={fileRef}
            durationInFrames={durationInFrames}
            footer={
              masterState.current?.status === 'done'
                ? `Cost $${Number(masterState.current.costUsd).toFixed(2)}${
                    masterState.current.completedAt
                      ? ` · finished ${new Date(masterState.current.completedAt).toLocaleString()}`
                      : ''
                  }`
                : undefined
            }
          />
        )}

        {activeCut === 'draft' && draftStale && !draftState.inFlight ? (
          <p className="text-[13px] text-[var(--color-warning)]">
            The timeline has moved on to v{version} (a music swap recompiles for free) — this draft
            still plays v{draft?.timelineVersion}. Render a fresh one from the Render card.
          </p>
        ) : null}

        <ChapterStrip chapters={chapters} durationMs={durationMs} onSeek={seekTo} />

        {activeCut === 'preview' ? (
          <>
            <GainLine music={timeline.music} durationMs={durationMs} />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                aria-pressed={captionsOn}
                onClick={() => setCaptionsOn((on) => !on)}
              >
                <Captions aria-hidden />
                {captionsOn ? 'Hide captions' : 'Show captions'}
              </Button>
              {droppedTotal > 0 ? (
                <p className="text-[13px] text-[var(--color-warning)]">
                  {droppedTotal} item{droppedTotal === 1 ? ' is' : 's are'} not previewable here
                  {dropped.music ? ' (including the music bed)' : ''} — storage is not configured,
                  so their bytes cannot be fetched. The render resolves them for real.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {/* The QC report sits directly under the master it describes. */}
        {activeCut === 'master' && masterQc ? (
          <QcCard report={masterQc} chapters={chapters} />
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <Film aria-hidden className="h-4 w-4" />
              Timeline v{version}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
            <p>
              {fmtClock(durationMs)} · {slotCount} slots · {chapters.length} chapter
              {chapters.length === 1 ? '' : 's'}
            </p>
            {chapters.map((chapter, index) => (
              <p key={chapter.startMs} className="flex justify-between gap-2">
                <span className="truncate">
                  {index + 1}. {chapter.title}
                </span>
                <span className="shrink-0 font-mono">{fmtClock(chapter.durationMs)}</span>
              </p>
            ))}
          </CardContent>
        </Card>

        <MusicPicker projectId={projectId} beds={beds} currentBedKey={currentBedKey} act={act} />

        <RenderActionsCard
          projectId={projectId}
          durationMs={durationMs}
          estimatedCostUsd={estimatedCostUsd}
          estimatedDraftCostUsd={estimatedDraftCostUsd}
          draftBusy={draftState.inFlight}
          draftError={
            draftState.current?.status === 'failed'
              ? (draftState.current.error?.message ?? 'unknown error')
              : null
          }
          live={live}
          atGate={atGate}
          masterState={masterState}
          act={act}
          onDraftStarted={() => {
            setDraftHandedOff(true)
            setChosenCut('draft')
          }}
          onMasterStarted={() => {
            setMasterHandedOff(true)
            setChosenCut('master')
          }}
        />
      </div>
    </div>
  )
}

/**
 * Chapter markers for the seek bar. The Player's own bar cannot carry
 * markers, so the strip under it does: a proportional track with a tick per
 * chapter, and a labelled button per chapter (the 40px hit target the ticks
 * cannot honestly be).
 */
function ChapterStrip({
  chapters,
  durationMs,
  onSeek,
}: {
  chapters: PreviewChapterProp[]
  durationMs: number
  onSeek: (ms: number) => void
}) {
  if (chapters.length === 0 || durationMs === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[6px] rounded-full bg-[var(--color-surface)]">
        {chapters.map((chapter) => (
          <span
            key={chapter.startMs}
            aria-hidden
            className="absolute top-[-3px] h-[12px] w-[2px] rounded bg-[var(--color-accent)]"
            style={{ left: `${(chapter.startMs / durationMs) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {chapters.map((chapter, index) => (
          <Button key={chapter.startMs} variant="ghost" onClick={() => onSeek(chapter.startMs)}>
            <span className="font-mono text-[12px]">{fmtClock(chapter.startMs)}</span>
            {index + 1}. {chapter.title}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * The duck visualisation: `gainAt` — the exact interpolation MusicBed
 * renders with, exported from the contract for exactly this reason — sampled
 * across the timeline as a thin line. Valleys are the narration.
 */
function GainLine({ music, durationMs }: { music: Timeline['music']; durationMs: number }) {
  if (!music || durationMs === 0) {
    return (
      <p className="text-[12px] text-[var(--color-text-muted)]">
        No music bed on this timeline — choose one from the library on the right.
      </p>
    )
  }

  const WIDTH = 1000
  const HEIGHT = 28
  const gains: number[] = []
  const samples = 200
  for (let i = 0; i <= samples; i += 1) {
    gains.push(gainAt(music.duckingCurve, (durationMs * i) / samples))
  }
  const min = Math.min(...gains)
  const max = Math.max(...gains)
  const span = max - min || 1
  const points = gains
    .map((gain, index) => {
      const x = (WIDTH * index) / samples
      const y = HEIGHT - 3 - ((gain - min) / span) * (HEIGHT - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <figure aria-label="Music ducking level across the video" className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-[28px] w-full"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          opacity="0.75"
        />
      </svg>
      <figcaption className="text-[12px] text-[var(--color-text-muted)]">
        Music bed level — it ducks under the narration and rises in the gaps.
      </figcaption>
    </figure>
  )
}

function MusicPicker({
  projectId,
  beds,
  currentBedKey,
  act,
}: {
  projectId: string
  beds: { r2Key: string; title: string }[]
  currentBedKey: string | null
  act: ReturnType<typeof useAction>
}) {
  const [busyKey, setBusyKey] = React.useState<string | null>(null)

  const choose = async (key: string | null) => {
    setBusyKey(key ?? 'none')
    try {
      await act(
        () => chooseMusicBed(projectId, key),
        key === null ? 'Music removed — timeline recompiled' : 'Bed swapped — timeline recompiled',
      )
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px]">
          <Music aria-hidden className="h-4 w-4" />
          Music bed
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {beds.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            The music library is empty. Add beds in Settings → Music library; swapping one in later
            recompiles the timeline for free.
          </p>
        ) : (
          <>
            {beds.map((bed) => {
              const isCurrent = bed.r2Key === currentBedKey
              return (
                <div key={bed.r2Key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px]">
                    {bed.title}
                    {isCurrent ? (
                      <span className="ml-2 text-[12px] text-[var(--color-accent)]">Current</span>
                    ) : null}
                  </span>
                  {isCurrent ? null : (
                    <Button
                      variant="outline"
                      busy={busyKey === bed.r2Key}
                      onClick={() => choose(bed.r2Key)}
                    >
                      Use this bed
                    </Button>
                  )}
                </div>
              )
            })}
            {currentBedKey !== null ? (
              <Button variant="ghost" busy={busyKey === 'none'} onClick={() => choose(null)}>
                Remove music
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The 2-second progress poll every render card shares: poll while a render
 * is in flight, one fetch when it is done — the finished file's playable
 * URL only exists on the poll response, freshly presigned. The poll resets
 * when the row changes, so a re-requested draft never wears its
 * predecessor's progress.
 */
function useRenderPoll(render: PreviewRenderProp | null): {
  current: RenderPoll | null
  poll: RenderPoll | null
  inFlight: boolean
} {
  const renderId = render?.id
  const [poll, setPoll] = React.useState<RenderPoll | null>(null)
  const [polledId, setPolledId] = React.useState(renderId)
  if (polledId !== renderId) {
    setPolledId(renderId)
    setPoll(null)
  }

  const current: RenderPoll | null = (polledId === renderId ? poll : null) ?? render
  const inFlight =
    current !== null &&
    (current.status === 'queued' ||
      current.status === 'invoking' ||
      current.status === 'rendering' ||
      current.status === 'qc')

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

/**
 * A rendered cut on the stage: the hand-off note while the run picks the
 * click up, the progress bar while Lambda draws frames, the file itself
 * once it exists. Failures are deliberately NOT here — a failed cut has no
 * tab, and its reason lives beside the button that retries it.
 */
function FileStage({
  state,
  handedOff,
  renderingLabel,
  testId,
  fileRef,
  durationInFrames,
  footer,
}: {
  state: ReturnType<typeof useRenderPoll>
  handedOff: boolean
  renderingLabel: string
  testId: string
  fileRef: React.RefObject<HTMLVideoElement | null>
  durationInFrames: number
  footer: string | undefined
}) {
  const { current, poll, inFlight } = state

  if (handedOff && (!current || !inFlight)) {
    return (
      <div className="rounded-[8px] border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-secondary)]">
        Handed to the render pipeline — this screen updates itself as soon as the run picks it up.
      </div>
    )
  }
  if (!current) return null

  if (inFlight) {
    const pct = Math.max(0, Math.min(100, current.progressPct))
    const startedAt = current.startedAt ? new Date(current.startedAt).getTime() : null
    const elapsedMs = startedAt === null ? null : Date.now() - startedAt
    const remainingMs =
      elapsedMs !== null && pct > 0 ? Math.round((elapsedMs * (100 - pct)) / pct) : null
    return (
      <div className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-4">
        <p className="text-[14px] font-medium">
          {current.status === 'qc' ? 'Quality check running' : renderingLabel}
        </p>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-[8px] overflow-hidden rounded-full bg-[var(--color-surface)]"
        >
          <div
            className="h-full bg-[var(--color-accent)] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {pct}% · frame ~{Math.round((durationInFrames * pct) / 100)} of {durationInFrames}
          {elapsedMs !== null ? ` · ${fmtClock(elapsedMs)} elapsed` : ''}
          {remainingMs !== null ? ` · ~${fmtClock(remainingMs)} left` : ''}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {poll?.outputUrl ? (
        // Narration and captions are burned into the file itself.
        <video
          ref={fileRef}
          controls
          preload="metadata"
          src={poll.outputUrl}
          className="w-full rounded-[8px] bg-black"
          data-testid={testId}
        />
      ) : (
        <div className="rounded-[8px] border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-muted)]">
          Fetching the file&apos;s playable link…
        </div>
      )}
      {footer ? (
        // suppressHydrationWarning: the footer carries a toLocaleString()
        // timestamp, and the server's locale is not the browser's (the
        // publish calendar's slot labels made the same bargain).
        <p suppressHydrationWarning className="text-[12px] text-[var(--color-text-muted)]">
          {footer}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The one decisions card (decision 187): the two spend choices side by side
 * (the cheap half-resolution draft, and "Render master" — the REAL cancel
 * point, spec section 8.1, so both carry their costs and an inline
 * two-step), the failure notes beside the buttons that retry them, and Stop
 * while a master render is in flight. Playback, progress and the QC report
 * all live on the stage, not here.
 */
function RenderActionsCard({
  projectId,
  durationMs,
  estimatedCostUsd,
  estimatedDraftCostUsd,
  draftBusy,
  draftError,
  live,
  atGate,
  masterState,
  act,
  onDraftStarted,
  onMasterStarted,
}: {
  projectId: string
  durationMs: number
  estimatedCostUsd: number
  estimatedDraftCostUsd: number
  /** A draft is in flight — its button hides until that render settles. */
  draftBusy: boolean
  /** The last draft died: said here, beside the button that retries it. */
  draftError: string | null
  live: boolean
  atGate: boolean
  masterState: ReturnType<typeof useRenderPoll>
  act: ReturnType<typeof useAction>
  /** The stage switches to the cut a click just paid for. */
  onDraftStarted: () => void
  onMasterStarted: () => void
}) {
  const { current, inFlight } = masterState
  const cost = live ? `$${estimatedCostUsd.toFixed(2)}` : '$0.00 (renders locally in mock mode)'

  // Drafts only exist live: in mock mode the master button already renders
  // on this machine for free, so a cheap copy has nothing to be cheaper than.
  const draftButton =
    live && !draftBusy ? (
      <ConfirmButton
        variant="outline"
        label={
          <>
            <Clapperboard aria-hidden />
            Render draft · est. ${estimatedDraftCostUsd.toFixed(2)}
          </>
        }
        confirmLabel="Render draft"
        consequence={
          `Invokes Remotion Lambda at half resolution, est. ` +
          `$${estimatedDraftCostUsd.toFixed(2)} — a real file to check before the master. ` +
          'Cheap, but real money.'
        }
        onConfirm={async () => {
          const ok = await act(
            () => requestDraftRender(projectId),
            'Draft render started — progress appears on the stage',
          )
          if (ok) onDraftStarted()
        }}
      />
    ) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">
          {inFlight
            ? 'Rendering'
            : current?.status === 'done' && atGate
              ? 'Render again'
              : 'Render'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {current?.status === 'failed' ? (
          <p className="text-[13px] text-[var(--color-danger)]">
            The last render failed
            {current.error?.message ? `: ${current.error.message}` : '.'}
          </p>
        ) : null}
        {draftError !== null ? (
          <p className="text-[13px] text-[var(--color-danger)]">
            The last draft failed: {draftError}
          </p>
        ) : null}
        {inFlight ? (
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              The master is rendering — progress shows on the stage.
            </p>
            <ConfirmButton
              variant="outline"
              label={
                <>
                  <Square aria-hidden />
                  Stop
                </>
              }
              confirmLabel="Stop the run"
              consequence={
                live
                  ? "Render can't be aborted mid-flight; it will finish in the background, be " +
                    'discarded, and cost ≈ $0.25.'
                  : 'The local render is abandoned; the file is discarded. Nothing was spent.'
              }
              onConfirm={() => act(() => stopProject(projectId), 'Run stopped')}
            />
          </>
        ) : atGate ? (
          /* Also offered again beside a FINISHED master when the gate is
             open — a music swap recompiles the timeline, and the honest way
             to get the new cut into pixels is another explicit spend
             decision. */
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              {fmtClock(durationMs)} of video · draft est. ${estimatedDraftCostUsd.toFixed(2)} ·
              master est. {cost}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {draftButton}
              <ConfirmButton
                variant="primary"
                confirmVariant="primary"
                label={
                  <>Render master · est. {live ? `$${estimatedCostUsd.toFixed(2)}` : '$0.00'}</>
                }
                confirmLabel="Render now"
                consequence={
                  live
                    ? `Invokes Remotion Lambda for ${fmtClock(durationMs)} of video at est. ` +
                      `$${estimatedCostUsd.toFixed(2)}. Once started it cannot be aborted — ` +
                      'stopping discards the file but the cost is still spent.'
                    : 'Renders on this machine in mock mode. Costs nothing and can take a few minutes.'
                }
                onConfirm={async () => {
                  const ok = await act(
                    () => approveGate(projectId, 'preview'),
                    'Render started — progress appears on the stage',
                  )
                  if (ok) onMasterStarted()
                }}
              />
            </div>
          </>
        ) : !current || current.status === 'cancelled' ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            The preview gate is not open, so there is no run waiting to render. Re-run the assembly
            stage to reopen it.
          </p>
        ) : (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            The run has moved on with this master. Re-run the assembly stage to render another cut.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The QC report as located warnings (spec 11.3's QC card, reshaped by
 * decision 184). QC never blocks the pipeline, so this card's job is to make
 * the findings reviewable: every kind carries its likely cause and its fix,
 * and every finding names the chapter it sits in. The raw timestamp list
 * hides behind a labelled button, because 200 rows of slow zooms is noise
 * while "41 spots in chapter 3" is a review plan.
 */
const QC_KINDS: {
  kind: QcReport['issues'][number]['kind']
  label: string
  suggestion: string
}[] = [
  {
    kind: 'silence',
    label: 'Silence',
    suggestion:
      'More than 2.5 s with neither narration nor music. Check the timeline at the flagged ' +
      'times for a gap between slots; if one is real, fix the slot and re-render.',
  },
  {
    kind: 'black-frames',
    label: 'Black frames',
    suggestion:
      'The picture went black, which usually means a visual failed to materialise. Re-run ' +
      'assembly if these are not deliberate fades.',
  },
  {
    kind: 'glitch',
    label: 'Frozen frames',
    suggestion:
      'Held frames are usually deliberate stills, title cards or slow zooms sitting under the ' +
      'motion detector, not a stuck render. Scrub the master at a few of the flagged times; ' +
      'only a real stutter needs a re-render.',
  },
]

/** The chapter a warning sits in, by its start time. */
function chapterAt(chapters: PreviewChapterProp[], atMs: number): string {
  let label = 'Opening'
  chapters.forEach((chapter, index) => {
    if (chapter.startMs <= atMs) label = `${index + 1}. ${chapter.title}`
  })
  return label
}

function QcCard({ report, chapters }: { report: QcReport; chapters: PreviewChapterProp[] }) {
  const [showAll, setShowAll] = React.useState(false)
  const located = report.issues.filter((issue) => issue.kind !== 'loudness')
  const loudnessOff = report.issues.some((issue) => issue.kind === 'loudness')
  const loudnessDelta = report.integratedLufs + 14
  return (
    <Card data-testid="qc-report">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px]">
          Quality check
          <span
            className={
              report.passed
                ? 'rounded-full bg-[var(--color-success)]/15 px-2 py-0.5 text-[12px] text-[var(--color-success)]'
                : 'rounded-full bg-[var(--color-warning)]/15 px-2 py-0.5 text-[12px] text-[var(--color-warning)]'
            }
          >
            {report.passed
              ? 'Passed'
              : `${report.issues.length} warning${report.issues.length === 1 ? '' : 's'}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-[13px]">
        {!report.passed ? (
          <p className="text-[var(--color-text-secondary)]">
            Warnings, not a verdict: the master is playable below and the pipeline has moved on.
            Review them before scheduling the publish.
          </p>
        ) : null}
        <div className="flex flex-col gap-1">
          <p className="flex justify-between gap-2">
            <span>Integrated loudness</span>
            <span
              className={
                loudnessOff
                  ? 'font-mono text-[var(--color-warning)]'
                  : 'font-mono text-[var(--color-success)]'
              }
            >
              {report.integratedLufs.toFixed(1)} LUFS
            </span>
          </p>
          {loudnessOff ? (
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              The mix is {Math.abs(loudnessDelta).toFixed(1)} LU{' '}
              {loudnessDelta < 0 ? 'quieter' : 'louder'} than the -14 LUFS target, so viewers will
              hear it {loudnessDelta < 0 ? 'quieter' : 'louder'} than most videos. Raising the mix
              gain and re-rendering corrects it; leaving it costs only loudness, never a penalty.
            </p>
          ) : null}
        </div>
        {QC_KINDS.map(({ kind, label, suggestion }) => {
          const issues = report.issues.filter((issue) => issue.kind === kind)
          const byChapter = new Map<string, { count: number; totalMs: number }>()
          for (const issue of issues) {
            const where = chapterAt(chapters, issue.atMs)
            const entry = byChapter.get(where) ?? { count: 0, totalMs: 0 }
            entry.count += 1
            entry.totalMs += issue.durationMs ?? 0
            byChapter.set(where, entry)
          }
          return (
            <div key={kind} className="flex flex-col gap-1">
              <p className="flex justify-between gap-2">
                <span>{label}</span>
                <span
                  className={
                    issues.length === 0
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-warning)]'
                  }
                >
                  {issues.length === 0 ? 'OK' : `${issues.length} found`}
                </span>
              </p>
              {issues.length > 0 ? (
                <>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">{suggestion}</p>
                  {[...byChapter.entries()].map(([where, entry]) => (
                    <p
                      key={where}
                      className="flex justify-between gap-2 text-[12px] text-[var(--color-text-secondary)]"
                    >
                      <span>{where}</span>
                      <span className="font-mono">
                        {entry.count} spot{entry.count === 1 ? '' : 's'} · {fmtClock(entry.totalMs)}{' '}
                        flagged
                      </span>
                    </p>
                  ))}
                </>
              ) : null}
            </div>
          )
        })}
        {located.length > 0 ? (
          <Button variant="outline" onClick={() => setShowAll((value) => !value)}>
            {showAll
              ? 'Hide the timestamp list'
              : `Show ${located.length} flagged timestamp${located.length === 1 ? '' : 's'}`}
          </Button>
        ) : null}
        {showAll
          ? located.map((issue, index) => (
              <p key={index} className="text-[12px] text-[var(--color-text-secondary)]">
                <span className="font-mono">{fmtClock(issue.atMs)}</span> ·{' '}
                {chapterAt(chapters, issue.atMs)} · {issue.detail}
              </p>
            ))
          : null}
      </CardContent>
    </Card>
  )
}
