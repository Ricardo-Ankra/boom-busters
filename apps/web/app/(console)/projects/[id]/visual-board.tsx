'use client'

import { ImagePlus, Pause, Play, RefreshCw, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import type { SlotCandidate } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import type { SlotView, VisualsReviewModel } from '@/lib/visuals-review'
import {
  chooseCandidateAction,
  editBriefAction,
  refetchSlotAction,
  uploadOwnAction,
  type ActionResult,
} from './visuals-actions'
import { ChartErrorCard, ChartPreview, MapPreview, type BrandChartColors } from './slot-previews'

/**
 * The visual board (build spec section 11.3): a filmstrip synced to an audio
 * scrubber, slot cards with candidate strips, and per-slot repairs — every
 * action a labelled button on the card it affects.
 *
 * The scrubber plays the narration takes laid end to end on the same clock
 * the slots were timed with. Clicking a slot — in the filmstrip or on its
 * card — seeks the audio to the moment that slot is on screen. (True
 * gapless concatenated audio is an M6 alignment product; here each paragraph
 * take plays in sequence, which is the same audio at the same moments.)
 */

function timecode(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

function candidateThumb(candidate: SlotCandidate): string | undefined {
  if (candidate.thumbUrl) return candidate.thumbUrl
  if (candidate.assetId) return `/api/assets/${candidate.assetId}/file`
  if (candidate.sourceUrl.startsWith('data:') || candidate.sourceUrl.startsWith('http')) {
    return candidate.sourceUrl
  }
  return undefined
}

const STATUS_STYLE: Record<string, string> = {
  resolved: 'text-[var(--color-success)] border-[var(--color-success)]',
  placeholder: 'text-[var(--color-warning)] border-[var(--color-warning)]',
  unresolved: 'text-[var(--color-text-muted)] border-[var(--color-border-strong)]',
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[status] ?? STATUS_STYLE['unresolved']}`}
    >
      {status}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="rounded-[4px] bg-[var(--color-background)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)] uppercase">
      {type}
    </span>
  )
}

export function VisualBoard({
  projectId,
  model,
  colors,
}: {
  projectId: string
  model: VisualsReviewModel
  colors: BrandChartColors
}) {
  const router = useRouter()
  const { toast } = useToast()
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [segmentIndex, setSegmentIndex] = React.useState(0)
  const [positionMs, setPositionMs] = React.useState(0)
  const [busySlot, setBusySlot] = React.useState<string | null>(null)
  const pendingSeekSec = React.useRef(0)

  const playable = model.segments.some((segment) => segment.takeId !== null)
  const allSlots = model.chapters.flatMap((chapter) => chapter.slots)

  const act = React.useCallback(
    async (slotId: string, run: () => Promise<ActionResult>, success: string) => {
      setBusySlot(slotId)
      try {
        const result = await run()
        if (result.ok) {
          toast({ title: success })
          router.refresh()
        } else {
          toast({ title: 'That did not work', description: result.error, variant: 'error' })
        }
      } finally {
        setBusySlot(null)
      }
    },
    [router, toast],
  )

  const loadSegment = React.useCallback(
    (index: number, offsetMs: number, andPlay: boolean) => {
      const audio = audioRef.current
      const segment = model.segments[index]
      if (!audio || !segment?.takeId) return

      setSegmentIndex(index)
      pendingSeekSec.current = offsetMs / 1000
      audio.src = `/api/voice-takes/${segment.takeId}/audio`
      audio.load()
      if (andPlay) void audio.play().catch(() => setPlaying(false))
    },
    [model.segments],
  )

  const seekToMs = React.useCallback(
    (ms: number, andPlay: boolean) => {
      let index = model.segments.findIndex(
        (segment) => ms >= segment.startMs && ms < segment.startMs + segment.durationMs,
      )
      if (index === -1) index = 0
      // A paragraph with no audio cannot be played from; the nearest
      // following one that can be is the honest place to land.
      while (index < model.segments.length && model.segments[index]?.takeId === null) index += 1
      const segment = model.segments[index]
      if (!segment) return
      setPositionMs(Math.max(segment.startMs, ms))
      loadSegment(index, Math.max(0, ms - segment.startMs), andPlay)
    },
    [loadSegment, model.segments],
  )

  const jumpToSlot = React.useCallback(
    (slot: SlotView) => {
      seekToMs(slot.startMs, playing)
      document.getElementById(`slot-${slot.id}`)?.scrollIntoView({ block: 'center' })
    },
    [playing, seekToMs],
  )

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------------------ */}
      {/* Scrubber + filmstrip                                                */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={!playable}
              aria-label={playing ? 'Pause narration' : 'Play narration'}
              onClick={() => {
                const audio = audioRef.current
                if (!audio) return
                if (playing) {
                  audio.pause()
                } else if (audio.src) {
                  void audio.play().catch(() => setPlaying(false))
                } else {
                  seekToMs(0, true)
                }
              }}
            >
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
              {playing ? 'Pause' : 'Play'}
            </Button>
            <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              {timecode(positionMs)} / {timecode(model.totalMs)}
            </span>
            {!playable ? (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                No narration audio to scrub — the board still reviews.
              </span>
            ) : null}
          </div>

          {/* The whole timeline as one clickable bar, slots as bands. */}
          <div
            className="relative flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-background)]"
            aria-hidden
          >
            {allSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                tabIndex={-1}
                title={`${slot.type} · ${timecode(slot.startMs)}`}
                onClick={() => jumpToSlot(slot)}
                className="h-full border-r border-[var(--color-surface)] transition-opacity hover:opacity-70"
                style={{
                  width: `${model.totalMs > 0 ? (slot.durationMs / model.totalMs) * 100 : 0}%`,
                  background:
                    slot.status === 'placeholder'
                      ? 'var(--color-warning)'
                      : slot.status === 'unresolved'
                        ? 'var(--color-border-strong)'
                        : 'var(--color-accent)',
                  opacity: 0.55,
                }}
              />
            ))}
            <div
              className="pointer-events-none absolute top-0 h-full w-[2px] bg-[var(--color-text-primary)]"
              style={{ left: `${model.totalMs > 0 ? (positionMs / model.totalMs) * 100 : 0}%` }}
            />
          </div>

          {/* Filmstrip: one thumb per slot, in narration order. */}
          <div className="flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Filmstrip">
            {allSlots.map((slot) => {
              const chosen = slot.candidates.find((candidate) => candidate.chosen)
              const thumb = chosen ? candidateThumb(chosen) : undefined
              return (
                <button
                  key={slot.id}
                  type="button"
                  role="listitem"
                  onClick={() => jumpToSlot(slot)}
                  className="flex h-[64px] w-[96px] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-[var(--color-background)] text-[10px] text-[var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  aria-label={`Jump to ${slot.type} slot at ${timecode(slot.startMs)}`}
                >
                  {thumb ? (
                    // Plain <img> on purpose: provider-CDN and data: thumbnails,
                    // which next/image can neither optimise nor allowlist.
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <>
                      <span className="font-mono uppercase">{slot.type}</span>
                      <span className="font-mono">{timecode(slot.startMs)}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>

          <audio
            ref={audioRef}
            className="hidden"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = pendingSeekSec.current
              pendingSeekSec.current = 0
            }}
            onTimeUpdate={(event) => {
              const segment = model.segments[segmentIndex]
              if (segment) setPositionMs(segment.startMs + event.currentTarget.currentTime * 1000)
            }}
            onEnded={() => {
              // Continue into the next paragraph that has audio; stop at the end.
              let next = segmentIndex + 1
              while (next < model.segments.length && model.segments[next]?.takeId === null)
                next += 1
              const segment = model.segments[next]
              if (segment) loadSegment(next, 0, true)
              else setPlaying(false)
            }}
          />
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Slot cards, by chapter                                              */}
      {/* ------------------------------------------------------------------ */}
      {model.chapters.map((chapter) => (
        <section key={chapter.chapterIndex} className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">
            Chapter {chapter.chapterIndex + 1} — {chapter.chapterTitle}
          </h2>
          {chapter.slots.map((slot) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              projectId={projectId}
              colors={colors}
              busy={busySlot === slot.id}
              act={act}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One slot
// ---------------------------------------------------------------------------

function SlotCard({
  slot,
  projectId,
  colors,
  busy,
  act,
}: {
  slot: SlotView
  projectId: string
  colors: BrandChartColors
  busy: boolean
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<void>
}) {
  const [editing, setEditing] = React.useState(false)
  const brief = slot.brief

  return (
    <Card id={`slot-${slot.id}`}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={slot.type} />
          <StatusChip status={slot.status} />
          <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
            {timecode(slot.startMs)} · {Math.round(slot.durationMs / 1000)}s
          </span>
        </div>
        {brief ? (
          <CardTitle className="text-[13px] font-normal text-[var(--color-text-secondary)]">
            “{brief.coversText}”
          </CardTitle>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {brief ? (
          <p className="text-[13px] text-[var(--color-text-primary)]">{brief.description}</p>
        ) : null}

        {/* The type-specific middle. */}
        {slot.briefError ? (
          <ChartErrorCard message={slot.briefError} />
        ) : brief?.type === 'chart' ? (
          <div className="flex flex-col gap-2">
            <ChartPreview brief={brief} colors={colors} />
            <p className="text-[12px] text-[var(--color-text-secondary)]">{brief.takeaway}</p>
            <div className="flex flex-wrap gap-1" aria-label="Source claims">
              {brief.dataRefs.map((claimId, index) => (
                <span
                  key={claimId}
                  title={claimId}
                  className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
                >
                  claim {index + 1}
                </span>
              ))}
            </div>
          </div>
        ) : brief?.type === 'map' ? (
          <MapPreview brief={brief} colors={colors} />
        ) : brief?.type === 'hero' ? (
          <p className="rounded-[8px] border border-[var(--color-border)] p-3 text-[13px] text-[var(--color-text-muted)]">
            AI video (hero) is switched off until post-monetisation. This slot stays a placeholder;
            the brief is kept for the day the flag flips.
          </p>
        ) : (
          <CandidateStrip slot={slot} projectId={projectId} act={act} />
        )}

        {slot.status === 'placeholder' && brief?.type !== 'hero' ? (
          <p className="text-[13px] text-[var(--color-warning)]">
            Nothing usable was found for this slot. Edit the brief and re-fetch, or upload your own
            image — approving the board with this still a placeholder must say so explicitly.
          </p>
        ) : null}

        {slot.status === 'unresolved' ? (
          <p className="text-[13px] text-[var(--color-text-muted)]" role="status">
            Being fetched — this row updates itself when candidates land.
          </p>
        ) : null}

        {/* Repairs. Chart and map slots are edited through their briefs too,
            but their data is claim-sourced — the useful repair is re-fetch
            after a dossier change, which Regenerate covers. */}
        {brief && !slot.briefError ? (
          <div className="flex flex-wrap items-center gap-2">
            {brief.type !== 'hero' ? (
              <>
                <Button
                  variant="outline"
                  busy={busy && editing}
                  onClick={() => setEditing((value) => !value)}
                >
                  <Search aria-hidden />
                  {editing ? 'Close brief editor' : 'Edit brief & re-fetch'}
                </Button>
                <Button
                  variant="outline"
                  busy={busy && !editing}
                  onClick={() =>
                    act(
                      slot.id,
                      () => refetchSlotAction(projectId, slot.id, 'Regenerate'),
                      'Re-fetching — the row updates when new candidates land',
                    )
                  }
                >
                  <RefreshCw aria-hidden />
                  {brief.type === 'still' ? 'Regenerate · ≈$0.06' : 'Regenerate'}
                </Button>
              </>
            ) : null}
            {brief.type === 'stock' || brief.type === 'archival' || brief.type === 'still' ? (
              <UploadOwnButton projectId={projectId} slotId={slot.id} act={act} />
            ) : null}
          </div>
        ) : null}

        {editing && brief ? (
          <BriefEditor
            slot={slot}
            projectId={projectId}
            act={act}
            onDone={() => setEditing(false)}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function CandidateStrip({
  slot,
  projectId,
  act,
}: {
  slot: SlotView
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<void>
}) {
  if (slot.candidates.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2" role="list" aria-label="Candidates">
        {slot.candidates.map((candidate) => {
          const thumb = candidateThumb(candidate)
          const chosen = candidate.chosen === true
          return (
            <button
              key={candidate.id}
              type="button"
              role="listitem"
              disabled={chosen}
              onClick={() =>
                act(
                  slot.id,
                  () => chooseCandidateAction(projectId, slot.id, candidate.id),
                  'Selected',
                )
              }
              title={[
                candidate.summary,
                candidate.score !== undefined
                  ? `score ${Math.round(candidate.score)}: ${candidate.scoreReason ?? ''}`
                  : null,
              ]
                .filter(Boolean)
                .join(' — ')}
              className={`relative flex h-[104px] w-[168px] flex-col overflow-hidden rounded-[8px] border-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                chosen
                  ? 'border-[var(--color-accent)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              {thumb ? (
                // Plain <img> on purpose: provider-CDN and data: thumbnails,
                // which next/image can neither optimise nor allowlist.
                <img
                  src={thumb}
                  alt={candidate.summary ?? candidate.id}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-[var(--color-background)] p-2 text-center text-[11px] text-[var(--color-text-muted)]">
                  {candidate.summary ?? candidate.id}
                </span>
              )}
              <span className="absolute top-1 left-1 rounded-[4px] bg-black/60 px-1 font-mono text-[10px] text-white uppercase">
                {candidate.kind}
                {candidate.score !== undefined ? ` · ${Math.round(candidate.score)}` : ''}
              </span>
              {chosen ? (
                <span className="absolute right-1 bottom-1 rounded-[4px] bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Selected
                </span>
              ) : null}
            </button>
          )
        })}
        {slot.extraCandidates > 0 ? (
          <span className="self-center text-[11px] text-[var(--color-text-muted)]">
            +{slot.extraCandidates} more fetched
          </span>
        ) : null}
      </div>
      <ChosenFacts slot={slot} />
    </div>
  )
}

