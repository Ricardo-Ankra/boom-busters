'use client'

import * as ToastPrimitive from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Toasts bottom-right, auto-dismiss except errors (build spec section 11.1).
 * Errors stay until dismissed because they carry the rollback message for an
 * optimistic update that failed.
 */

interface ToastMessage {
  id: number
  title: string
  description?: string | undefined
  variant: 'default' | 'error'
}

export interface ToastInput {
  title: string
  description?: string | undefined
  variant?: 'default' | 'error'
}

interface ToastContextValue {
  toast: (message: ToastInput) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([])
  const nextId = React.useRef(0)

  const toast = React.useCallback((message: ToastInput) => {
    setMessages((current) => [...current, { variant: 'default', ...message, id: nextId.current++ }])
  }, [])

  const value = React.useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {messages.map((message) => (
          <ToastPrimitive.Root
            key={message.id}
            duration={message.variant === 'error' ? Infinity : 4000}
            onOpenChange={(open) => {
              if (!open) setMessages((current) => current.filter((m) => m.id !== message.id))
            }}
            className={cn(
              'flex items-start gap-3 rounded-[8px] border p-4',
              'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2',
              message.variant === 'error'
                ? 'border-[var(--color-danger)] bg-[var(--color-surface)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)]',
            )}
          >
            <div className="flex-1">
              <ToastPrimitive.Title className="text-[14px] font-medium text-[var(--color-text-primary)]">
                {message.title}
              </ToastPrimitive.Title>
              {message.description ? (
                <ToastPrimitive.Description className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  {message.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="Dismiss"
              className="rounded-[4px] p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              <X className="size-4" aria-hidden />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
