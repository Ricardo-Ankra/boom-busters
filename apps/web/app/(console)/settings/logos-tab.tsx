'use client'

import { ImagePlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { LOGO_ACCEPT, LOGO_MAX_BYTES } from '@boom-busters/schemas'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { readImageSize, toUploadableLogo } from '@/lib/client-image'
import {
  addLogoFromUrlAction,
  createLogoUploadAction,
  finaliseLogoAction,
  removeLogoAction,
  renameLogoAction,
  setChannelMarkAction,
} from './logo-actions'

/**
 * The logo library (decision 268): real marks the owner uploaded, one per
 * company or person, named as the dossier names them. A graphic slot's
 * "logo" element is matched to this list by that name (Plan B), and the
 * channel mark is what the film's corner watermark draws.
 *
 * Marks go browser to R2 on the presigned path (decision 205). SVG and AVIF
 * are drawn to PNG in the browser before the hash, so what is stored is
 * always a raster mark with its transparency kept.
 */

export interface LogoView {
  id: string
  title: string
  r2Key: string
  width: number | null
  height: number | null
  /** Presigned GET, or null in mock storage. */
  url: string | null
}

/** "wirecard-ag.jpg" reads "Wirecard Ag": a starting point, not the answer. */
function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function fingerprint(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function LogosTab({
  logos,
  channelMarkKey,
}: {
  logos: LogoView[]
  channelMarkKey: string | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const fileRef = React.useRef<HTMLInputElement | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [title, setTitle] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const failed = (description?: string) =>
    toast({ title: 'That did not work', description, variant: 'error' })

  const run = async (work: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(true)
    try {
      const result = await work()
      if (result.ok) {
        toast({ title: success })
        router.refresh()
      } else {
        failed(result.error)
      }
      return result.ok
    } catch {
      failed('The request never reached the server. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const upload = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!file) return { ok: false, error: 'Choose a file first.' }
    const ready = await toUploadableLogo(file)
    if (!ready.ok) return ready
    const mark = ready.file
    if (mark.size > LOGO_MAX_BYTES) return { ok: false, error: 'That mark is over the 4 MB limit.' }

    const contentHash = await fingerprint(mark)
    const created = await createLogoUploadAction({
      fileType: mark.type,
      fileSize: mark.size,
      contentHash,
    })
    if (!created.ok || !created.url || !created.key) return created
    const put = await fetch(created.url, {
      method: 'PUT',
      body: mark,
      headers: { 'Content-Type': mark.type },
    })
    if (!put.ok)
      return { ok: false, error: `Storage refused the upload (${put.status}). Try again.` }

    const size = await readImageSize(mark)
    const result = await finaliseLogoAction({
      key: created.key,
      contentHash,
      title,
      width: size.width,
      height: size.height,
    })
    if (result.ok) {
      setFile(null)
      setTitle('')
      if (fileRef.current) fileRef.current.value = ''
    }
    return result
  }

  const named = title.trim() !== ''

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a mark</CardTitle>
          <CardDescription>
            Real logos are uploaded, never generated. Name each mark exactly as the dossier names
            the company or person: that name is how a graphic finds it. PNG with a transparent
            background is best; SVG and AVIF are converted to PNG on the way in. Up to 4 MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept={LOGO_ACCEPT}
            className="hidden"
            aria-label="Choose a logo file"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null
              setFile(chosen)
              if (chosen && title === '') setTitle(nameFromFile(chosen.name))
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden />
              {file ? `File: ${file.name}` : 'Choose logo file'}
            </Button>
            {file && (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) ? (
              <span className="text-[12px] text-[var(--color-warning)]" role="status">
                A JPEG has no transparency; the mark will sit in a rectangle.
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="logo-title">Name</Label>
            <Input
              id="logo-title"
              value={title}
              placeholder="Stability AI"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy || !file || !named}
              onClick={() => void run(upload, 'Mark added to the library')}
            >
              Add to library
            </Button>
            {!file ? (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                Choose a file first.
              </span>
            ) : !named ? (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                A name is required.
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1 space-y-1">
              <Label htmlFor="logo-address">Or paste an image address</Label>
              <Input
                id="logo-address"
                value={address}
                placeholder="https://example.com/mark.svg"
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={busy || address.trim() === '' || !named}
              onClick={() =>
                void run(async () => {
                  const result = await addLogoFromUrlAction({ url: address, title })
                  if (result.ok) {
                    setAddress('')
                    setTitle('')
                  }
                  return result
                }, 'Mark added to the library')
              }
            >
              Add from address
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Marks</CardTitle>
            <CardDescription>
              The channel mark is drawn in the corner of every film. Without one, the corner carries
              the Boom &amp; Busters wordmark.
            </CardDescription>
          </div>
          {channelMarkKey !== null ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(() => setChannelMarkAction(null), 'The corner carries the wordmark')
              }
            >
              Use no mark
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {logos.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">No marks yet.</p>
          ) : (
            <ul aria-label="Logo library" className="grid gap-3 sm:grid-cols-2">
              {logos.map((logo) => (
                <LogoRow
                  key={logo.id}
                  logo={logo}
                  isChannelMark={logo.r2Key === channelMarkKey}
                  busy={busy}
                  run={run}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LogoRow({
  logo,
  isChannelMark,
  busy,
  run,
}: {
  logo: LogoView
  isChannelMark: boolean
  busy: boolean
  run: (work: () => Promise<{ ok: boolean; error?: string }>, success: string) => Promise<boolean>
}) {
  const [name, setName] = React.useState(logo.title)
  const inputId = `logo-name-${logo.id}`

  return (
    <li
      aria-label={logo.title}
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3"
    >
      <div
        className="grid h-28 place-items-center rounded-[8px]"
        style={{ backgroundColor: 'var(--color-background)' }}
      >
        {logo.url ? (
          <img src={logo.url} alt={logo.title} className="max-h-24 max-w-[90%] object-contain" />
        ) : (
          <span className="text-[12px] text-[var(--color-text-muted)]">
            No preview in mock storage
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{logo.title}</span>
        {isChannelMark ? (
          <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px]">
            Channel mark
          </span>
        ) : (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() => setChannelMarkAction(logo.id), `${logo.title} is the channel mark`)
            }
          >
            Use {logo.title} as channel mark
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1 space-y-1">
          <Label htmlFor={inputId} className="sr-only">
            Rename {logo.title}
          </Label>
          <Input id={inputId} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <Button
          variant="outline"
          disabled={busy || name.trim() === '' || name.trim() === logo.title}
          onClick={() =>
            void run(() => renameLogoAction({ id: logo.id, title: name }), 'Mark renamed')
          }
        >
          Save name
        </Button>
        <ConfirmButton
          variant="ghost"
          label="Remove"
          confirmLabel="Remove mark"
          consequence={`${logo.title} leaves the library; graphics that use it will ask for it again.`}
          disabled={busy}
          onConfirm={() => run(() => removeLogoAction(logo.id), 'Mark removed')}
        />
      </div>
    </li>
  )
}
