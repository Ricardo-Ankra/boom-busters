'use client'

import * as React from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'

/**
 * The inline two-step for destructive and spending actions (build spec
 * section 11.1): "button -> confirm with cost/consequence — never a browser
 * confirm, modals only for genuinely modal work".
 *
 * The confirm replaces the button in place and states the consequence, so the
 * second click is an informed one rather than a reflex on a dialog.
 *
 * Keyboard and screen reader (decision 248): arming used to unmount the
 * focused button, dropping focus to the document body, so a keyboard user
 * pressing Enter on Stop was left nowhere and heard nothing. Focus now moves
 * to the confirm button, which is described by the consequence sentence, and
 * Cancel puts it back on the trigger. The consequence is primary text: it is
 * the most important sentence on the screen at that moment, not a caption.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  consequence,
  onConfirm,
  variant = 'outline',
  confirmVariant = 'danger',
  busy: busyOutside = false,
  ...props
}: Omit<ButtonProps, 'onClick' | 'children'> & {
  label: React.ReactNode
  confirmLabel: React.ReactNode
  /** What clicking through will actually do. Shown beside the confirm. */
  consequence: string
  /** Any return value is ignored; awaited so the button stays busy until done. */
  onConfirm: () => unknown | Promise<unknown>
  confirmVariant?: ButtonProps['variant']
  /**
   * Busy from outside the two-step, merged with the internal await. The
   * internal state ends when `onConfirm` resolves; a caller whose refresh is
   * still landing passes its own flag so the control never reads idle while
   * the screen it acts on is mid-change (decision 240).
   */
  busy?: boolean
}) {
  const [armed, setArmed] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const busy = confirming || busyOutside
  const consequenceId = React.useId()
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const confirmRef = React.useRef<HTMLButtonElement>(null)
  // Only a keyboard or click that armed the control should move focus; the
  // initial render and a disarm-after-confirm must not steal it.
  const [focusTarget, setFocusTarget] = React.useState<'confirm' | 'trigger' | null>(null)

  React.useEffect(() => {
    if (focusTarget === 'confirm') confirmRef.current?.focus()
    if (focusTarget === 'trigger') triggerRef.current?.focus()
    if (focusTarget) setFocusTarget(null)
  }, [focusTarget, armed])

  if (!armed) {
    return (
      <Button
        ref={triggerRef}
        variant={variant}
        busy={busyOutside}
        onClick={() => {
          setArmed(true)
          setFocusTarget('confirm')
        }}
        {...props}
      >
        {label}
      </Button>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span id={consequenceId} className="text-[14px] text-[var(--color-text-primary)]">
        {consequence}
      </span>
      <Button
        ref={confirmRef}
        variant={confirmVariant}
        busy={busy}
        aria-describedby={consequenceId}
        onClick={async () => {
          setConfirming(true)
          try {
            await onConfirm()
          } finally {
            setConfirming(false)
            setArmed(false)
          }
        }}
        {...props}
      >
        {confirmLabel}
      </Button>
      {/* "Cancel", like every other way out in the app — the escape used to
          say "Keep going", the one place backing out had its own vocabulary. */}
      <Button
        variant="ghost"
        onClick={() => {
          setArmed(false)
          setFocusTarget('trigger')
        }}
        disabled={busy}
      >
        Cancel
      </Button>
    </span>
  )
}
