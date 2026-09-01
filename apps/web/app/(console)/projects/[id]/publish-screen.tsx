'use client'

import * as React from 'react'
import {
  CalendarClock,
  Check,
  ImagePlus,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { composeDescription, formatTimestamp } from '@boom-busters/schemas'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { PublishItemModel, PublishModel } from '@/lib/publish-review'
import { RetentionOverlay } from './retention-overlay'
import {
  generateTitles,
  removeThumbnail,
  reschedulePublish,
  retryPublish,
  savePublishDraft,
  schedulePublish,
  uploadThumbnail,
} from './publish-actions'
import { useAction } from './project-controls'

/**
 * The Publish screen (build spec section 11.3): a week calendar built from
 * the Publishing settings' default slots, an item editor (title picker,
 * description live preview with the auto-blocks, tags, thumbnail dropzone),
 * status chips through draft→uploading→scheduled→live, and mapped errors
 * with a retry.
 *
 * Scheduling is click-first — select an item, press the slot's own button —
 * with drag-to-slot layered on top, because the E2E suite asserts no action
 * needs anything but a visible button (spec section 13).
 */

const DAYS_SHOWN = 14

/** Client-side mirror of the server limits; the action re-checks all three. */
const THUMB_MAX_BYTES = 2 * 1024 * 1024
const THUMB_MIN_WIDTH = 1280
const THUMB_MIN_HEIGHT = 720
const THUMB_LIMIT = 3

interface SlotInstance {
  iso: string
  kind: 'longform' | 'short'
}

/**
 * The settings slots, materialised onto the next `DAYS_SHOWN` UTC days.
 * Weekday and time are stored in UTC (spec section 11.3); only the labels
 * are local.
 */
function upcomingDays(
  slots: PublishModel['slots'],
  now: Date,
): { dayIso: string; slots: SlotInstance[] }[] {
  const days: { dayIso: string; slots: SlotInstance[] }[] = []
  for (let offset = 0; offset < DAYS_SHOWN; offset += 1) {
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset),
    )
    const instances: SlotInstance[] = []
    for (const slot of slots) {
      if (slot.weekday !== day.getUTCDay()) continue
      const [hours, minutes] = slot.timeUtc.split(':').map(Number)
      const at = new Date(day)
      at.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0)
      if (at.getTime() <= now.getTime()) continue
      instances.push({ iso: at.toISOString(), kind: slot.kind })
    }
    instances.sort((a, b) => a.iso.localeCompare(b.iso))
    days.push({ dayIso: day.toISOString(), slots: instances })
  }
  return days
}

function keyOf(item: PublishItemModel): string {
  return `${item.targetType}:${item.targetId}`
}

function slotKindFor(item: PublishItemModel): 'longform' | 'short' {
  return item.targetType === 'master' ? 'longform' : 'short'
}

/** Whether the item can be put on a slot for the first time right now. */
function schedulable(item: PublishItemModel): boolean {
  const status = item.record?.status ?? 'draft'
  return item.notReadyReason === null && (status === 'draft' || status === 'failed')
}

/**
 * Whether an already-scheduled item can be moved to a different slot. Only
 * `scheduled` qualifies: an upload in flight has no settled video to move
 * yet, and a live video has no moment left to move.
 */
function movable(item: PublishItemModel): boolean {
  return item.record?.status === 'scheduled' && Boolean(item.record.youtubeVideoId)
}

