'use client'

import { Player } from '@remotion/player'
import type { PlayerRef } from '@remotion/player'
import { prefetch } from 'remotion'
import { DocumentaryMaster } from '@boom-busters/compositions'
import { gainAt } from '@boom-busters/schemas'
import type { QcReport, Timeline } from '@boom-busters/schemas'
import { Captions, Download, Film, Music, Square } from 'lucide-react'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { approveGate, stopProject } from '../actions'
import { chooseMusicBed } from './preview-actions'
import { useAction } from './project-controls'

/**
 * Preview & render — Gate 5a (build spec section 11.3). Full-width
 * `@remotion/player` of the compiled timeline with chapter markers, a
 * caption toggle and the music-duck gain line; beside it the stats, the
 * music picker (a swap recompiles the timeline — cheap and free), and the
 * "Render master" button, which IS the gate approval: section 7.6 starts
 * the render-runner on `gate/preview.approved`, so the click that spends
 * the money and the event that closes the gate are one action.
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

/** Every URL the player will fetch, deduped — the buffer button's manifest. */
function mediaUrls(timeline: Timeline): string[] {
  const urls = new Set<string>()
  for (const slot of timeline.slots) {
    if (slot.payload.kind === 'image' || slot.payload.kind === 'video') {
      const url = slot.payload.src.url ?? slot.payload.src.externalUrl
      if (url !== undefined) urls.add(url)
    }
  }
  for (const segment of timeline.narration) {
    if (segment.url !== undefined) urls.add(segment.url)
  }
  if (timeline.music?.url !== undefined) urls.add(timeline.music.url)
  return [...urls]
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
  live,
  atGate,
  render,
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
  /** Whether a broker is configured — false means renders run locally, free. */
  live: boolean
  /** Whether the preview gate is open, i.e. Render master would be heard. */
  atGate: boolean
  render: PreviewRenderProp | null
}) {
  const act = useAction()
  const playerRef = React.useRef<PlayerRef>(null)
  const [captionsOn, setCaptionsOn] = React.useState(true)

  const durationMs = timelineDuration(timeline)
  const durationInFrames = Math.max(1, msToFrames(durationMs, timeline.fps))

  const shown = React.useMemo<Timeline>(
    () =>
      captionsOn
        ? timeline
        : { ...timeline, captions: { ...timeline.captions, style: 'none' as const } },
    [timeline, captionsOn],
  )

  const droppedTotal = dropped.narration + dropped.slots + (dropped.music ? 1 : 0)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-3">
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
            style={{ width: '100%' }}
          />
        </div>

        <ChapterStrip
          chapters={chapters}
          durationMs={durationMs}
          onSeek={(ms) => playerRef.current?.seekTo(msToFrames(ms, timeline.fps))}
        />

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
          <BufferControl timeline={timeline} />
          {droppedTotal > 0 ? (
            <p className="text-[13px] text-[var(--color-warning)]">
              {droppedTotal} item{droppedTotal === 1 ? ' is' : 's are'} not previewable here
              {dropped.music ? ' (including the music bed)' : ''} — storage is not configured, so
              their bytes cannot be fetched. The render resolves them for real.
            </p>
          ) : null}
        </div>
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

        <RenderPanel
          projectId={projectId}
          durationMs={durationMs}
          durationInFrames={durationInFrames}
          estimatedCostUsd={estimatedCostUsd}
          live={live}
          atGate={atGate}
          render={render}
          act={act}
        />
      </div>
    </div>
  )
}

/**
 * "Buffer full preview": every media file the timeline references, fetched
 * into blob URLs up front via Remotion's `prefetch`, so playback never
 * touches the network — no mid-play buffering, no presigned URL expiring
 * an hour into a long moderation session. A button rather than automatic
 * (spec section 11.1, button-first) because it moves real megabytes: a
 * 14-minute cut's narration and clips are a few hundred MB, a download the
 * human should choose, not pay on every page load.
 */
