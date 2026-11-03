'use client'

import {
  BIBLE_SECTION_ORDER,
  EXAMPLE_SLOT_IDS,
  bibleSaveBlockers,
  isBibleComplete,
  jobIsRunning,
  liveFlags,
} from '@boom-busters/schemas'
import type { BibleDraft, BibleSection, ChannelBible } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { errorSection, flagSection } from '@/lib/bible-draft-keys'
import type { ActionResult } from './actions'
import {
  approveBibleSectionAction,
  discardBibleDraftAction,
  draftBibleAction,
  editBibleSectionAction,
  measureKeywordsAction,
  saveBibleAction,
} from './bible-actions'
import { BibleHistory } from './bible-history'
import type { KeywordReadings } from './bible-measurements'
import { BiblePreview } from './bible-preview'
import { BibleSaveBar } from './bible-save-bar'
import { BibleSectionCard } from './bible-section-card'
import { BibleToolbar, type BiblePanel } from './bible-toolbar'
import { CopyFromChannel, type CopySource } from './copy-from-channel'
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
  copySources = [],
  readings,
  measureCount = 0,
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
  /** Every other channel the bible can be copied from, archived ones included. */
  copySources?: CopySource[]
  /** The latest VidIQ reading of each format and pillar keyword, by lower-cased keyword. */
  readings?: KeywordReadings
  /** How many format and pillar keywords have no reading from the last 30 days. */
  measureCount?: number
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [draft, setDraft] = React.useState(initialDraft)
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [retryToken, setRetryToken] = React.useState(0)
  const [panel, setPanel] = React.useState<BiblePanel>(null)
  const [editProblems, setEditProblems] = React.useState<Partial<Record<BibleSection, string[]>>>(
    {},
  )
  const setProblems = React.useCallback((section: BibleSection, problems: string[]) => {
    setEditProblems((current) => {
      const had = current[section] ?? []
      if (had.length === problems.length && had.every((p, i) => p === problems[i])) return current
      return { ...current, [section]: problems }
    })
  }, [])

  // The server's draft wins whenever the page refreshes.
  React.useEffect(() => setDraft(initialDraft), [initialDraft])

  const running = draft?.job ? jobIsRunning(draft.job) : false
  React.useEffect(() => {
    if (!running) return
    const timer = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [running, router])

  const bible = draft?.bible ?? currentVersion.bible
  // What the open section forms say is wrong with them also stops Save.
  const formProblems = Object.values(editProblems).flat()
  const blockers = draft ? [...bibleSaveBlockers(draft), ...formProblems] : []
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

  const measureKeywords = async () => {
    setBusy(true)
    try {
      const result = await measureKeywordsAction(channel.id)
      if (!result.ok) {
        toast({ title: 'Could not measure', description: result.error, variant: 'error' })
        return
      }
      toast({
        title: 'Measuring in VidIQ',
        description: `About ${result.credits} credits. The readings appear here as they arrive; refresh the page to see them.`,
      })
    } finally {
      setBusy(false)
    }
  }

  const redraft = (sections: BibleSection[], steer?: string) =>
    act(
      () => draftBibleAction(channel.id, steer ? { sections, steer } : { sections }),
      'Could not start the draft',
    )

  /**
   * What Try again resends for a draft job: exactly the units it was started
   * with, and its steer. A job from before units were stored falls back to the
   * sections its errors name; with neither there is nothing to resend.
   */
  const retryRequest = (): {
    request: { sections: BibleSection[] } | { slotId: string }
    steer?: string
  } | null => {
    const job = draft?.job
    if (!job || job.kind !== 'draft') return null
    const steer = job.steer
    if (job.units && job.units.length > 0) {
      const only = job.units.length === 1 ? job.units[0] : undefined
      if (only && 'slotId' in only && EXAMPLE_SLOT_IDS.includes(only.slotId))
        return { request: { slotId: only.slotId }, ...(steer ? { steer } : {}) }
      const sections = new Set(job.units.map((unit) => unit.section))
      return {
        request: { sections: BIBLE_SECTION_ORDER.filter((s) => sections.has(s)) },
        ...(steer ? { steer } : {}),
      }
    }
    const failed = new Set<BibleSection>()
    for (const key of Object.keys(draft?.errors ?? {})) {
      const section = errorSection(key)
      if (section) failed.add(section)
    }
    if (failed.size === 0) return null
    return {
      request: { sections: BIBLE_SECTION_ORDER.filter((s) => failed.has(s)) },
      ...(steer ? { steer } : {}),
    }
  }

  const tryAgain = () => {
    const retry = retryRequest()
    if (!retry) return Promise.resolve(false)
    return act(
      () =>
        draftBibleAction(channel.id, {
          ...retry.request,
          ...(retry.steer ? { steer: retry.steer } : {}),
        }),
      'Could not start the draft',
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
  // A job still marked running that nothing has touched for thirty minutes: its run is gone.
  const stale = job !== null && job.state === 'running' && !running
  const canRetry = job !== null && (job.kind === 'research' || retryRequest() !== null)
  // An unfinished bible with nothing drafted yet: say where to start. The block
  // gives way to the panel its buttons open, and the row takes the buttons over.
  const unfinished =
    draft === null && !archived && !isBibleComplete(currentVersion.bible, EXAMPLE_SLOT_IDS)
  const startVisible = unfinished && panel !== 'draft' && panel !== 'copy'

  return (
    <div className="flex flex-col gap-3">
      <h2 className="sr-only">Channel bible</h2>
      <BibleToolbar
        version={currentVersion.version}
        panel={panel}
        onPanel={setPanel}
        showDrafting={!startVisible}
        historyDisabled={archived || draft !== null}
        draftingDisabled={locked}
        canCopy={!archived}
      />

      <BibleHistory
        channelId={channel.id}
        versions={versions}
        disabled={archived || draft !== null}
        open={panel === 'history'}
      />

      <DraftWithAi
        channelId={channel.id}
        channelName={channel.name}
        channelHandle={channel.handle}
        savedInputs={draft?.inputs ?? null}
        vidiqReady={vidiqReady}
        disabled={locked}
        retryToken={retryToken}
        open={panel === 'draft'}
        onOpenChange={(open) => setPanel(open ? 'draft' : null)}
        onDraft={setDraft}
      />

      {archived ? null : (
        <CopyFromChannel
          channelId={channel.id}
          sources={copySources}
          draft={draft}
          currentBible={currentVersion.bible}
          disabled={locked}
          open={panel === 'copy'}
          onOpenChange={(open) => setPanel(open ? 'copy' : null)}
          onCopied={(next, copiedNote) => {
            setDraft(next)
            setNote(copiedNote)
            router.refresh()
          }}
        />
      )}

      {startVisible ? (
        <div className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-4">
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Start here</h3>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            This channel&apos;s bible is not finished, so new projects cannot start yet. Draft it
            with AI from a short description, or copy another channel&apos;s and change what
            differs.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={locked} onClick={() => setPanel('draft')}>
              Draft with AI
            </Button>
            <Button variant="outline" disabled={locked} onClick={() => setPanel('copy')}>
              Copy from another channel
            </Button>
          </div>
        </div>
      ) : null}

      {running && job ? (
        <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">
          {job.kind === 'research'
            ? 'Researching'
            : job.current
              ? `Drafting ${job.current}`
              : 'Drafting'}
        </p>
      ) : null}

      {job && (job.state === 'failed' || stale) ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-[var(--color-danger)]">
            {stale ? 'The run stopped answering' : (job.error ?? 'The run failed')}
          </span>
          {canRetry ? (
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => (job.kind === 'draft' ? void tryAgain() : setRetryToken((n) => n + 1))}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      {BIBLE_SECTION_ORDER.map((section) => (
        <BibleSectionCard
          key={section}
          section={section}
          bible={bible}
          status={draft?.statuses[section] ?? 'approved'}
          flags={Object.fromEntries(
            Object.entries(liveFlags(draft?.tooClose ?? {})).filter(
              ([path]) => flagSection(path) === section,
            ),
          )}
          errors={Object.entries(draft?.errors ?? {})
            .filter(([key]) => errorSection(key) === section)
            .map(([, message]) => message)}
          disabled={locked}
          onProblems={setProblems}
          {...(readings ? { readings } : {})}
          {...(section === 'formats' || section === 'identity'
            ? {
                measure: {
                  count: measureCount,
                  ready: vidiqReady,
                  onMeasure: () => void measureKeywords(),
                },
              }
            : {})}
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
        <BibleSaveBar
          nextVersion={currentVersion.version + 1}
          blockers={blockers}
          note={note}
          onNote={setNote}
          disabled={locked}
          onSave={() => void save()}
          onDiscard={async () => {
            const result = await discardBibleDraftAction(channel.id)
            if (!result.ok) {
              toast({ title: 'Could not discard', description: result.error, variant: 'error' })
              return
            }
            setDraft(null)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
