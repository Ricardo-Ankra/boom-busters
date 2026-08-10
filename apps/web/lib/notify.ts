import { deletePushSubscription, listPushSubscriptions, markPushNotified } from '@boom-busters/db'
import { hasEnvGroup, requireEnv } from '@boom-busters/schemas'
import 'server-only'
import webpush from 'web-push'
import { db } from './db'
import { env } from './env'

/**
 * Notification plumbing (build spec section 11.4).
 *
 * Web push (VAPID) always, email (Resend) when configured. Both are optional
 * infrastructure: a console that refuses to run a pipeline because nobody set
 * up push notifications would be absurd, so every path here degrades to a log
 * line and returns.
 *
 * **`notify()` never throws.** It is called from inside Inngest steps, and a
 * failed notification must not fail — or worse, retry — the work it was
 * announcing.
 */

export const NOTIFICATION_KINDS = [
  'gate-open',
  'budget-gate',
  'run-failed',
  'qc-failed',
  'publish-success',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export interface Notification {
  kind: NotificationKind
  title: string
  body: string
  /** App-relative path. Deep-links to the exact review screen (section 11.4). */
  href: string
}

export function pushConfigured(): boolean {
  return hasEnvGroup('push')
}

export function emailConfigured(): boolean {
  return hasEnvGroup('email')
}

/** The key the browser needs to subscribe. Public by design. */
export function vapidPublicKey(): string | null {
  return pushConfigured() ? requireEnv('push').VAPID_PUBLIC_KEY : null
}

function configureWebPush(): boolean {
  if (!pushConfigured()) return false
  const keys = requireEnv('push')
  webpush.setVapidDetails(
    `mailto:${env.OWNER_EMAIL}`,
    keys.VAPID_PUBLIC_KEY,
    keys.VAPID_PRIVATE_KEY,
  )
  return true
}

async function sendPush(notification: Notification): Promise<void> {
  if (!configureWebPush()) return

  const subscriptions = await listPushSubscriptions(db)
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    href: notification.href,
    kind: notification.kind,
  })

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        )
        await markPushNotified(db, subscription.endpoint)
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // The browser dropped the subscription. Keeping it would burn a
          // failed request per notification, forever.
          await deletePushSubscription(db, subscription.endpoint)
          return
        }
        console.error('[notify] push failed', error)
      }
    }),
  )
}

async function sendEmail(notification: Notification): Promise<void> {
  if (!emailConfigured()) return

  const { RESEND_API_KEY, NOTIFY_FROM_EMAIL } = requireEnv('email')
  const { Resend } = await import('resend')
  const resend = new Resend(RESEND_API_KEY)

  const url = new URL(notification.href, env.AUTH_URL).toString()
  const { error } = await resend.emails.send({
    from: NOTIFY_FROM_EMAIL,
    to: env.OWNER_EMAIL,
    subject: notification.title,
    text: `${notification.body}\n\n${url}\n`,
  })
  if (error) console.error('[notify] email failed', error)
}

export async function notify(notification: Notification): Promise<void> {
  if (!pushConfigured() && !emailConfigured()) {
    // The log line carries the whole notification, not just its title: with
    // no push and no email this is the only record that a gate opened, and a
    // headline without the numbers is not a record.
    console.warn(
      `[notify] ${notification.kind}: ${notification.title} — ${notification.body} ` +
        `(${notification.href}). Not delivered: neither VAPID nor Resend is configured.`,
    )
    return
  }

  try {
    await Promise.all([sendPush(notification), sendEmail(notification)])
  } catch (error) {
    console.error('[notify] delivery failed', error)
  }
}