function StatusChip({ item }: { item: PublishItemModel }) {
  const status = item.record?.status ?? 'draft'
  const styles: Record<string, string> = {
    draft: 'border-[var(--color-border)] text-[var(--color-text-secondary)]',
    uploading: 'border-[var(--color-warning)] text-[var(--color-warning)]',
    uploaded: 'border-[var(--color-warning)] text-[var(--color-warning)]',
    scheduled: 'border-[var(--color-success)] text-[var(--color-success)]',
    live: 'border-[var(--color-success)] text-[var(--color-success)]',
    failed: 'border-[var(--color-danger)] text-[var(--color-danger)]',
  }
  const labels: Record<string, string> = {
    draft: 'Draft',
    uploading: 'Uploading',
    uploaded: 'Uploaded — finishing',
    scheduled: 'Scheduled',
    live: 'Live',
    failed: 'Failed',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${styles[status]}`}
    >
      {status === 'uploading' || status === 'uploaded' ? (
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
      ) : null}
      {labels[status]}
    </span>
  )
}

export function PublishScreen({
  projectId,
  model,
  live,
}: {
  projectId: string
  model: PublishModel
  live: boolean
}) {
  const act = useAction()
  const [selectedKey, setSelectedKey] = React.useState<string | null>(() => {
    const first = model.items.find(schedulable)
    return first ? keyOf(first) : null
  })
  const [now] = React.useState(() => new Date())

  const selected = model.items.find((item) => keyOf(item) === selectedKey) ?? null
  const days = React.useMemo(() => upcomingDays(model.slots, now), [model.slots, now])
  const scheduledAt = new Map(
    model.items
      .filter((item) => item.record?.publishAtIso && item.record.status !== 'failed')
      .map((item) => [item.record!.publishAtIso!, item]),
  )

  const schedule = (item: PublishItemModel, iso: string) =>
    act(
      () => schedulePublish(item.targetType, item.targetId, iso),
      'Scheduled — the upload starts now',
    )

  // The same gesture as scheduling — select, press a slot — but the video is
  // already on YouTube, so this re-points its publish moment instead of
  // starting an upload.
  const move = (item: PublishItemModel, iso: string) =>
    act(
      () => reschedulePublish(item.targetType, item.targetId, iso),
      'Moved — it goes public at the new time',
    )

  return (
    <section aria-label="Publish" className="flex flex-col gap-4">
      {!model.apiAuditPassed ? <AuditChecklist /> : null}

      {/* The numbers, once the master is live and the daily pass has seen
          it (M8) — first on the screen because after publish day this IS
          the screen. */}
      {model.analytics ? (
        <RetentionOverlay
          analytics={model.analytics}
          chapters={model.chapters}
          durationMs={model.masterDurationMs}
        />
      ) : null}

      <p className="text-[12px] text-[var(--color-text-muted)]">
        {model.uploadsToday} of {model.dailyUploadBudget} upload starts used in today&apos;s YouTube
        quota day (resets at midnight Pacific). Anything over the budget queues for tomorrow on its
        own.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* The items                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-3 md:grid-cols-2">
        {model.items.map((item) => {
          const key = keyOf(item)
          const isSelected = key === selectedKey
          return (
            <Card
              key={key}
              draggable={schedulable(item) || movable(item)}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/boom-busters-item', key)
                setSelectedKey(key)
              }}
              className={isSelected ? 'border-[var(--color-accent)]' : undefined}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[14px]">
                  <span className="rounded-[4px] border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] uppercase">
                    {item.targetType === 'master' ? 'Full video' : 'Short'}
                  </span>
                  <span className="truncate">{item.record?.title ?? item.label}</span>
                  <span className="ml-auto">
                    <StatusChip item={item} />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {item.record?.publishAtIso ? (
                  <p className="text-[12px] text-[var(--color-text-secondary)]">
                    <CalendarClock aria-hidden className="mr-1 inline h-3.5 w-3.5" />
                    Goes public{' '}
                    <time suppressHydrationWarning>
                      {new Date(item.record.publishAtIso).toLocaleString()}
                    </time>
                    {item.record.youtubeVideoId ? ` · ${item.record.youtubeVideoId}` : ''}
                  </p>
                ) : null}
                {item.notReadyReason ? (
                  <p className="text-[12px] text-[var(--color-warning)]">{item.notReadyReason}</p>
                ) : null}
                {item.record?.errorMessage ? (
                  <p className="text-[12px] text-[var(--color-danger)]">
                    {item.record.errorMessage}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={isSelected ? 'primary' : 'outline'}
                    onClick={() => setSelectedKey(key)}
                  >
                    {/* A scheduled item's metadata is Studio's to edit, but
                        its slot is still ours to move — selecting it arms the
                        calendar's Move-here buttons below. */}
                    {movable(item)
                      ? isSelected
                        ? 'Pick a new slot below'
                        : 'Move the slot'
                      : isSelected
                        ? 'Editing'
                        : 'Edit metadata'}
                  </Button>
                  {item.record?.status === 'failed' && item.record.publishAtIso ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void act(
                          () => retryPublish(item.targetType, item.targetId),
                          'Retrying the upload',
                        )
                      }
                    >
                      <RefreshCw aria-hidden className="h-4 w-4" />
                      Retry upload
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The item editor                                                     */}
      {/* ------------------------------------------------------------------ */}
      {selected ? (
        <ItemEditor
          key={selectedKey}
          projectId={projectId}
          item={selected}
          model={model}
          live={live}
        />
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* The calendar                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">Schedule</CardTitle>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            The next two weeks of your default slots (Settings → Publishing), shown in your
            timezone. Select an item, then press its slot — or drag the card onto one.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            {days.map((day) => (
              <div
                key={day.dayIso}
                className="flex min-h-[72px] flex-col gap-1.5 rounded-[8px] border border-[var(--color-border)] p-2"
              >
                <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
                  <time suppressHydrationWarning>
                    {new Date(day.dayIso).toLocaleDateString(undefined, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      timeZone: 'UTC',
                    })}
                  </time>
                </p>
                {day.slots.map((slot) => {
                  const occupant = scheduledAt.get(slot.iso)
                  const fits = selected !== null && slotKindFor(selected) === slot.kind
                  // A slot occupied by the SELECTED draft still offers its
                  // button: a runner refusal (or a failed event send) leaves
                  // the record draft-with-slot, and re-pressing the same slot
                  // is how the upload is asked for again once it is fixed.
                  const offerable =
                    (!occupant || occupant === selected) &&
                    selected !== null &&
                    fits &&
                    schedulable(selected)
                  // The already-on-YouTube counterpart: an empty slot offers
                  // to MOVE the selected scheduled item here. Its own current
                  // slot offers nothing — there is nowhere to move to.
                  const moveOfferable = !occupant && selected !== null && fits && movable(selected)
                  return (
                    <div
                      key={slot.iso}
                      onDragOver={(event) => {
                        if (!occupant) event.preventDefault()
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const dropped = event.dataTransfer.getData('text/boom-busters-item')
                        const item = model.items.find((candidate) => keyOf(candidate) === dropped)
                        if (!item || occupant || slotKindFor(item) !== slot.kind) return
                        if (schedulable(item)) void schedule(item, slot.iso)
                        else if (movable(item)) void move(item, slot.iso)
                      }}
                      className="rounded-[6px] border border-dashed border-[var(--color-border)] p-1.5"
                    >
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        <time suppressHydrationWarning>
                          {new Date(slot.iso).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>{' '}
                        · {slot.kind === 'longform' ? 'long-form' : 'Short'}
                      </p>
                      {occupant ? (
                        <p className="truncate text-[12px] text-[var(--color-success)]">
                          {occupant.record?.title ?? occupant.label}
                        </p>
                      ) : null}
                      {offerable ? (
                        <Button
                          variant="outline"
                          className="mt-1 w-full"
                          onClick={() => void schedule(selected!, slot.iso)}
                        >
                          {occupant === selected ? 'Start the upload again' : 'Schedule here'}
                        </Button>
                      ) : moveOfferable ? (
                        <Button
                          variant="outline"
                          className="mt-1 w-full"
                          onClick={() => void move(selected!, slot.iso)}
                        >
                          Move here
                        </Button>
                      ) : !occupant ? (
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                          {selected === null
                            ? 'Select an item above'
                            : !fits
                              ? 'Wrong format for this slot'
                              : 'Not ready'}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
                {day.slots.length === 0 ? (
                  <p className="text-[11px] text-[var(--color-text-muted)]">—</p>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * The private-until-audit checklist (build spec section 9): until the API
 * compliance audit passes, `publishAt` cannot be trusted to flip the video
 * public, so the screen says what the human still owns instead of
 * pretending.
 */
function AuditChecklist() {
  return (
    <Card className="border-[var(--color-warning)]">
      <CardHeader>
        <CardTitle className="text-[14px]">
          Until the YouTube API audit passes, going public is a manual step
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] text-[var(--color-text-secondary)]">
          <li>Scheduling here uploads the video as private — that part is automatic.</li>
          <li>The title, description, tags and thumbnail are set on it — also automatic.</li>
          <li>
            At the scheduled time, flip it to public in YouTube Studio. Mark the audit as passed in
            Settings → Publishing once Google approves, and this step disappears.
          </li>
        </ol>
      </CardContent>
    </Card>
  )
}

function ItemEditor({
  projectId,
  item,
  model,
  live,
}: {
  projectId: string
  item: PublishItemModel
  model: PublishModel
  live: boolean
}) {
  const act = useAction()
  const record = item.record
  const [title, setTitle] = React.useState(record?.title ?? item.label)
  const [body, setBody] = React.useState(record?.descriptionBody ?? model.hook)
  const [tags, setTags] = React.useState((record?.tags ?? []).join(', '))
  const [thumbError, setThumbError] = React.useState<string | null>(null)
  const [uploadingThumb, setUploadingThumb] = React.useState(false)

  const preview = composeDescription({
    body,
    chapters: item.targetType === 'master' ? model.chapters : [],
    sources: model.sources,
  })

  const dirty =
    title !== (record?.title ?? item.label) ||
    body !== (record?.descriptionBody ?? model.hook) ||
    tags !== (record?.tags ?? []).join(', ')

  const onThumbFile = async (file: File | undefined) => {
    if (!file) return
    setThumbError(null)
    if (file.type !== 'image/png') {
      setThumbError('Only PNGs — export one from Canva.')
      return
    }
    if (file.size > THUMB_MAX_BYTES) {
      setThumbError('That file is over YouTube’s 2 MB thumbnail limit.')
      return
    }
    // Dimensions, when the browser can decode here; the server re-checks.
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file)
        const { width, height } = bitmap
        bitmap.close()
        if (width < THUMB_MIN_WIDTH || height < THUMB_MIN_HEIGHT) {
          setThumbError(`That PNG is ${width}×${height}; YouTube wants at least 1280×720.`)
          return
        }
      } catch {
        // Undecodable here is not proof of anything; the server decides.
      }
    }
    const formData = new FormData()
    formData.set('projectId', projectId)
    formData.set('file', file)
    setUploadingThumb(true)
    try {
      await act(() => uploadThumbnail(formData), 'Thumbnail stored')
    } finally {
      setUploadingThumb(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">
          {item.targetType === 'master' ? 'Full video' : 'Short'}: {item.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          {/* Title picker: the generated options as radios, free edit beside. */}
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--color-text-secondary)]">Title</span>
            <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
            <span className="text-[11px] text-[var(--color-text-muted)]">{title.length}/100</span>
          </div>

          {record && record.titleOptions.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[12px] text-[var(--color-text-secondary)]">
                Generated options
              </legend>
              {record.titleOptions.map((option) => (
                <label
                  key={option}
                  className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-3 py-1.5 text-[13px]"
                >
                  <input
                    type="radio"
                    name={`title-${item.targetId}`}
                    checked={title === option}
                    onChange={() => setTitle(option)}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
          ) : null}

          {live ? (
            <ConfirmButton
              label={
                <>
                  <Sparkles aria-hidden className="h-4 w-4" />
                  Generate 8 title options
                </>
              }
              confirmLabel="Generate"
              consequence="One small model call — a fraction of a cent against the metadata task's budget."
              confirmVariant="primary"
              onConfirm={() =>
                act(() => generateTitles(item.targetType, item.targetId), 'Titles generated')
              }
            />
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                void act(() => generateTitles(item.targetType, item.targetId), 'Titles generated')
              }
            >
              <Sparkles aria-hidden className="h-4 w-4" />
              Generate 8 title options (mock)
            </Button>
          )}

          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Description — your opening; chapters, sources and the disclaimer are appended
            <textarea
              value={body}
              rows={5}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            />
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Tags, comma-separated (max 60)
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>

          {dirty ? (
            <Button
              variant="outline"
              onClick={() =>
                void act(
                  () =>
                    savePublishDraft(item.targetType, item.targetId, {
                      title,
                      descriptionBody: body,
                      tags,
                    }),
                  'Draft saved',
                )
              }
            >
              <Save aria-hidden className="h-4 w-4" />
              Save draft
            </Button>
          ) : null}

          {/* Thumbnails — masters only; Shorts use a frame of the video. */}
          {item.targetType === 'master' ? (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] text-[var(--color-text-secondary)]">
                Thumbnail — export from Canva, drop up to {THUMB_LIMIT} PNGs (1280×720+, ≤2 MB)
              </span>
              <div
                data-testid="thumb-dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  void onThumbFile(e.dataTransfer.files[0])
                }}
                className="flex flex-col items-start gap-2 rounded-[8px] border border-dashed border-[var(--color-border)] p-3"
              >
                <label className="inline-flex">
                  <input
                    type="file"
                    accept="image/png"
                    className="sr-only"
                    onChange={(e) => {
                      void onThumbFile(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                  <span className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-3 py-2 text-[13px]">
                    {uploadingThumb ? (
                      <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus aria-hidden className="h-4 w-4" />
                    )}
                    Choose a PNG…
                  </span>
                </label>
                <a
                  href="https://www.canva.com/youtube-thumbnails/templates/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-accent)]"
                >
                  Open the Canva thumbnail templates
                </a>
                {thumbError ? (
                  <p className="text-[12px] text-[var(--color-danger)]">{thumbError}</p>
                ) : null}
                {(record?.thumbs ?? []).map((thumb, index) => (
                  <div key={thumb.key} className="flex w-full items-center gap-2">
                    {thumb.url ? (
                      // A presigned R2 URL, not an optimisable asset — plain img.
                      <img
                        src={thumb.url}
                        alt={`Thumbnail ${index + 1}`}
                        className="h-[45px] w-[80px] rounded-[4px] border border-[var(--color-border)] object-cover"
                      />
                    ) : (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {thumb.key.split('/').pop()}
                      </span>
                    )}
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                      {index === 0 ? 'Set via the API' : 'For Test & Compare in Studio'}
                    </span>
                    <Button
                      variant="outline"
                      className="ml-auto"
                      onClick={() =>
                        void act(() => removeThumbnail(projectId, thumb.key), 'Thumbnail removed')
                      }
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                ))}
                {(record?.thumbs.length ?? 0) > 1 ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
                    <Check aria-hidden className="h-3.5 w-3.5" />
                    Only the first is set via the API — set up Test &amp; Compare with the others in
                    YouTube Studio yourself.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* The live preview: exactly what the schedule action will write. */}
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            Description preview · {preview.description.length}/5000
            {preview.droppedSources > 0
              ? ` · ${preview.droppedSources} source(s) trimmed to fit`
              : ''}
          </span>
          <pre className="max-h-[420px] overflow-auto rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-sans text-[12px] whitespace-pre-wrap text-[var(--color-text-secondary)]">
            {preview.description}
          </pre>
          {item.targetType === 'master' && model.chapters.length > 0 ? (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Chapter stamps come from the master timeline: first chapter at 0:00, last at{' '}
              {formatTimestamp(model.chapters[model.chapters.length - 1]!.startMs)}.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
