import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Button-first interaction (build spec section 11.1): every action is a
 * clearly labelled, always-visible button. Two rules are encoded here rather
 * than left to each caller:
 *
 * - Hit targets are >= 40px in every size variant.
 * - The busy state replaces the label with a spinner **in place**, so the
 *   button never moves or resizes under the cursor mid-review.
 */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[8px] font-medium whitespace-nowrap ' +
    'transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** The one visually dominant action per screen — the gate action. */
        primary:
          'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] hover:bg-[var(--color-accent-hover)]',
        /** Secondary actions sit beside the primary as outlined buttons. */
        outline:
          'border border-[var(--color-border-strong)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]',
        ghost:
          'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
        danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
      },
      size: {
        // 40px minimum hit target, section 11.1.
        default: 'h-10 px-3 text-[13px]',
        lg: 'h-11 px-5 text-[14px]',
        /** Icon buttons still carry a visible text label beside the icon. */
        icon: 'h-10 min-w-10 px-2 text-[13px]',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows a spinner in place of the label without changing the button box. */
  busy?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, busy = false, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {/* The label stays in the accessibility tree so the control keeps
              its name while busy. */}
          <span className="sr-only">{children}</span>
          <span aria-hidden className="invisible">
            {children}
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
})

export { buttonVariants }
