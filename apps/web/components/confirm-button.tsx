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
 */
export function ConfirmButton({
  label,
  confirmLabel,
  consequence,
  onConfirm,
  variant = 'outline',
  confirmVariant = 'danger',
  ...props
}: Omit<ButtonProps, 'onClick' | 'children'> & {
  label: React.ReactNode
  confirmLabel: React.ReactNode
  /** What clicking through will actually do. Shown beside the confirm. */
  consequence: string
  /** Any return value is ignored; awaited so the button stays busy until done. */
  onConfirm: () => unknown | Promise<unknown>
  confirmVariant?: ButtonProps['variant']
}) {
  const [armed, setArmed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  if (!armed) {
    return (
      <Button variant={variant} onClick={() => setArmed(true)} {...props}>
        {label}
      </Button>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-[var(--color-text-secondary)]">{consequence}</span>
      <Button
        variant={confirmVariant}
        busy={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onConfirm()
          } finally {
            setBusy(false)
            setArmed(false)
          }
        }}
        {...props}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)} disabled={busy}>
        Keep going
      </Button>
    </span>
  )
}
