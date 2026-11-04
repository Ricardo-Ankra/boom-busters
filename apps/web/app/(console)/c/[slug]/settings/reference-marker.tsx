'use client'

import {
  DENSE_FRAME_WIDTH,
  OVERVIEW_FRAME_WIDTH,
  REFERENCE_CLIP_MAX_MS,
  REFERENCE_IMAGE_MAX_BYTES,
  REFERENCE_IMAGE_MIMES,
  REFERENCE_PURPOSES,
  REFERENCE_VIDEO_MAX_BYTES,
  REFERENCE_VIDEO_MIMES,
  REFERENCE_WINDOW_MAX_MS,
  REFERENCE_WINDOW_MIN_MS,
  type ReferencePurpose,
} from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, NumberInput, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { fingerprint } from '@/lib/client-hash'
import { readImageSize, toUploadableImage } from '@/lib/client-image'
import {
  browserGrabber,
  fittedWidth,
  grabFrames,
  readVideoMeta,
  referenceFrameSets,
  type GrabbedFrame,
} from '@/lib/client-video'
import {
  createReferenceFrameUploadsAction,
  createReferenceUploadAction,
  finaliseReferenceAction,
  remarkReferenceAction,
} from './motion-actions'
import type { ReferenceView } from './references-section'

/**
 * The marker (spec 2026-11-04, section 7.2): a still or a clip chosen,
 * described, and for a clip marked with a window of one to four seconds.
 * The browser decodes the clip, takes the dense set across the window and
 * the overview across the whole clip, and PUTs every frame on its own
 * presigned URL; the server verifies the set against the window before a
 * row is written. "Save and read" sends the reference to the reader with
 * its estimated cost beside it; "Save without reading" stores it unread.
 */

const ACCEPT = [...REFERENCE_IMAGE_MIMES, ...REFERENCE_VIDEO_MIMES].join(',')
const STORAGE_LINE = 'Reference uploads need R2 configured; there is nowhere to store them.'
const WINDOW_LINE = 'The window is one to four seconds.'
/** Frame PUTs in flight at once. */
const PUT_BATCH = 4

const textareaClass =
  'min-h-[64px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50'
const mutedClass = 'text-[12px] text-[var(--color-text-muted)]'
const dangerClass = 'text-[13px] text-[var(--color-danger)]'

export type MarkerMode = { kind: 'add' } | { kind: 'remark'; reference: ReferenceView }

type FileKind = 'image' | 'video'

function kindOf(file: File): FileKind | null {
  if ((REFERENCE_IMAGE_MIMES as readonly string[]).includes(file.type)) return 'image'
  if ((REFERENCE_VIDEO_MIMES as readonly string[]).includes(file.type)) return 'video'
  return null
}

const seconds = (ms: number) => (ms / 1000).toFixed(1)

async function putBlob(url: string, blob: Blob, type: string): Promise<void> {
  const put = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': type } })
  if (!put.ok) throw new Error(`Storage refused the upload (${put.status}). Try again.`)
}