function BufferControl({ timeline }: { timeline: Timeline }) {
  const urls = React.useMemo(() => mediaUrls(timeline), [timeline])
  const [phase, setPhase] = React.useState<'idle' | 'busy' | 'done'>('idle')
  const [progress, setProgress] = React.useState({ done: 0, failed: 0 })
  const handles = React.useRef<{ free: () => void }[]>([])

  // Blob URLs hold their bytes until freed; leaving the screen releases them.
  React.useEffect(
    () => () => {
      for (const handle of handles.current) handle.free()
      handles.current = []
    },
    [],
  )

  if (urls.length === 0) return null

  const buffer = async () => {
    setPhase('busy')
    setProgress({ done: 0, failed: 0 })
    const queue = [...urls]
    let done = 0
    let failed = 0
    // Four at a time: enough to fill the pipe without stampeding the CDN.
    const worker = async () => {
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        try {
          const handle = prefetch(url, { method: 'blob-url' })
          handles.current.push(handle)
          await handle.waitUntilDone()
          done += 1
        } catch (error) {
          failed += 1
          // Named in devtools on purpose. `prefetch` is a fetch(), so it
          // needs CORS the player's media tags never did — a bucket without
          // a CORS policy fails ALL of these while playing back fine.
          console.warn(`Buffer failed for ${url}`, error)
        }
        setProgress({ done, failed })
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker))
    setPhase('done')
  }

  const label =
    phase === 'busy'
      ? `Buffering ${progress.done + progress.failed} of ${urls.length}…`
      : phase === 'done' && progress.failed === 0
        ? 'Fully buffered — plays from memory'
        : phase === 'done'
          ? `Buffered — ${progress.failed} file${progress.failed === 1 ? '' : 's'} failed, retry`
          : `Buffer full preview (${urls.length} files)`

  return (
    <Button
      variant="outline"
      busy={phase === 'busy'}
      disabled={phase === 'done' && progress.failed === 0}
      onClick={() => void buffer()}
    >
      <Download aria-hidden />
      {label}
    </Button>
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
 * The render half of the screen: the button (the REAL cancel point — spec
 * section 8.1 — so it carries the cost and an inline two-step), then the
 * 2-second progress poll, then the QC report card and the master itself.
 */
function RenderPanel({
  projectId,
  durationMs,
  durationInFrames,
  estimatedCostUsd,
  live,
  atGate,
  render,
  act,
}: {
  projectId: string
  durationMs: number
  durationInFrames: number
  estimatedCostUsd: number
  live: boolean
  atGate: boolean
  render: PreviewRenderProp | null
  act: ReturnType<typeof useAction>
}) {
  const [poll, setPoll] = React.useState<RenderPoll | null>(null)
  const [handedOff, setHandedOff] = React.useState(false)

  const current: RenderPoll | null = poll ?? render
  const inFlight =
    current !== null &&
    (current.status === 'queued' ||
      current.status === 'invoking' ||
      current.status === 'rendering' ||
      current.status === 'qc')

  // 2 s polling while a render is in flight, one fetch when it is done —
  // the finished master's playable URL only exists on the poll response.
  const renderId = render?.id
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

  const cost = live ? `$${estimatedCostUsd.toFixed(2)}` : '$0.00 (renders locally in mock mode)'

  if (handedOff && (!current || !inFlight)) {
    return (
      <Card>
        <CardContent className="pt-4 text-[13px] text-[var(--color-text-secondary)]">
          Handed to the render pipeline — this screen updates itself as soon as the run picks it up.
        </CardContent>
      </Card>
    )
  }

  /**
   * The invoke card. Also offered again beside a FINISHED master when the
   * gate is open — a music swap recompiles the timeline, and the honest way
   * to get the new cut into pixels is another explicit spend decision.
   */
  const renderButton = atGate ? (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">
          {current?.status === 'done' ? 'Render again' : 'Render master'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {current?.status === 'failed' ? (
          <p className="text-[13px] text-[var(--color-danger)]">
            The last render failed
            {current.error?.message ? `: ${current.error.message}` : '.'}
          </p>
        ) : null}
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {fmtClock(durationMs)} of video · est. {cost}
        </p>
        <ConfirmButton
          variant="primary"
          confirmVariant="primary"
          label={<>Render master · est. {live ? `$${estimatedCostUsd.toFixed(2)}` : '$0.00'}</>}
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
              'Render started — progress appears here',
            )
            if (ok) setHandedOff(true)
          }}
        />
      </CardContent>
    </Card>
  ) : null

  if (!current || current.status === 'cancelled') {
    return (
      renderButton ?? (
        <Card>
          <CardContent className="pt-4 text-[13px] text-[var(--color-text-muted)]">
            The preview gate is not open, so there is no run waiting to render. Re-run the assembly
            stage to reopen it.
          </CardContent>
        </Card>
      )
    )
  }

  if (inFlight) {
    const pct = Math.max(0, Math.min(100, current.progressPct))
    const startedAt = current.startedAt ? new Date(current.startedAt).getTime() : null
    const elapsedMs = startedAt === null ? null : Date.now() - startedAt
    const remainingMs =
      elapsedMs !== null && pct > 0 ? Math.round((elapsedMs * (100 - pct)) / pct) : null
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">
            {current.status === 'qc' ? 'Quality check running' : 'Rendering master'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
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
        </CardContent>
      </Card>
    )
  }

  // Terminal: done, or failed-after-render (QC failure keeps the master
  // playable for inspection; nothing publishes around it). With the gate
  // open the invoke card sits beneath, offering the next render.
  return (
    <div className="flex flex-col gap-4">
      {current.qcReport ? <QcCard report={current.qcReport} /> : null}
      {current.status === 'failed' && !current.qcReport ? (
        <Card>
          <CardContent className="pt-4 text-[13px] text-[var(--color-danger)]">
            The render failed{current.error?.message ? `: ${current.error.message}` : '.'}
          </CardContent>
        </Card>
      ) : null}
      {poll?.outputUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Master</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {/* Narration and captions are burned into the file itself. */}
            <video
              controls
              preload="metadata"
              src={poll.outputUrl}
              className="w-full rounded-[8px] bg-black"
              data-testid="master-video"
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Cost ${Number(current.costUsd).toFixed(2)}
              {current.completedAt
                ? ` · finished ${new Date(current.completedAt).toLocaleString()}`
                : ''}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {renderButton}
    </div>
  )
}