/** Licence and attribution of the current choice — the audit line. */
function ChosenFacts({ slot }: { slot: SlotView }) {
  const chosen = slot.candidates.find((candidate) => candidate.chosen)
  if (!chosen) return null
  return (
    <p className="text-[11px] text-[var(--color-text-muted)]">
      {chosen.licence}
      {chosen.attributionText ? ` · ${chosen.attributionText}` : ''}
      {chosen.pageUrl ? (
        <>
          {' · '}
          <a
            href={chosen.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-[var(--color-text-secondary)]"
          >
            source
          </a>
        </>
      ) : null}
    </p>
  )
}

function BriefEditor({
  slot,
  projectId,
  act,
  onDone,
}: {
  slot: SlotView
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<void>
  onDone: () => void
}) {
  const brief = slot.brief
  const [description, setDescription] = React.useState(brief?.description ?? '')
  const [query, setQuery] = React.useState(
    brief && (brief.type === 'stock' || brief.type === 'archival') ? brief.query : '',
  )
  const [mustShow, setMustShow] = React.useState(brief?.type === 'archival' ? brief.mustShow : '')
  const [prompt, setPrompt] = React.useState(brief?.type === 'still' ? brief.prompt : '')
  if (!brief) return null

  const field =
    'rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'

  return (
    <form
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void act(
          slot.id,
          () =>
            editBriefAction(projectId, slot.id, {
              description,
              ...(brief.type === 'stock' || brief.type === 'archival' ? { query } : {}),
              ...(brief.type === 'archival' ? { mustShow } : {}),
              ...(brief.type === 'still' ? { prompt } : {}),
            }),
          'Brief saved — re-fetching against it now',
        ).then(onDone)
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
        Visual description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className={field}
        />
      </label>
      {brief.type === 'stock' || brief.type === 'archival' ? (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Search query
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={field}
          />
        </label>
      ) : null}
      {brief.type === 'archival' ? (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Must show
          <input
            value={mustShow}
            onChange={(event) => setMustShow(event.target.value)}
            className={field}
          />
        </label>
      ) : null}
      {brief.type === 'still' ? (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Generation prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            className={field}
          />
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Save & re-fetch{brief.type === 'still' ? ' · ≈$0.06' : ''}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function UploadOwnButton({
  projectId,
  slotId,
  act,
}: {
  projectId: string
  slotId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<void>
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  return (
    <>
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <ImagePlus aria-hidden />
        Upload own
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="Upload your own image for this slot"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          const formData = new FormData()
          formData.set('projectId', projectId)
          formData.set('slotId', slotId)
          formData.set('file', file)
          void act(slotId, () => uploadOwnAction(formData), 'Uploaded and selected')
        }}
      />
    </>
  )
}
