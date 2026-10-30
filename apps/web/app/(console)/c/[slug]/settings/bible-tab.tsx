'use client'

import { BIBLE_SECTION_ORDER, bibleSaveBlockers, jobIsRunning } from '@boom-busters/schemas'
import type { BibleDraft, BibleSection, ChannelBible } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/confirm-button'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { errorSection, flagSection } from '@/lib/bible-draft-keys'
import type { ActionResult } from './actions'
import {
  approveBibleSectionAction,
  discardBibleDraftAction,
  draftBibleAction,
  editBibleSectionAction,
  saveBibleAction,
} from './bible-actions'
import { BibleHistory } from './bible-history'
import { BiblePreview } from './bible-preview'
import { BibleSectionCard } from './bible-section-card'
import { DraftWithAi } from './draft-with-ai'

export interface BibleVersionView {
  id: string
  version: number
  note: string
  createdAt: string
}

/** The Bible tab polls the draft this often while a run works on it. */
const POLL_MS = 3000

type Reply = ActionResult & { draft?: BibleDraft; blockers?: string[] }

/**
 * The Bible tab: the seven sections of the channel's bible, each with its
 * status, and the way to edit, approve and save them as a new version. With
 * no draft the tab shows the current version with every section approved; the
 * first change opens the draft.
 */
export function BibleTab({
  channel,
  draft: initialDraft,
  currentVersion,
  versions,
  vidiqReady,
  archived,
}: {
  channel: { id: string; name: string; handle: string | null }
  /** The working draft, or null when there is none. */
  draft: BibleDraft | null
  /** The saved bible the channel runs on. */
  currentVersion: { id: string; version: number; bible: ChannelBible }
  /** Every saved version (the history lists them). */
  versions: BibleVersionView[]
  /** A VidIQ key is on file (or mocks stand in for it): the research can be offered. */
  vidiqReady: boolean
  archived: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [draft, setDraft] = React.useState(initialDraft)
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [retryToken, setRetryToken] = React.useState(0)

  // The server's draft wins whenever the page refreshes.
  React.useEffect(() => setDraft(initialDraft), [initialDraft])

  const running = draft?.job ? jobIsRunning(draft.job) : false
  React.useEffect(() => {
    if (!running) return
    const timer = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [running, router])

  const bible = draft?.bible ?? currentVersion.bible
  const blockers = draft ? bibleSaveBlockers(draft) : []
  const locked = archived || running || busy

  /** Runs an action, shows its refusal, takes the draft it returns and refreshes the page. */
  const act = async (run: () => Promise<Reply>, failure: string): Promise<boolean> => {
    setBusy(true)
    try {
      const result = await run()
      if (!result.ok) {
        toast({ title: failure, description: result.error, variant: 'error' })
        return false
      }
      if (result.draft) setDraft(result.draft)
      router.refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  const redraft = (sections: BibleSection[], steer?: string) =>
    act(
      () => draftBibleAction(channel.id, steer ? { sections, steer } : { sections }),
      'Could not start the draft',
    )

  const tryAgain = () => {
    const failed = new Set<BibleSection>()
    for (const key of Object.keys(draft?.errors ?? {})) {
      const section = errorSection(key)
      if (section) failed.add(section)
    }
    return redraft(
      failed.size > 0 ? BIBLE_SECTION_ORDER.filter((s) => failed.has(s)) : [...BIBLE_SECTION_ORDER],
    )
  }

  const save = async () => {
    setBusy(true)
    try {
      const result = await saveBibleAction(channel.id, note)
      if (!result.ok) {
        toast({
          title: 'Could not save',
          description: result.blockers?.join('. ') ?? result.error,
          variant: 'error',
        })
        return
      }
      toast({ title: 'Saved as a new version' })
      setDraft(null)
      setNote('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const job = draft?.job ?? null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        Version {currentVersion.version} is what the channel runs on. Changes collect in a draft
        until you save them as a new version.
      </p>

      <BibleHistory
        channelId={channel.id}
        versions={versions}
        disabled={archived || draft !== null}
      />

      <DraftWithAi
        channelId={channel.id}
        channelName={channel.name}
        channelHandle={channel.handle}
        savedInputs={draft?.inputs ?? null}
        vidiqReady={vidiqReady}
        disabled={locked}
        retryToken={retryToken}
        onDraft={setDraft}
      />

      {running && job ? (
        <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">
          {job.kind === 'research'
            ? 'Researching'
            : job.current
              ? `Drafting ${job.current}`
              : 'Drafting'}
        </p>
      ) : null}

      {job && job.state === 'failed' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-[var(--color-danger)]">{job.error ?? 'The run failed'}</span>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => (job.kind === 'draft' ? void tryAgain() : setRetryToken((n) => n + 1))}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {BIBLE_SECTION_ORDER.map((section) => (
        <BibleSectionCard
          key={section}
          section={section}
          bible={bible}
          status={draft?.statuses[section] ?? 'approved'}
          flags={Object.fromEntries(
            Object.entries(draft?.tooClose ?? {}).filter(([path]) => flagSection(path) === section),
          )}
          errors={Object.entries(draft?.errors ?? {})
            .filter(([key]) => errorSection(key) === section)
            .map(([, message]) => message)}
          disabled={locked}
          onEdit={(target, patch) =>
            act(
              () => editBibleSectionAction(channel.id, target, patch),
              'Could not save the section',
            )
          }
          onApprove={(target) =>
            void act(() => approveBibleSectionAction(channel.id, target), 'Could not approve')
          }
          onRedraft={(target, steer) => void redraft([target], steer)}
          onDraftSlot={(slotId) =>
            void act(() => draftBibleAction(channel.id, { slotId }), 'Could not start the draft')
          }
        />
      ))}

      <BiblePreview channelId={channel.id} bible={bible} />

      {draft ? (
        <div className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-4">
          {blockers.length > 0 ? (
            <ul className="list-disc pl-5 text-[13px] text-[var(--color-warning)]">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bible-note">Version note</Label>
            <Input
              id="bible-note"
              value={note}
              maxLength={300}
              disabled={locked}
              placeholder="Edited in the Bible tab"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={locked || blockers.length > 0}
              onClick={() => void save()}
            >
              Save
            </Button>
            <ConfirmButton
              label="Discard draft"
              confirmLabel="Discard draft"
              consequence="The draft is thrown away. The saved version is not touched."
              disabled={locked}
              onConfirm={async () => {
                const result = await discardBibleDraftAction(channel.id)
                if (!result.ok) {
                  toast({ title: 'Could not discard', description: result.error, variant: 'error' })
                  return
                }
                setDraft(null)
                router.refresh()
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
