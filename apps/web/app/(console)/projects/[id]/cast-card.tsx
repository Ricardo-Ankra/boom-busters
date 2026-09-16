'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CAST_PHOTO_VIEWS, MAX_CAST_PHOTOS } from '@boom-busters/schemas'
import type { CastMember, CastPhotoView } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { ConfirmButton } from '@/components/confirm-button'
import {
  addCastMemberAction,
  addCastPhotoFromUrlAction,
  createCastPhotoUploadAction,
  describeCastMemberAction,
  finaliseCastPhotoAction,
  removeCastMemberAction,
  removeCastPhotoAction,
  updateCastMemberAction,
  type ActionResult,
} from './cast-actions'

/**
 * The Cast card (decision 253): the real people this film shows and the
 * producer's reference photographs of them. Lives on the project page from
 * the script stage onward, in every phase, because the faces are needed long
 * after the Direction card has left the screen.
 *
 * The people arrive by themselves: each draft of the Director's Book adds
 * every named principal with a role, identity string and guardrail
 * (decision 253 (j)). The card opens itself while anyone is still without a
 * photo, because the photo is the one thing only the producer can supply.
 *
 * Photos go browser → R2 on a presigned PUT, the board's "Upload own" shape:
 * hash the file, ask for a URL, PUT, read the dimensions, finalise. A photo
 * can also arrive by its web address, which the server fetches and stores by
 * the same route (decision 253 (k)). The server writes the identity string
 * from the first photo; the text areas hold raw text and save on the button,
 * never on a keystroke.
 */

const DESCRIBE_ESTIMATE = '≈$0.02'
const VIEW_LABELS: Record<CastPhotoView, string> = {
  front: 'Front',
  'three-quarter': 'Three-quarter',
  profile: 'Profile',
  full: 'Full length',
  other: 'Other',
}

export interface CastCardProps {
  projectId: string
  members: readonly CastMember[]
  /** Presigned GET per photo content hash; absent in mock storage. */
  photoUrls: Readonly<Record<string, string>>
}

