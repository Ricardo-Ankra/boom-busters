'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MAX_SET_PLATES, SET_PLATE_VIEWS } from '@boom-busters/schemas'
import type { ProjectSet, SetPlateView, SlotCandidate } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { ConfirmButton } from '@/components/confirm-button'
import {
  addSetAction,
  addSetPlateFromUrlAction,
  chooseSetPlateAction,
  createSetPlateUploadAction,
  finaliseSetPlateAction,
  generateSetPlateAction,
  removeSetAction,
  removeSetPlateAction,
  updateSetAction,
  type ActionResult,
} from './set-actions'

/**
 * The Set card (decision 264): the rooms this film returns to, and the
 * producer's reference plates of them. `cast-card.tsx` with different nouns:
 * a room needs the same treatment a face does, so the same room reads as the
 * same room across every still that shows it.
 *
 * Sets arrive by themselves: each draft of the Director's Book adds every
 * named location with a look line (decision 264, mirroring decision 253
 * (j)). The card opens itself while any set is still without a plate,
 * because the plate is the one thing only the producer can supply, or the
 * one plate the producer can ask the model to invent from the look alone.
 *
 * Plates go browser -> R2 on a presigned PUT, the same "Upload own" shape as
 * the cast's photos, and can also arrive by web address or by generation:
 * `generateSetPlateAction` returns candidates from the look alone and stores
 * nothing until `chooseSetPlateAction` picks one.
 */

const VIEW_LABELS: Record<SetPlateView, string> = {
  establishing: 'Establishing',
  detail: 'Detail',
  other: 'Other',
}

export interface SetCardProps {
  projectId: string
  sets: readonly ProjectSet[]
  /** Presigned GET per plate content hash; absent in mock storage. */
  plateUrls: Readonly<Record<string, string>>
  /** What Generate a plate will spend on the routed stills model, in USD. */
  plateEstimateUsd: number
}

/** `run` results a wider shape than `ActionResult` can carry, such as the candidates a generate call returns. */
type ActResult = ActionResult & { candidates?: SlotCandidate[] }
type Act = (
  key: string,
  run: () => Promise<ActResult>,
  success: string,
  onOk?: (result: ActResult) => void,
) => Promise<void>

