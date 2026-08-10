'use client'

import { Bell, BellOff } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

/**
 * Turning web push on for this browser (build spec section 11.4).
 *
 * A subscription belongs to a browser, not an account, so this control shows
 * the state of the browser it is rendered in — and says so, because "why am I
 * not getting alerts on my phone" has exactly one honest answer.
 */

function toApplicationServerKey(base64Url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  // Backed by a plain ArrayBuffer: `PushManager.subscribe` will not take a
  // Uint8Array that TypeScript cannot prove is not shared-memory-backed.
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return buffer
}

export function NotificationToggle({
  vapidPublicKey,
  emailConfigured,
}: {
  vapidPublicKey: string | null
  emailConfigured: boolean
}) {
  const { toast } = useToast()
  const [state, setState] = React.useState<'unknown' | 'off' | 'on' | 'unsupported'>('unknown')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? 'on' : 'off'))
      .catch(() => setState('off'))
  }, [])

  async function subscribe(): Promise<void> {
    if (!vapidPublicKey) return
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast({
          title: 'Notifications are blocked',
          description: 'Allow notifications for this site in your browser settings.',
          variant: 'error',
        })
        return
      }

      const registration = await navigator.serviceWorker.register('/push-worker.js')
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toApplicationServerKey(vapidPublicKey),
      })

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })
      if (!response.ok) throw new Error(await response.text())

      setState('on')
      toast({ title: 'Notifications on for this browser' })
    } catch (error) {
      toast({
        title: 'Could not turn notifications on',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe(): Promise<void> {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      setState('off')
      toast({ title: 'Notifications off for this browser' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Open gates, failed runs and budget gates, delivered to this browser
          {emailConfigured ? ' and by email' : ''}.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {!vapidPublicKey ? (
          <p className="text-[13px] text-[var(--color-warning)]">
            Web push is not configured. Generate a key pair with{' '}
            <span className="font-mono">pnpm exec web-push generate-vapid-keys</span> and set
            <span className="font-mono"> VAPID_PUBLIC_KEY</span> and
            <span className="font-mono"> VAPID_PRIVATE_KEY</span>. It costs nothing and needs no
            account.
          </p>
        ) : state === 'unsupported' ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            This browser does not support web push.
            {emailConfigured ? ' Email notifications still work.' : ''}
          </p>
        ) : state === 'on' ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-[13px] text-[var(--color-success)]">
              <Bell className="size-4" aria-hidden />
              On for this browser
            </span>
            <Button variant="outline" busy={busy} onClick={unsubscribe}>
              <BellOff aria-hidden />
              Turn off on this browser
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-[var(--color-text-secondary)]">
              Off for this browser.
            </span>
            <Button variant="primary" busy={busy || state === 'unknown'} onClick={subscribe}>
              <Bell aria-hidden />
              Turn on notifications
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
