'use client'

import { X } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

/**
 * The app's one modal (spec section 11.1 rules still apply inside it: every
 * action a visible labelled button, 40px hit targets).
 *
 * Deliberately small: a fixed overlay, Escape and backdrop-click to close, a
 * labelled close button, and focus moved into the panel on open. It exists
 * for the dossier's inline claims (decision 196) — a claim's actions open
 * over the document instead of living in a permanent second pane.
 */
export function Dialog({
  label,
  onClose,
  children,
  className,
}: {
  label: string
  onClose: () => void
  children: React.ReactNode
  className?: string
}) {
  const panel = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    panel.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* A real button, so closing by tapping outside is reachable however
          you interact — but aria-hidden, because "Close" (below) is the
          accessible name for the same act and two identical entries in the
          accessibility tree is one too many. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'relative max-h-[85vh] w-full max-w-xl overflow-auto rounded-[8px] border',
          'border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-xl',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-3">
          <h2 className="text-[14px] font-semibold">{label}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <X aria-hidden className="size-4" />
            Close
          </Button>
        </div>
        <div className="p-3">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
