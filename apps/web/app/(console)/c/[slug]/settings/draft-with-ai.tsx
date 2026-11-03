'use client'

import type { BibleDraft, BibleDraftInputs } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import type { ActionResult } from './actions'
import {
  draftBibleAction,
  estimateBibleResearchAction,
  startBibleResearchAction,
} from './bible-actions'

const MAX_CHANNELS = 5
const MAX_VIDEOS = 10

const TEXTAREA_CLASS =
  'min-h-20 w-full rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] ' +
  'px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
  'disabled:opacity-50'

/** One entry per line; blank lines are ignored. */
function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Whether inputs would pass the server's schema limits. */
function inputsAreValid(inputs: BibleDraftInputs): boolean {
  return (
    inputs.description.trim().length > 0 &&
    inputs.admiredChannels.length <= MAX_CHANNELS &&
    inputs.videos.length <= MAX_VIDEOS
  )
}

type Confirm =
  | { state: 'checking' }
  | { state: 'ready'; estimate: number; balance: number; inputs: BibleDraftInputs }
  | { state: 'error'; message: string }

type Reply = ActionResult & { draft?: BibleDraft }

/**
 * The owner's input card: describe the channel, then research with VidIQ
 * (the credits shown first) and draft, or draft without VidIQ.
 */
export function DraftWithAi({
  channelId,
  channelName,
  channelHandle,
  savedInputs,
  vidiqReady,
  disabled,
  retryToken,
  open,
  onOpenChange,
  onDraft,
}: {
  channelId: string
  channelName: string
  channelHandle: string | null
  /** The inputs the draft was last started with. */
  savedInputs: BibleDraftInputs | null
  vidiqReady: boolean
  /** A run works on the draft, the channel is archived or an action is in flight. */
  disabled: boolean
  /** Raised by the tab's "Try again" on a failed research: reopens the confirm. */
  retryToken: number
  /** The tab shows this card while it is open. */
  open: boolean
  onOpenChange: (open: boolean) => void
  onDraft: (draft: BibleDraft) => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState(false)
  const [confirm, setConfirm] = React.useState<Confirm | null>(null)
  const [description, setDescription] = React.useState(
    savedInputs?.description ?? (channelHandle ? `${channelName} (${channelHandle})` : channelName),
  )
  const [audience, setAudience] = React.useState(savedInputs?.audience ?? '')
  const [admired, setAdmired] = React.useState((savedInputs?.admiredChannels ?? []).join('\n'))
  const [videos, setVideos] = React.useState((savedInputs?.videos ?? []).join('\n'))
  const [avoid, setAvoid] = React.useState(savedInputs?.avoid ?? '')

  const channels = linesOf(admired)
  const videoLines = linesOf(videos)
  const channelsError = channels.length > MAX_CHANNELS ? `Up to ${MAX_CHANNELS} channels` : null
  const videosError = videoLines.length > MAX_VIDEOS ? `Up to ${MAX_VIDEOS} videos` : null
  const invalid = Boolean(channelsError || videosError) || description.trim().length === 0
  const locked = disabled || busy
  // The fields hold still while a confirm shows, so Start sends what was estimated.
  const fieldsLocked = locked || confirm?.state === 'checking' || confirm?.state === 'ready'
  const estimateRun = React.useRef(0)

  const inputs = (): BibleDraftInputs => ({
    description: description.trim(),
    audience: audience.trim(),
    admiredChannels: channels,
    videos: videoLines,
    avoid: avoid.trim(),
  })

  const estimate = async (forInputs: BibleDraftInputs) => {
    const run = ++estimateRun.current
    setConfirm({ state: 'checking' })
    let next: Confirm
    try {
      const result = await estimateBibleResearchAction(channelId, forInputs)
      next = result.ok
        ? { state: 'ready', estimate: result.estimate, balance: result.balance, inputs: forInputs }
        : { state: 'error', message: result.error }
    } catch {
      next = { state: 'error', message: 'Could not check the VidIQ credits' }
    }
    // A Cancel (or a newer estimate) since this one began wins.
    if (run === estimateRun.current) setConfirm(next)
  }

  const cancelConfirm = () => {
    estimateRun.current++
    setConfirm(null)
  }

  // "Try again" on a failed research reopens the confirm with the saved inputs.
  const lastToken = React.useRef(retryToken)
  React.useEffect(() => {
    if (retryToken === lastToken.current) return
    lastToken.current = retryToken
    onOpenChange(true)
    if (!savedInputs) return
    setDescription(savedInputs.description)
    setAudience(savedInputs.audience)
    setAdmired(savedInputs.admiredChannels.join('\n'))
    setVideos(savedInputs.videos.join('\n'))
    setAvoid(savedInputs.avoid)
    void estimate(savedInputs)
    // Runs only when the token changes; the rest is read as it stands then.
  }, [retryToken])

  const run = async (start: () => Promise<Reply>, failure: string) => {
    setBusy(true)
    try {
      const result = await start()
      if (!result.ok) {
        toast({ title: failure, description: result.error, variant: 'error' })
        return
      }
      if (result.draft) onDraft(result.draft)
      setConfirm(null)
      onOpenChange(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-description">Describe the channel in a few lines</Label>
        <textarea
          id="draft-description"
          className={TEXTAREA_CLASS}
          value={description}
          maxLength={1000}
          disabled={fieldsLocked}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-audience">Who is it for?</Label>
        <textarea
          id="draft-audience"
          className={TEXTAREA_CLASS}
          value={audience}
          maxLength={600}
          disabled={fieldsLocked}
          onChange={(event) => setAudience(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-admired">Channels you admire</Label>
        <textarea
          id="draft-admired"
          aria-describedby="draft-admired-hint draft-admired-error"
          className={TEXTAREA_CLASS}
          value={admired}
          disabled={fieldsLocked}
          onChange={(event) => setAdmired(event.target.value)}
        />
        <p id="draft-admired-hint" className="text-[12px] text-[var(--color-text-muted)]">
          One per line, up to 5.
        </p>
        {channelsError ? (
          <p
            id="draft-admired-error"
            role="alert"
            className="text-[13px] text-[var(--color-danger)]"
          >
            {channelsError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-videos">Videos that feel right</Label>
        <textarea
          id="draft-videos"
          aria-describedby="draft-videos-hint draft-videos-error"
          className={TEXTAREA_CLASS}
          value={videos}
          disabled={fieldsLocked}
          onChange={(event) => setVideos(event.target.value)}
        />
        <p id="draft-videos-hint" className="text-[12px] text-[var(--color-text-muted)]">
          One per line, up to 10.
        </p>
        {videosError ? (
          <p
            id="draft-videos-error"
            role="alert"
            className="text-[13px] text-[var(--color-danger)]"
          >
            {videosError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-avoid">Anything you don&apos;t want</Label>
        <textarea
          id="draft-avoid"
          className={TEXTAREA_CLASS}
          value={avoid}
          maxLength={600}
          disabled={fieldsLocked}
          onChange={(event) => setAvoid(event.target.value)}
        />
      </div>

      {confirm ? (
        <div className="flex flex-col gap-2 text-[13px]">
          {confirm.state === 'checking' ? (
            <p role="status" className="text-[var(--color-text-secondary)]">
              Checking the VidIQ credits
            </p>
          ) : null}
          {confirm.state === 'error' ? (
            <p role="alert" className="text-[var(--color-danger)]">
              {confirm.message}
            </p>
          ) : null}
          {confirm.state === 'ready' ? (
            <p>
              About {confirm.estimate.toLocaleString('en-GB')} VidIQ credits. Balance:{' '}
              {confirm.balance.toLocaleString('en-GB')}.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {confirm.state === 'ready' ? (
              <Button
                variant="primary"
                disabled={locked || !inputsAreValid(confirm.inputs)}
                busy={busy}
                onClick={() =>
                  void run(
                    () => startBibleResearchAction(channelId, confirm.inputs),
                    'Could not start the research',
                  )
                }
              >
                Start
              </Button>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={cancelConfirm}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={locked || invalid || !vidiqReady}
            onClick={() => void estimate(inputs())}
          >
            Research with VidIQ, then draft
          </Button>
          <Button
            variant="outline"
            disabled={locked || invalid}
            onClick={() =>
              void run(
                () => draftBibleAction(channelId, { inputs: inputs() }),
                'Could not start the draft',
              )
            }
          >
            Draft without VidIQ
          </Button>
          <Button variant="ghost" disabled={locked} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!vidiqReady ? (
            <span className="text-[12px] text-[var(--color-text-muted)]">
              Add a VidIQ key in Settings, Connections
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}
