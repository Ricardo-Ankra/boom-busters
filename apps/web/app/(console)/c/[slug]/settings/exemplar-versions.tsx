'use client'

import { CRITIC_AXES } from '@boom-busters/schemas'
import type { BrandKitStored, CriticSteerCheck, TechniqueKey } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import type { ChannelExemplarVersionView } from '@/lib/exemplar-channel-views'
import { GraphicPlayback } from '../../../projects/[id]/graphic-playback'
import {
  approveExemplarVersionAction,
  keepApprovedAction,
  restoreExemplarVersionAction,
} from './exemplar-actions'

/**
 * The side by side after a refine and the Versions list (spec 2026-11-04,
 * section 9.3): the new draft beside the version it was refined from, the
 * players, the concept lines, the critic's one line per axis, and the
 * three buttons; and every version with Restore on a retired one.
 */

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * The critic's check of each part of the steer (decision 455): how many
 * parts landed, then "Done: the part. what the pictures showed" per part.
 */
function SteerCheck({ check }: { check: readonly CriticSteerCheck[] }) {
  const done = check.filter((part) => part.state === 'done').length
  return (
    <>
      <li>
        The steer, checked: {done} of {check.length} parts done
      </li>
      {check.map((part, index) => (
        <li key={index}>
          {capitalised(part.state)}: {part.part}. {part.line}
        </li>
      ))}
    </>
  )
}

/** "Engagement 8: the line", one per axis, then the steer's parts checked; nothing before a critic ran. */
export function CriticLines({ version }: { version: ChannelExemplarVersionView }) {
  if (!version.scores) {
    return <p className="text-[12px] text-[var(--color-text-muted)]">No critic report yet.</p>
  }
  const scores = version.scores
  return (
    <ul className="flex list-none flex-col gap-1 pl-0 text-[12px] text-[var(--color-text-secondary)]">
      {CRITIC_AXES.map((axis) => (
        <li key={axis}>
          {capitalised(axis)} {scores[axis].score}: {scores[axis].line}
        </li>
      ))}
      {version.steerCheck && version.steerCheck.length > 0 ? (
        <SteerCheck check={version.steerCheck} />
      ) : null}
    </ul>
  )
}

function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function SideBySide({
  channelId,
  technique,
  draft,
  against,
  brand,
  disabled,
  onRefineAgain,
}: {
  channelId: string
  technique: TechniqueKey
  draft: ChannelExemplarVersionView
  /** The version the draft was refined from, or the approved one. */
  against: ChannelExemplarVersionView
  brand: BrandKitStored
  disabled: boolean
  onRefineAgain: () => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState(false)

  const decide = async (
    run: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    failed: string,
  ) => {
    setBusy(true)
    try {
      const result = await run()
      if (!result.ok) {
        toast({ title: failed, description: result.error, variant: 'error' })
        return
      }
      toast({ title: done })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const column = (heading: string, version: ChannelExemplarVersionView) => (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <h4 className="text-[13px] font-medium">{heading}</h4>
      <GraphicPlayback
        slotId={`exemplar-${technique}-${version.id}`}
        code={version.code}
        {...(version.data ? { data: version.data } : {})}
        noun="example"
        brand={brand}
        logoUrls={{}}
        durationMs={version.code.durationMs}
      />
      <p className="text-[13px]">{version.concept}</p>
      <CriticLines version={version} />
    </div>
  )

  return (
    <section
      aria-label="The refined version beside the approved one"
      className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-3"
    >
      {draft.steer ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">Steer: {draft.steer}</p>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row">
        {column('New', draft)}
        {column('Approved', against)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={disabled || busy}
          onClick={() =>
            decide(
              () => approveExemplarVersionAction(channelId, draft.id),
              `Approved v${draft.version}`,
              'Could not approve the version',
            )
          }
        >
          Approve this
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy}
          onClick={() =>
            decide(
              () => keepApprovedAction(channelId, draft.id),
              'Kept the approved one',
              'Could not set the draft aside',
            )
          }
        >
          Keep the approved one
        </Button>
        <Button type="button" variant="ghost" disabled={disabled || busy} onClick={onRefineAgain}>
          Refine again
        </Button>
      </div>
    </section>
  )
}

export function VersionsList({
  channelId,
  versions,
  disabled,
}: {
  channelId: string
  versions: readonly ChannelExemplarVersionView[]
  disabled: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState<string | null>(null)

  const restore = async (version: ChannelExemplarVersionView) => {
    setBusy(version.id)
    try {
      const result = await restoreExemplarVersionAction(channelId, version.id)
      if (!result.ok) {
        toast({
          title: 'Could not restore the version',
          description: result.error,
          variant: 'error',
        })
        return
      }
      toast({ title: `Approved v${version.version}` })
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <ul className="flex list-none flex-col gap-2 pl-0 text-[13px]">
      {versions.map((version) => (
        <li
          key={version.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] border border-[var(--color-border)] p-2"
        >
          <span className="font-medium">
            v{version.version}, {version.status}
          </span>
          <span className="text-[var(--color-text-muted)]">{dayOf(version.createdAt)}</span>
          {version.steer ? (
            <span className="text-[var(--color-text-secondary)]">Steer: {version.steer}</span>
          ) : null}
          {version.copiedFrom ? (
            <span className="text-[var(--color-text-muted)]">copied</span>
          ) : null}
          {version.status === 'retired' ? (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || busy !== null}
              onClick={() => restore(version)}
            >
              Restore
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