export function ReferenceMarker({
  channelId,
  mode,
  storageReady,
  readingEstimateUsd,
  onClose,
}: {
  channelId: string
  mode: MarkerMode
  storageReady: boolean
  readingEstimateUsd: number
  onClose: () => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const remark = mode.kind === 'remark' ? mode.reference : null
  const fileRef = React.useRef<HTMLInputElement>(null)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  const [file, setFile] = React.useState<File | null>(null)
  const [fileKind, setFileKind] = React.useState<FileKind | null>(remark ? 'video' : null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [clipUrl, setClipUrl] = React.useState<string | null>(remark?.clipUrl ?? null)
  const [meta, setMeta] = React.useState<{
    durationMs: number
    width: number
    height: number
  } | null>(
    remark
      ? { durationMs: remark.durationMs ?? 0, width: remark.width, height: remark.height }
      : null,
  )
  const [title, setTitle] = React.useState(remark?.title ?? '')
  const [sourceUrl, setSourceUrl] = React.useState(remark?.sourceUrl ?? '')
  const [rights, setRights] = React.useState(remark?.rights ?? 'Reference only')
  const [purpose, setPurpose] = React.useState<ReferencePurpose>(remark?.purpose ?? 'mechanism')
  const [negative, setNegative] = React.useState(remark?.negative ?? false)
  const [carryOver, setCarryOver] = React.useState(remark?.carryOver ?? '')
  const [avoid, setAvoid] = React.useState(remark?.avoid ?? '')
  const [startText, setStartText] = React.useState(seconds(remark?.windowStartMs ?? 0))
  const [endText, setEndText] = React.useState(seconds(remark?.windowEndMs ?? 2000))
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<string | null>(null)
  const [grabError, setGrabError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!file || remark) return
    const url = URL.createObjectURL(file)
    setClipUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file, remark])

  const choose = async (chosen: File | null) => {
    setFile(chosen)
    setFileError(null)
    setMeta(null)
    setGrabError(null)
    if (!chosen) {
      setFileKind(null)
      return
    }
    const kind = kindOf(chosen)
    setFileKind(kind)
    if (!kind) {
      setFileError('A reference is a PNG, JPEG or WebP still, or an MP4, WebM or MOV clip.')
      return
    }
    if (kind === 'image' && chosen.size > REFERENCE_IMAGE_MAX_BYTES) {
      setFileError('That still is over the 8 MB limit.')
      return
    }
    if (kind === 'video') {
      if (chosen.size > REFERENCE_VIDEO_MAX_BYTES) {
        setFileError('That clip is over the 100 MB limit.')
        return
      }
      try {
        const read = await readVideoMeta(chosen)
        if (read.durationMs > REFERENCE_CLIP_MAX_MS) {
          setFileError('That clip is over 90 seconds. Trim it first.')
          return
        }
        setMeta(read)
        setStartText('0.0')
        setEndText(seconds(Math.min(2000, read.durationMs)))
      } catch (error) {
        setFileError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const startMs = Math.round(Number(startText) * 1000)
  const endMs = Math.round(Number(endText) * 1000)
  const windowLength = endMs - startMs
  const windowValid =
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    startMs >= 0 &&
    windowLength >= REFERENCE_WINDOW_MIN_MS &&
    windowLength <= REFERENCE_WINDOW_MAX_MS &&
    (meta === null || endMs <= meta.durationMs)
  const isClip = fileKind === 'video'
  const sets = isClip && meta ? referenceFrameSets({ startMs, endMs }, meta.durationMs) : null
  const wordsValid = title.trim().length > 0 && carryOver.trim().length > 0
  const canSave =
    storageReady &&
    !busy &&
    wordsValid &&
    fileError === null &&
    (remark ? windowValid && meta !== null : file !== null && fileKind !== null) &&
    (!isClip || (windowValid && meta !== null))

  const words = (kind: FileKind) => ({
    kind,
    title: title.trim(),
    sourceUrl: sourceUrl.trim(),
    rights: rights.trim(),
    purpose,
    negative,
    carryOver: carryOver.trim(),
    avoid: avoid.trim(),
    windowStartMs: kind === 'video' ? startMs : null,
    windowEndMs: kind === 'video' ? endMs : null,
  })

  /** The dense and overview frames, taken in this browser and PUT one by one. */
  const takeAndUploadFrames = async (contentHash: string) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !meta || !sets) throw new Error('The clip is not ready to mark.')
    const grabber = browserGrabber(video, canvas)
    const total = sets.dense.length + sets.overview.length
    let taken = 0
    const report = () => setProgress(`Taking frames ${taken} of ${total}`)
    report()
    const dense = await grabFrames(
      grabber,
      sets.dense,
      fittedWidth(meta.width, meta.height, DENSE_FRAME_WIDTH),
      (done) => {
        taken = done
        report()
      },
    )
    const overview = await grabFrames(
      grabber,
      sets.overview,
      fittedWidth(meta.width, meta.height, OVERVIEW_FRAME_WIDTH),
      (done) => {
        taken = dense.length + done
        report()
      },
    )
    const created = await createReferenceFrameUploadsAction(channelId, {
      contentHash,
      dense: sets.dense,
      overview: sets.overview,
    })
    if (!created.ok || !created.uploads) {
      throw new Error(created.error ?? 'The frame uploads could not be prepared. Try again.')
    }
    const frames: { set: 'dense' | 'overview'; frame: GrabbedFrame }[] = [
      ...dense.map((frame) => ({ set: 'dense' as const, frame })),
      ...overview.map((frame) => ({ set: 'overview' as const, frame })),
    ]
    let uploaded = 0
    for (let at = 0; at < frames.length; at += PUT_BATCH) {
      await Promise.all(
        frames.slice(at, at + PUT_BATCH).map(async ({ set, frame }) => {
          const target = created.uploads!.find((u) => u.set === set && u.atMs === frame.atMs)
          if (!target) throw new Error('A frame has no upload URL. Try again.')
          await putBlob(target.url, frame.blob, 'image/jpeg')
          uploaded += 1
          setProgress(`Uploading frames ${uploaded} of ${frames.length}`)
        }),
      )
    }
    return frames.map(({ set, frame }) => ({
      set,
      atMs: frame.atMs,
      width: frame.width,
      height: frame.height,
    }))
  }

  const save = async (read: boolean) => {
    setBusy(true)
    setGrabError(null)
    try {
      if (remark) {
        const frames = await takeAndUploadFrames(remark.contentHash)
        const result = await remarkReferenceAction(channelId, {
          id: remark.id,
          windowStartMs: startMs,
          windowEndMs: endMs,
          frames,
          read,
        })
        if (!result.ok) {
          toast({ title: 'Could not save the window', description: result.error, variant: 'error' })
          return
        }
      } else {
        if (!file || !fileKind) return
        const ready =
          fileKind === 'image' ? await toUploadableImage(file) : { ok: true as const, file }
        if (!ready.ok) {
          toast({ title: 'Could not read the file', description: ready.error, variant: 'error' })
          return
        }
        const bytes = ready.file
        setProgress('Fingerprinting')
        const contentHash = await fingerprint(bytes)
        const created = await createReferenceUploadAction(channelId, {
          fileType: bytes.type,
          fileSize: bytes.size,
          contentHash,
          ...(meta ? { durationMs: meta.durationMs } : {}),
        })
        if (!created.ok || !created.url) {
          toast({
            title: 'Could not start the upload',
            description: created.error,
            variant: 'error',
          })
          return
        }
        setProgress('Uploading the file')
        await putBlob(created.url, bytes, bytes.type)
        const frames = fileKind === 'video' ? await takeAndUploadFrames(contentHash) : []
        const size = fileKind === 'image' ? await readImageSize(bytes) : meta!
        setProgress('Saving')
        const result = await finaliseReferenceAction(channelId, {
          contentHash,
          fileType: bytes.type,
          width: size.width,
          height: size.height,
          ...(meta ? { durationMs: meta.durationMs } : {}),
          frames,
          input: words(fileKind),
          read,
        })
        if (!result.ok) {
          toast({
            title: 'Could not save the reference',
            description: result.error,
            variant: 'error',
          })
          return
        }
      }
      toast({ title: read ? 'Reference saved and sent to be read' : 'Reference saved' })
      router.refresh()
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('Only ')) setGrabError(message)
      else toast({ title: 'Could not save the reference', description: message, variant: 'error' })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const setFromPlayhead = (which: 'start' | 'end') => {
    const at = videoRef.current?.currentTime ?? 0
    if (which === 'start') setStartText(at.toFixed(1))
    else setEndText(at.toFixed(1))
  }

  const fieldsLocked = busy
  const showClip = isClip && clipUrl !== null

  return (
    <Dialog label={remark ? 'Re-mark reference' : 'Add reference'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!storageReady ? (
          <p role="alert" className={dangerClass}>
            {STORAGE_LINE}
          </p>
        ) : null}

        {remark ? null : (
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              aria-label="Choose a reference file"
              onChange={(event) => void choose(event.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={fieldsLocked}
                onClick={() => fileRef.current?.click()}
              >
                {file ? `File: ${file.name}` : 'Choose file'}
              </Button>
              <span className={mutedClass}>
                A still up to 8 MB, or a clip up to 100 MB and 90 s.
              </span>
            </div>
            {fileError ? (
              <p role="alert" className={dangerClass}>
                {fileError}
              </p>
            ) : null}
          </div>
        )}

        {showClip ? (
          <div className="flex flex-col gap-2">
            <video
              ref={videoRef}
              src={clipUrl ?? undefined}
              controls
              muted
              playsInline
              preload="auto"
              className="w-full rounded-[8px] bg-black"
              aria-label="The clip"
            />
            <canvas ref={canvasRef} className="hidden" aria-hidden />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reference-window-start">Window start (s)</Label>
                <div className="flex gap-2">
                  <NumberInput
                    id="reference-window-start"
                    min={0}
                    step={0.1}
                    value={startText}
                    disabled={fieldsLocked}
                    onChange={(event) => setStartText(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={fieldsLocked}
                    onClick={() => setFromPlayhead('start')}
                  >
                    Set start here
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reference-window-end">Window end (s)</Label>
                <div className="flex gap-2">
                  <NumberInput
                    id="reference-window-end"
                    min={0}
                    step={0.1}
                    value={endText}
                    disabled={fieldsLocked}
                    onChange={(event) => setEndText(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={fieldsLocked}
                    onClick={() => setFromPlayhead('end')}
                  >
                    Set end here
                  </Button>
                </div>
              </div>
            </div>
            {windowValid && sets ? (
              <p className={mutedClass}>
                Window {seconds(windowLength)} s: {sets.dense.length} frames
              </p>
            ) : (
              <p role="alert" className={dangerClass}>
                {WINDOW_LINE}
              </p>
            )}
            {grabError ? (
              <p role="alert" className={dangerClass}>
                {grabError}
              </p>
            ) : null}
          </div>
        ) : null}

        {remark ? null : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reference-title">Title</Label>
              <Input
                id="reference-title"
                value={title}
                maxLength={120}
                disabled={fieldsLocked}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reference-purpose">Purpose</Label>
              <Select
                id="reference-purpose"
                value={purpose}
                disabled={fieldsLocked}
                onChange={(event) => setPurpose(event.target.value as ReferencePurpose)}
              >
                {REFERENCE_PURPOSES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reference-source">Source link and whose work it is</Label>
              <Input
                id="reference-source"
                value={sourceUrl}
                maxLength={500}
                disabled={fieldsLocked}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
              <p className={mutedClass}>Provenance only; nothing is fetched from it.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reference-rights">Rights</Label>
              <Input
                id="reference-rights"
                value={rights}
                maxLength={200}
                disabled={fieldsLocked}
                onChange={(event) => setRights(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="reference-carry-over">Carry over</Label>
              <textarea
                id="reference-carry-over"
                className={textareaClass}
                value={carryOver}
                maxLength={300}
                disabled={fieldsLocked}
                onChange={(event) => setCarryOver(event.target.value)}
              />
              <p className={mutedClass}>One line of the form &quot;borrow X, not Y&quot;.</p>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="reference-avoid">Avoid</Label>
              <textarea
                id="reference-avoid"
                className={textareaClass}
                value={avoid}
                maxLength={300}
                disabled={fieldsLocked}
                onChange={(event) => setAvoid(event.target.value)}
              />
              <p className={mutedClass}>Anything in the window that must not be copied.</p>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="reference-negative"
                checked={negative}
                disabled={fieldsLocked}
                onCheckedChange={setNegative}
              />
              <Label htmlFor="reference-negative">
                This is a negative: what the channel must not do
              </Label>
            </div>
          </div>
        )}

        {progress ? (
          <p role="status" className={mutedClass}>
            {progress}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!canSave} busy={busy} onClick={() => void save(true)}>
            Save and read
          </Button>
          <span className={mutedClass}>about ${readingEstimateUsd.toFixed(3)} for the reading</span>
          <Button variant="outline" disabled={!canSave} onClick={() => void save(false)}>
            Save without reading
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
