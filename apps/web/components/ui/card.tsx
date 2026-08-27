import * as React from 'react'
import { cn } from '@/lib/cn'

/** Borders (1px, subtle) over shadows; corner radius 8 (spec section 11.1). */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-0.5 p-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    // h2, not h3: cards sit directly under most screens' h1, and an h1→h3
    // jump fails heading-order (Lighthouse, M8.6). The size comes from the
    // class either way — the level is document structure, not styling.
    <h2
      className={cn('text-[14px] font-semibold text-[var(--color-text-primary)]', className)}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-[13px] text-[var(--color-text-secondary)]', className)} {...props} />
  )
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-3 pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 p-3 pt-0', className)} {...props} />
}
