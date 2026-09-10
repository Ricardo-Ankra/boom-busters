'use client'

import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as React from 'react'
import { cn } from '@/lib/cn'

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        // The button is the 40px hit target (section 11.1); the 24px track
        // is drawn inside it with a pseudo-element, so the control reads as a
        // switch and presses like a button.
        'peer relative inline-flex h-10 w-11 shrink-0 cursor-pointer items-center rounded-full',
        'before:absolute before:inset-x-0 before:top-2 before:h-6 before:rounded-full before:content-[""]',
        'before:transition-colors before:duration-150 before:ease-[cubic-bezier(0.16,1,0.3,1)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:before:bg-[var(--color-accent)] data-[state=unchecked]:before:bg-[var(--color-border-strong)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none relative block h-5 w-5 rounded-full bg-white shadow-sm ring-0',
          'transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5',
        )}
      />
    </SwitchPrimitive.Root>
  )
})
