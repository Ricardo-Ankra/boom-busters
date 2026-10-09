'use client'

import type { Notice } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { dismissNoticeAction } from '@/app/(console)/notice-actions'
import { Button } from '@/components/ui/button'

/**
 * The notices on one card (decision 293): what an answer's repair trimmed or
 * dropped, or why a task stopped, each with its own Dismiss button. Styled as
 * the slot card's re-type box, so every card says these things the same way.
 * With nothing to say it renders nothing and calls no hook, so a card test
 * with no notices needs no router.
 */
export function Notices({ notices }: { notices: readonly Notice[] }) {
  return notices.length === 0 ? null : <NoticeList notices={notices} />
}

function NoticeList({ notices }: { notices: readonly Notice[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; error: string } | null>(null)

  async function dismiss(id: string) {
    setPending(id)
    setFailed(null)
    const result = await dismissNoticeAction(id)
    setPending(null)
    if (result.ok) router.refresh()
    else setFailed({ id, error: result.error })
  }

  return (
    <div className="flex flex-col gap-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-warning)] p-2"
        >
          <p role="status" className="min-w-0 flex-1 text-[13px] text-[var(--color-warning)]">
            {notice.message}
          </p>
          <Button
            variant="outline"
            busy={pending === notice.id}
            disabled={pending !== null}
            onClick={() => void dismiss(notice.id)}
          >
            Dismiss
          </Button>
          {failed?.id === notice.id ? (
            <p role="alert" className="w-full text-[13px] text-[var(--color-danger)]">
              Could not dismiss: {failed.error}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}
