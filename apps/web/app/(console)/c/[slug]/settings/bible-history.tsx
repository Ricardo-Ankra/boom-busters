'use client'

import type { ChannelBible } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { restoreBibleVersionAction, viewBibleVersionAction } from './bible-actions'

export interface BibleHistoryVersion {
  id: string
  version: number
  note: string
  createdAt: string
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "30 Oct 2026, 14:05". */
export function versionDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso))
}

/** A bible field as text for the read-only view. */
function fieldText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/**
 * The History button: every saved version of the bible, newest first. View
 * opens one read-only; Restore appends it as the channel's next version.
 */
export function BibleHistory({
  channelId,
  versions,
  disabled,
  open,
}: {
  channelId: string
  /** Every saved version, in any order. */
  versions: BibleHistoryVersion[]
  disabled: boolean
  /** The tab shows the list while it is open. */
  open: boolean
}) {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [viewing, setViewing] = React.useState<{
    version: number
    bible: ChannelBible
  } | null>(null)
  const closeView = React.useCallback(() => setViewing(null), [])

  const newestFirst = [...versions].sort((a, b) => b.version - a.version)

  const view = async (version: BibleHistoryVersion) => {
    setError(null)
    const result = await viewBibleVersionAction(channelId, version.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setViewing({ version: version.version, bible: result.bible })
  }

  const restore = async (version: BibleHistoryVersion) => {
    setError(null)
    const result = await restoreBibleVersionAction(channelId, version.id)
    if (!result.ok) {
      setError(result.error ?? 'Could not restore')
      return
    }
    router.refresh()
  }

  if (!open) return null

  return (
    <div className="flex flex-col gap-3">
      {open ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-4">
          {error ? (
            <p role="alert" className="text-[13px] text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {newestFirst.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-3 text-[13px]"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium text-[var(--color-text-primary)]">
                    Version {version.version}
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    {versionDate(version.createdAt)}
                  </span>
                  <span className="text-[var(--color-text-secondary)]">{version.note}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    aria-label={`View version ${version.version}`}
                    onClick={() => void view(version)}
                  >
                    View
                  </Button>
                  <ConfirmButton
                    label="Restore"
                    confirmLabel="Restore"
                    consequence={`Version ${version.version} is saved again as the channel's next version.`}
                    confirmVariant="primary"
                    aria-label={`Restore version ${version.version}`}
                    disabled={disabled}
                    onConfirm={() => restore(version)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {viewing ? (
        <Dialog label={`Version ${viewing.version}`} onClose={closeView} className="max-w-3xl">
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-[13px]">
            {Object.entries(viewing.bible).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="font-mono text-[12px] text-[var(--color-text-muted)]">{key}</span>
                <pre className="font-sans whitespace-pre-wrap text-[var(--color-text-primary)]">
                  {fieldText(value)}
                </pre>
              </div>
            ))}
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}
