'use client'

import type { ActivityEntry } from '@boom-busters/db'
import * as Dialog from '@radix-ui/react-dialog'
import { Activity, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ActivityList } from '@/components/activity-list'
import { Button } from '@/components/ui/button'

/**
 * The run/activity feed (build spec section 11.2), opened by a labelled button
 * in the top bar.
 *
 * The feed comes from `run_events`, mirrored out of Inngest by middleware
 * (section 12), so opening this never depends on the Inngest dashboard being
 * reachable — or on having a second login to it.
 *
 * Refreshing is a button rather than a poll. A background poll on every
 * console page would query Postgres forever for a drawer that is usually shut;
 * the top bar's active-run count is the ambient signal, and this is the
 * deliberate look.
 */
export function ActivityDrawer({ entries }: { entries: ActivityEntry[] }) {
  const router = useRouter()
  const [refreshing, setRefreshing] = React.useState(false)

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
          className="fixed top-0 right-0 z-50 flex h-full w-[min(460px,100vw)] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]"
          aria-describedby="activity-drawer-description"
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4">
            <Dialog.Title className="text-[14px] font-semibold">Activity</Dialog.Title>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                busy={refreshing}
                onClick={() => {
                  setRefreshing(true)
                  router.refresh()
                  // The refresh is a server round trip with no completion
                  // callback; this just keeps the spinner honest for a beat.
                  window.setTimeout(() => setRefreshing(false), 600)
                }}
              >
                <span>Refresh</span>
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon">
                  <X aria-hidden />
                  <span>Close</span>
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <p id="activity-drawer-description" className="sr-only">
            Pipeline steps, retries, model fallbacks and spend, newest first.
          </p>

          <div className="flex-1 overflow-y-auto p-3">
            <ActivityList
              entries={entries}
              showProject
              emptyMessage="No pipeline runs yet. Steps, retries, model fallbacks and spend appear here once a project starts running."
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
