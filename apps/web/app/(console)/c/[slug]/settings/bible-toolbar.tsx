'use client'

import { Button } from '@/components/ui/button'

/** The tool panel the Bible tab shows under its header row, if any. */
export type BiblePanel = 'history' | 'copy' | 'draft' | null

/**
 * The Bible tab's header row: which version the channel runs on, then the
 * tools. Pressing the button of the open panel closes it, so only one panel
 * shows at a time.
 */
export function BibleToolbar({
  version,
  panel,
  onPanel,
  showDrafting,
  historyDisabled,
  draftingDisabled,
  canCopy,
}: {
  version: number
  panel: BiblePanel
  onPanel: (panel: BiblePanel) => void
  /** Copy and Draft with AI are shown here (the start block shows them otherwise). */
  showDrafting: boolean
  historyDisabled: boolean
  draftingDisabled: boolean
  /** The channel is not archived. */
  canCopy: boolean
}) {
  const toggle = (target: Exclude<BiblePanel, null>) => onPanel(panel === target ? null : target)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 flex-1 basis-60 text-[13px] text-[var(--color-text-secondary)]">
        Version {version} is what the channel runs on. Changes collect in a draft until you save
        them as a new version.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-expanded={panel === 'history'}
          disabled={historyDisabled}
          onClick={() => toggle('history')}
        >
          History
        </Button>
        {showDrafting && canCopy ? (
          <Button
            variant="outline"
            aria-expanded={panel === 'copy'}
            disabled={draftingDisabled}
            onClick={() => toggle('copy')}
          >
            Copy from another channel
          </Button>
        ) : null}
        {showDrafting ? (
          <Button
            variant="primary"
            aria-expanded={panel === 'draft'}
            disabled={draftingDisabled}
            onClick={() => toggle('draft')}
          >
            Draft with AI
          </Button>
        ) : null}
      </div>
    </div>
  )
}