/** Pass/fail per check, timestamped issues (spec 11.3's QC report card). */
function QcCard({ report }: { report: QcReport }) {
  const KINDS: { kind: QcReport['issues'][number]['kind']; label: string }[] = [
    { kind: 'silence', label: 'Silence' },
    { kind: 'black-frames', label: 'Black frames' },
    { kind: 'glitch', label: 'Frozen frames' },
    { kind: 'loudness', label: 'Loudness' },
  ]
  return (
    <Card data-testid="qc-report">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px]">
          Quality check
          <span
            className={
              report.passed
                ? 'rounded-full bg-[var(--color-success)]/15 px-2 py-0.5 text-[12px] text-[var(--color-success)]'
                : 'rounded-full bg-[var(--color-danger)]/15 px-2 py-0.5 text-[12px] text-[var(--color-danger)]'
            }
          >
            {report.passed ? 'Passed' : 'Failed'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-[13px]">
        {KINDS.map(({ kind, label }) => {
          const issues = report.issues.filter((issue) => issue.kind === kind)
          return (
            <p key={kind} className="flex justify-between gap-2">
              <span>{label}</span>
              <span
                className={
                  issues.length === 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
                }
              >
                {issues.length === 0 ? 'OK' : `${issues.length} found`}
              </span>
            </p>
          )
        })}
        <p className="flex justify-between gap-2">
          <span>Integrated loudness</span>
          <span className="font-mono">{report.integratedLufs.toFixed(1)} LUFS</span>
        </p>
        {report.issues.map((issue, index) => (
          <p key={index} className="text-[12px] text-[var(--color-text-secondary)]">
            <span className="font-mono">{fmtClock(issue.atMs)}</span> · {issue.detail}
          </p>
        ))}
      </CardContent>
    </Card>
  )
}
