import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * The one chip (decision 250). Seventeen hand-rolled variants had grown
 * across the screens: three radii, four font sizes, border-only beside
 * tinted, `uppercase` on some, raw enum strings on others. A status chip on
 * the calendar, a publish item and a board slot now reads the same way.
 *
 * Two shapes, one meaning each:
 * - `pill`: a STATE (draft, live, resolved, needs attention). Bordered, the
 *   border and text in the state's tone, never colour alone: the label is
 *   the requirement, the tone the accent.
 * - `tag`: a KIND (long-form, stock, chart, demo). Filled, quiet, mono, upper.
 */
const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] leading-4 [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      shape: {
        pill: 'rounded-full border px-2 py-0.5',
        tag: 'rounded-[4px] bg-[var(--color-background)] px-1.5 py-0.5 font-mono uppercase',
      },
      tone: {
        neutral: 'border-[var(--color-border-strong)] text-[var(--color-text-secondary)]',
        muted: 'border-[var(--color-border)] text-[var(--color-text-muted)]',
        success: 'border-[var(--color-success)] text-[var(--color-success)]',
        warning: 'border-[var(--color-warning)] text-[var(--color-warning)]',
        danger: 'border-[var(--color-danger)] text-[var(--color-danger)]',
        accent: 'border-[var(--color-accent-text)] text-[var(--color-accent-text)]',
      },
    },
    defaultVariants: { shape: 'pill', tone: 'neutral' },
  },
)

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

export function Badge({
  className,
  shape,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ shape, tone }), className)} {...props} />
}
