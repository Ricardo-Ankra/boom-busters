'use client'

import { Music, Trash2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { MUSIC_LICENCE_LABELS, MUSIC_LICENCES, MUSIC_MAX_BYTES } from '@boom-busters/schemas'
import type { MusicLicence } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { createMusicUploadAction, deleteMusicBedAction, finaliseMusicBedAction } from './actions'

/**
 * The music library (build spec section 10.1): user-populated only. The
 * human downloads licensed beds — the YouTube Audio Library has no API —
 * and uploads them here into R2. The licence dropdown is required because
 * the human who downloaded the track is the only one who knows what right
 * they have to use it; the app never guesses.
 */

export interface MusicBedView {
  id: string
  title: string
  licence: string
  moodTags: string[]
  createdAt: string
}

export function MusicTab({ beds }: { beds: MusicBedView[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const fileRef = React.useRef<HTMLInputElement | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [title, setTitle] = React.useState('')
  const [licence, setLicence] = React.useState<MusicLicence | ''>('')
  const [moodTags, setMoodTags] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)

  // Browser → R2 directly (decision 205): Vercel refuses request bodies over
  // about 4.5 MB at its edge, so the bytes can never travel through a server
  // action. The server issues a presigned PUT URL, the browser uploads to R2
  // itself, and the server then verifies the object and writes the row.
  const upload = async () => {
    if (!file || licence === '') return
    // Checked before the bytes travel: the server refuses the same size, but
    // only after the whole file has been uploaded for nothing.
    if (file.size > MUSIC_MAX_BYTES) {
      toast({
        title: 'That did not work',
        description: 'That file is over the 25 MB limit for music beds.',
        variant: 'error',
      })
      return
    }
    setBusy(true)
    try {
      // The same bytes that upload are the bytes that get fingerprinted —
      // the hash is the storage key, so identical tracks dedupe to one object.
      // The Uint8Array view matters: digest() rejects an ArrayBuffer from
      // another realm (jsdom in tests), and a fresh view is always local.
      const bytes = new Uint8Array(await file.arrayBuffer())
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const contentHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')

      const created = await createMusicUploadAction({
        fileType: file.type,
        fileSize: file.size,
        contentHash,
      })
      if (!created.ok || !created.url || !created.key) {
        toast({ title: 'That did not work', description: created.error, variant: 'error' })
        return
      }

      const put = await fetch(created.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!put.ok) {
        toast({
          title: 'That did not work',
          description: `Storage refused the upload (${put.status}). Try again.`,
          variant: 'error',
        })
        return
      }

      const result = await finaliseMusicBedAction({
        key: created.key,
        contentHash,
        title,
        licence,
        moodTags,
      })
      if (result.ok) {
        toast({ title: 'Track added to the library' })
        setFile(null)
        setTitle('')
        setLicence('')
        setMoodTags('')
        if (fileRef.current) fileRef.current.value = ''
        router.refresh()
      } else {
        toast({ title: 'That did not work', description: result.error, variant: 'error' })
      }
    } catch {
      // A rejected call anywhere in the chain previously surfaced as nothing
      // happening at all — the worst possible answer to a button press.
      toast({
        title: 'That did not work',
        description: 'The upload did not go through. Check the connection and try again.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      const result = await deleteMusicBedAction(id)
      if (result.ok) {
        toast({ title: 'Track removed' })
        router.refresh()
      } else {
        toast({ title: 'That did not work', description: result.error, variant: 'error' })
      }
      setConfirmDelete(null)
    } catch {
      toast({
        title: 'That did not work',
        description: 'The request never reached the server. Check the connection and try again.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const field =
    'rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a track</CardTitle>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Download licensed beds yourself — the YouTube Audio Library is the free source — then
            upload them here. The preview screen&apos;s music picker draws from this library. At
            least 3 beds before the pipeline can start a project.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
            className="hidden"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null
              setFile(chosen)
              if (chosen && title === '') setTitle(chosen.name.replace(/\.[^.]+$/, ''))
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden />
              {file ? `File: ${file.name}` : 'Choose audio file'}
            </Button>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              MP3, WAV, M4A or OGG · up to 25 MB
            </span>
          </div>

          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Title
            <input
              className={field}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Documentary tension 01"
            />
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Licence — required
            <select
              className={field}
              value={licence}
              onChange={(event) => setLicence(event.target.value as MusicLicence | '')}
            >
              <option value="">Choose where this track came from…</option>
              {MUSIC_LICENCES.map((value) => (
                <option key={value} value={value}>
                  {MUSIC_LICENCE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Mood tags — comma separated
            <input
              className={field}
              value={moodTags}
              onChange={(event) => setMoodTags(event.target.value)}
              placeholder="tension, investigative, slow build"
            />
          </label>

          <div>
            <Button
              variant="primary"
              busy={busy}
              disabled={!file || licence === ''}
              onClick={upload}
            >
              <Music aria-hidden />
              Add to library
            </Button>
            {!file || licence === '' ? (
              <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                {!file ? 'Choose a file first.' : 'The licence is required — it is your record.'}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Library — {beds.length} track{beds.length === 1 ? '' : 's'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {beds.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">
              No beds yet. The first-run checklist needs 3 before a project can start.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {beds.map((bed) => (
                <li
                  key={bed.id}
                  className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold">{bed.title}</p>
                      <p className="text-[12px] text-[var(--color-text-muted)]">
                        {MUSIC_LICENCE_LABELS[bed.licence as MusicLicence] ?? bed.licence}
                        {bed.moodTags.length > 0 ? ` · ${bed.moodTags.join(', ')}` : ''}
                      </p>
                    </div>
                    {confirmDelete === bed.id ? (
                      <div className="flex items-center gap-2">
                        <Button variant="danger" busy={busy} onClick={() => remove(bed.id)}>
                          Delete for good
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                          Keep it
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" onClick={() => setConfirmDelete(bed.id)}>
                        <Trash2 aria-hidden />
                        Delete
                      </Button>
                    )}
                  </div>
                  {/* Preview streams through the auth-checked asset route. */}
                  <audio
                    controls
                    preload="none"
                    src={`/api/assets/${bed.id}/file`}
                    className="w-full"
                    aria-label={`Preview: ${bed.title}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