export function CastCard({ projectId, members, photoUrls }: CastCardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(
    members.length === 0 || members.some((member) => member.photos.length === 0),
  )
  const unphotographed = members.filter((member) => member.photos.length === 0).length

  const act = React.useCallback(
    async (key: string, run: () => Promise<ActionResult>, success: string) => {
      setBusy(key)
      try {
        const result = await run()
        if (result.ok) {
          toast({ title: success })
          router.refresh()
        } else {
          toast({ title: 'That did not work', description: result.error, variant: 'error' })
        }
      } catch {
        toast({
          title: 'That did not work',
          description: 'The request never reached the server. Try again.',
          variant: 'error',
        })
      } finally {
        setBusy(null)
      }
    },
    [router, toast],
  )

  return (
    <Card aria-label="Cast">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Cast</CardTitle>
          <CardDescription>
            The real people this film shows. Everyone the Director&apos;s Book names is added here
            with a description when it is drafted; add anyone it missed, remove anyone it should not
            show. Upload one photo of each person: it goes to the image model as a reference so
            generated stills show this person, and is never placed in the video.
          </CardDescription>
          {unphotographed > 0 ? (
            <p className="mt-2 text-[12px] text-[var(--color-warning)]" role="status">
              {unphotographed === 1
                ? '1 person still needs a photo.'
                : `${unphotographed} people still need a photo.`}
            </p>
          ) : null}
        </div>
        {members.length > 0 ? (
          <Button variant="outline" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide cast' : 'Edit cast'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {!open ? (
          <ul aria-label="Cast members" className="flex flex-wrap gap-3">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-2">
                <Avatar member={member} photoUrls={photoUrls} />
                <span className="text-[13px]">
                  {member.name}
                  {member.photos.length === 0 ? (
                    <span className="text-[var(--color-text-muted)]"> · no photo yet</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                photoUrls={photoUrls}
                busy={busy}
                act={act}
              />
            ))}
            <AddPerson projectId={projectId} busy={busy} act={act} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Avatar({
  member,
  photoUrls,
}: {
  member: CastMember
  photoUrls: Readonly<Record<string, string>>
}) {
  const first = member.photos[0]
  const url = first ? photoUrls[first.contentHash] : undefined
  const initials = member.name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return url ? (
    <img
      src={url}
      alt={member.name}
      className="h-10 w-10 rounded-full object-cover"
      width={40}
      height={40}
    />
  ) : (
    <span
      aria-hidden
      className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-surface-2)] text-[12px]"
    >
      {initials}
    </span>
  )
}

type Act = (key: string, run: () => Promise<ActionResult>, success: string) => Promise<void>

function MemberRow({
  member,
  photoUrls,
  busy,
  act,
}: {
  member: CastMember
  photoUrls: Readonly<Record<string, string>>
  busy: string | null
  act: Act
}) {
  const [name, setName] = React.useState(member.name)
  const [role, setRole] = React.useState(member.role)
  const [identity, setIdentity] = React.useState(member.identityString)
  const [guardrail, setGuardrail] = React.useState(member.guardrail)
  const [view, setView] = React.useState<CastPhotoView>('front')
  const [photoUrl, setPhotoUrl] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const rowBusy = busy !== null && busy.startsWith(member.id)

  const upload = async (file: File): Promise<ActionResult> => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const contentHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const created = await createCastPhotoUploadAction({
      memberId: member.id,
      mimeType: file.type,
      fileSize: file.size,
      contentHash,
    })
    if (!created.ok || !created.url) return created

    const put = await fetch(created.url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })
    if (!put.ok) {
      return { ok: false, error: `Storage refused the upload (${put.status}). Try again.` }
    }

    const size = await readImageSize(file)
    return finaliseCastPhotoAction({
      memberId: member.id,
      mimeType: file.type,
      contentHash,
      width: size.width,
      height: size.height,
      view,
    })
  }

  return (
    <section
      aria-label={member.name}
      className="space-y-3 rounded-md border border-[var(--color-border)] p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`cast-${member.id}-name`}>Name</Label>
          <Input
            id={`cast-${member.id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`cast-${member.id}-role`}>Role</Label>
          <Input
            id={`cast-${member.id}-role`}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Reference photos
          {member.photos.length === 0 ? (
            <span className="text-[var(--color-warning)]">
              {' '}
              · none yet; stills of {member.name} are drawn from the description alone until one is
              uploaded
            </span>
          ) : null}
        </p>
        <ul aria-label={`${member.name} photos`} className="flex flex-wrap gap-3">
          {member.photos.map((photo) => {
            const url = photoUrls[photo.contentHash]
            return (
              <li key={photo.contentHash} className="w-28 space-y-1">
                {url ? (
                  <img
                    src={url}
                    alt={`${member.name}, ${VIEW_LABELS[photo.view].toLowerCase()} view`}
                    className="h-28 w-28 rounded-md object-cover"
                    width={112}
                    height={112}
                  />
                ) : (
                  <div className="grid h-28 w-28 place-items-center rounded-md bg-[var(--color-surface-2)] text-[12px]">
                    {VIEW_LABELS[photo.view]}
                  </div>
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {VIEW_LABELS[photo.view]}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={rowBusy}
                    aria-label={`Remove ${VIEW_LABELS[photo.view].toLowerCase()} photo of ${member.name}`}
                    onClick={() =>
                      act(
                        `${member.id}:photo`,
                        () =>
                          removeCastPhotoAction({
                            memberId: member.id,
                            contentHash: photo.contentHash,
                          }),
                        'Photo removed',
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            )
          })}
          {member.photos.length < MAX_CAST_PHOTOS ? (
            <li className="w-28 space-y-1">
              <Button
                variant="outline"
                className="h-28 w-28"
                disabled={rowBusy}
                onClick={() => inputRef.current?.click()}
              >
                Add photo
              </Button>
              <Select
                aria-label={`View of the next photo of ${member.name}`}
                value={view}
                onChange={(event) => setView(event.target.value as CastPhotoView)}
              >
                {CAST_PHOTO_VIEWS.map((option) => (
                  <option key={option} value={option}>
                    {VIEW_LABELS[option]}
                  </option>
                ))}
              </Select>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                aria-label={`Upload a photo of ${member.name}`}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void act(`${member.id}:upload`, () => upload(file), 'Photo added')
                }}
              />
            </li>
          ) : null}
        </ul>
        {member.photos.length < MAX_CAST_PHOTOS ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1 space-y-1">
              <Label htmlFor={`cast-${member.id}-url`}>Or paste an image address</Label>
              <Input
                id={`cast-${member.id}-url`}
                value={photoUrl}
                placeholder="https://example.com/photo.jpg"
                onChange={(event) => setPhotoUrl(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={rowBusy || photoUrl.trim() === ''}
              onClick={() =>
                void act(
                  `${member.id}:url`,
                  async () => {
                    const result = await addCastPhotoFromUrlAction({
                      memberId: member.id,
                      url: photoUrl,
                      view,
                    })
                    if (result.ok) setPhotoUrl('')
                    return result
                  },
                  'Photo added',
                )
              }
            >
              Add from address
            </Button>
          </div>
        ) : null}
        <p className="text-[12px] text-[var(--color-text-muted)]">
          One clear front view is enough. Two to four help: three-quarter, profile, full length.
          Even light, no sunglasses, the face at least 512 px wide, from the years the film covers.
          An address must point at the image file itself, the one from &quot;Copy image
          address&quot;, not the page it sits on.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`cast-${member.id}-identity`}>Identity string</Label>
        <textarea
          id={`cast-${member.id}-identity`}
          rows={3}
          value={identity}
          onChange={(event) => setIdentity(event.target.value)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[13px]"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`cast-${member.id}-guardrail`}>Guardrail</Label>
        <textarea
          id={`cast-${member.id}-guardrail`}
          rows={2}
          value={guardrail}
          onChange={(event) => setGuardrail(event.target.value)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[13px]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={rowBusy}
          onClick={() =>
            act(
              `${member.id}:save`,
              () =>
                updateCastMemberAction(member.id, {
                  name,
                  role,
                  identityString: identity,
                  guardrail,
                }),
              `${name.trim() || member.name} saved`,
            )
          }
        >
          Save
        </Button>
        <Button
          variant="outline"
          disabled={rowBusy || member.photos.length === 0}
          onClick={() =>
            act(
              `${member.id}:describe`,
              () => describeCastMemberAction(member.id),
              'Description written from the photos',
            )
          }
        >
          Describe from photos · {DESCRIBE_ESTIMATE}
        </Button>
        <ConfirmButton
          variant="outline"
          busy={rowBusy}
          label="Remove person"
          confirmLabel={`Remove ${member.name}`}
          consequence="Their photos are deleted and a redraft of the Director's Book will not add them back. Stills already generated are kept."
          onConfirm={() =>
            act(`${member.id}:remove`, () => removeCastMemberAction(member.id), 'Person removed')
          }
        />
      </div>
    </section>
  )
}

function AddPerson({ projectId, busy, act }: { projectId: string; busy: string | null; act: Act }) {
  const [name, setName] = React.useState('')
  const [role, setRole] = React.useState('')
  return (
    <form
      aria-label="Add a person"
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        void act(
          'add',
          async () => {
            const result = await addCastMemberAction(projectId, { name, role })
            if (result.ok) {
              setName('')
              setRole('')
            }
            return result
          },
          `${name.trim()} added to the cast`,
        )
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="cast-new-name">Full name</Label>
        <Input
          id="cast-new-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Emad Mostaque"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cast-new-role">Role</Label>
        <Input
          id="cast-new-role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          placeholder="Founder and former CEO, Stability AI"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={busy !== null || !name.trim() || !role.trim()}
      >
        Add person
      </Button>
    </form>
  )
}

/**
 * Dimensions read in the browser with createImageBitmap; zero where the
 * environment cannot decode images (jsdom in tests), and the server rounds
 * zero up to one. No object URLs and no Image element: in jsdom those never
 * fire load or error, and the upload sat waiting on them.
 */
async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== 'function') return { width: 0, height: 0 }
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return { width: 0, height: 0 }
  }
}
