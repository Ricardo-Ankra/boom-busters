'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Activity, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The run/activity feed for the current project (build spec section 11.2),
 * opened by a labelled button in the top bar.
 *
 * M2 fills this from `run_events`, which the Inngest middleware mirrors into
 * Postgres so the drawer never depends on the Inngest dashboard (section 12).
 * Until then it states plainly that there is nothing to show and why.
 */
export function ActivityDrawer() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon">
          <Activity aria-hidden />
          <span>Activity</span>
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed top-0 right-0 z-50 flex h-full w-[min(420px,100vw)] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]"
          aria-describedby="activity-drawer-description"
        >
          <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
            <Dialog.Title className="text-[14px] font-semibold">Activity</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon">
                <X aria-hidden />
                <span>Close</span>
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p
              id="activity-drawer-description"
              className="text-[14px] text-[var(--color-text-secondary)]"
            >
              No pipeline runs yet.
            </p>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              Steps, retries, model fallbacks and spend appear here once a project starts running.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