export function SetCard({ projectId, sets, plateUrls, plateEstimateUsd }: SetCardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(
    sets.length === 0 || sets.some((set) => set.plates.length === 0),
  )
  const unplated = sets.filter((set) => set.plates.length === 0).length

  const act: Act = React.useCallback(
    async (key, run, success, onOk) => {
      setBusy(key)
      try {
        const result = await run()
        if (result.ok) {
          toast({ title: success })
          onOk?.(result)
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
    <Card aria-label="Sets">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Sets</CardTitle>
          <CardDescription>
            The rooms this film returns to. Every location the Director&apos;s Book names is added
            here with a look line when it is drafted; add any it missed, remove any it should not
            show. Reference plates keep the same room the same room across every generated still of
            it.
          </CardDescription>
          {unplated > 0 ? (
            <p className="mt-2 text-[12px] text-[var(--color-warning)]" role="status">
              {unplated === 1
                ? '1 set still needs a plate.'
                : `${unplated} sets still need a plate.`}
            </p>
          ) : null}
        </div>
        {sets.length > 0 ? (
          <Button variant="outline" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide sets' : 'Edit sets'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {!open ? (
          <ul aria-label="Set list" className="flex flex-wrap gap-3">
            {sets.map((set) => (
              <li key={set.id} className="flex items-center gap-2">
                <SetThumbnail set={set} plateUrls={plateUrls} />
                <span className="text-[13px]">
                  {set.name}
                  {set.plates.length === 0 ? (
                    <span className="text-[var(--color-text-muted)]"> · no plate yet</span>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">
                      {' '}
                      · {set.plates.length} {set.plates.length === 1 ? 'plate' : 'plates'}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {sets.map((set) => (
              <SetRow
                key={set.id}
                set={set}
                plateUrls={plateUrls}
                plateEstimateUsd={plateEstimateUsd}
                busy={busy}
                act={act}
              />
            ))}
            <AddSet projectId={projectId} busy={busy} act={act} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SetThumbnail({
  set,
  plateUrls,
}: {
  set: ProjectSet
  plateUrls: Readonly<Record<string, string>>
}) {
  const first = set.plates[0]
  const url = first ? plateUrls[first.contentHash] : undefined
  const initials = set.name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return url ? (
    <img
      src={url}
      alt={set.name}
      className="h-10 w-10 rounded-md object-cover"
      width={40}
      height={40}
    />
  ) : (
    <span
      aria-hidden
      className="grid h-10 w-10 place-items-center rounded-md bg-[var(--color-surface-2)] text-[12px]"
    >
      {initials}
    </span>
  )
}

function SetRow({
  set,
  plateUrls,
  plateEstimateUsd,
  busy,
  act,
}: {
  set: ProjectSet
  plateUrls: Readonly<Record<string, string>>
  plateEstimateUsd: number
  busy: string | null
  act: Act
}) {
  const [name, setName] = React.useState(set.name)
  const [look, setLook] = React.useState(set.look)
  const [view, setView] = React.useState<SetPlateView>('establishing')
  const [plateUrl, setPlateUrl] = React.useState('')
  const [candidates, setCandidates] = React.useState<SlotCandidate[] | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const rowBusy = busy !== null && busy.startsWith(set.id)
  /** Whether another plate would fit: the one condition every way in shares. */
  const room = set.plates.length < MAX_SET_PLATES

  const upload = async (file: File): Promise<ActionResult> => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const contentHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const created = await createSetPlateUploadAction({
      setId: set.id,
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
    return finaliseSetPlateAction({
      setId: set.id,
      mimeType: file.type,
      contentHash,
      width: size.width,
      height: size.height,
      view,
    })
  }

  return (
    <section
      aria-label={set.name}
      className="space-y-3 rounded-md border border-[var(--color-border)] p-3"
    >
      <div className="space-y-1">
        <Label htmlFor={`set-${set.id}-name`}>Name</Label>
        <Input
          id={`set-${set.id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`set-${set.id}-look`}>Look</Label>
        <textarea
          id={`set-${set.id}-look`}
          rows={3}
          value={look}
          onChange={(event) => setLook(event.target.value)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[13px]"
        />
      </div>

      <div className="space-y-2">
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Reference plates
          {set.plates.length === 0 ? (
            <span className="text-[var(--color-warning)]">
              {' '}
              · none yet; stills of {set.name} are drawn from the look alone until one is added
            </span>
          ) : null}
        </p>
        <ul aria-label={`${set.name} plates`} className="flex flex-wrap gap-3">
          {set.plates.map((plate) => {
            const url = plateUrls[plate.contentHash]
            return (
              <li key={plate.contentHash} className="w-28 space-y-1">
                {url ? (
                  <img
                    src={url}
                    alt={`${set.name}, ${VIEW_LABELS[plate.view].toLowerCase()} view`}
                    className="h-28 w-28 rounded-md object-cover"
                    width={112}
                    height={112}
                  />
                ) : (
                  <div className="grid h-28 w-28 place-items-center rounded-md bg-[var(--color-surface-2)] text-[12px]">
                    {VIEW_LABELS[plate.view]}
                  </div>
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {VIEW_LABELS[plate.view]}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={rowBusy}
                    aria-label={`Remove ${VIEW_LABELS[plate.view].toLowerCase()} plate of ${set.name}`}
                    onClick={() =>
                      act(
                        `${set.id}:plate`,
                        () =>
                          removeSetPlateAction({ setId: set.id, contentHash: plate.contentHash }),
                        'Plate removed',
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            )
          })}
          {room ? (
            <li className="w-28 space-y-1">
              <Button
                variant="outline"
                className="h-28 w-28"
                disabled={rowBusy}
                onClick={() => inputRef.current?.click()}
              >
                Add plate
              </Button>
              <Select
                aria-label={`View of the next plate of ${set.name}`}
                value={view}
                onChange={(event) => setView(event.target.value as SetPlateView)}
              >
                {SET_PLATE_VIEWS.map((option) => (
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
                aria-label={`Upload a plate of ${set.name}`}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void act(`${set.id}:upload`, () => upload(file), 'Plate added')
                }}
              />
            </li>
          ) : null}
        </ul>
        {room ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1 space-y-1">
              <Label htmlFor={`set-${set.id}-url`}>Or paste an image address</Label>
              <Input
                id={`set-${set.id}-url`}
                value={plateUrl}
                placeholder="https://example.com/room.jpg"
                onChange={(event) => setPlateUrl(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={rowBusy || plateUrl.trim() === ''}
              onClick={() =>
                void act(
                  `${set.id}:url`,
                  async () => {
                    const result = await addSetPlateFromUrlAction({
                      setId: set.id,
                      url: plateUrl,
                      view,
                    })
                    if (result.ok) setPlateUrl('')
                    return result
                  },
                  'Plate added',
                )
              }
            >
              Add from address
            </Button>
          </div>
        ) : null}
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Up to two plates travel with every still shot in this room.
        </p>
      </div>

      {candidates !== null && room ? (
        <ul aria-label={`${set.name} candidate plates`} className="flex flex-wrap gap-3">
          {candidates.map((candidate, index) => (
            <li key={candidate.id} className="w-28">
              <Button
                variant="outline"
                className="h-28 w-28 p-0"
                disabled={rowBusy}
                aria-label={`Choose plate ${index + 1}`}
                onClick={() =>
                  act(
                    `${set.id}:choose`,
                    () =>
                      chooseSetPlateAction({
                        setId: set.id,
                        r2Key: candidate.r2Key ?? null,
                        sourceUrl: candidate.sourceUrl,
                        width: candidate.width ?? 0,
                        height: candidate.height ?? 0,
                      }),
                    'Plate added',
                    () => setCandidates(null),
                  )
                }
              >
                <img
                  src={candidate.thumbUrl}
                  alt=""
                  className="h-full w-full rounded-md object-cover"
                />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={rowBusy}
          onClick={() => {
            const patch: { name?: string; look?: string } = {}
            if (name !== set.name) patch.name = name
            if (look !== set.look) patch.look = look
            void act(
              `${set.id}:save`,
              () => updateSetAction(set.id, patch),
              `${name.trim() || set.name} saved`,
            )
          }}
        >
          Save
        </Button>
        {room ? (
          <Button
            variant="outline"
            disabled={rowBusy}
            onClick={() =>
              act(
                `${set.id}:generate`,
                () => generateSetPlateAction(set.id),
                'Candidates ready',
                (result) => setCandidates(result.candidates ?? []),
              )
            }
          >
            Generate a plate · ≈${plateEstimateUsd.toFixed(2)}
          </Button>
        ) : null}
        <ConfirmButton
          variant="outline"
          busy={rowBusy}
          label="Remove set"
          confirmLabel={`Remove ${set.name}`}
          consequence="Its plates are deleted and a redraft of the Director's Book will not add it back. Stills already generated are kept."
          onConfirm={() => act(`${set.id}:remove`, () => removeSetAction(set.id), 'Set removed')}
        />
      </div>
    </section>
  )
}

function AddSet({ projectId, busy, act }: { projectId: string; busy: string | null; act: Act }) {
  const [name, setName] = React.useState('')
  const [look, setLook] = React.useState('')
  return (
    <form
      aria-label="Add a set"
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        void act(
          'add',
          async () => {
            const result = await addSetAction(projectId, { name, look })
            if (result.ok) {
              setName('')
              setLook('')
            }
            return result
          },
          `${name.trim()} added to the sets`,
        )
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="set-new-name">Name</Label>
        <Input
          id="set-new-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="The trading floor"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="set-new-look">Look</Label>
        <Input
          id="set-new-look"
          value={look}
          onChange={(event) => setLook(event.target.value)}
          placeholder="Glass walls, dual monitors, city view at dusk"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={busy !== null || !name.trim() || !look.trim()}
      >
        Add set
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
