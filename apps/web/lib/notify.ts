import { hasEnvGroup, requireEnv } from '@boom-busters/schemas'
import 'server-only'
import { env } from './env'

/**
 * Notification plumbing (build spec section 11.4), reduced to what is used.
 *
 * Spec 11.4 asks for web push, and it was built — a VAPID key pair, a service
 * worker, a subscriptions table, a Settings toggle. It was then removed by
 * decision (2026-08-13): a single-user console whose owner is in the app when
 * anything interesting happens does not need a push channel, and the one
 * visible effect the machinery ever had was a Settings popup demanding VAPID
 * keys nobody intended to create.
 *
 * What remains is the email path (Resend, inert until a key is configured,
 * kept because the "final layer" of notifications was deferred rather than
 * abandoned) and the log line. The Activity drawer reads run events from the
 * database and is not part of this module.
 *
 * **`notify()` never throws.** It is called from inside Inngest steps, and a
 * failed notification must not fail — or worse, retry — the work it was
 * announcing.
 */

export const NOTIFICATION_KINDS = [
  'gate-open',
  /** A clean stage that closed its own gate and moved on — informational. */
  'gate-auto',
  'budget-gate',
  'run-failed',
  'qc-failed',
  'publish-success',
  /** The daily ping found the YouTube refresh token dead (M8). */
  'reconnect-youtube',
  /** The Monday numbers (M8). */
  'weekly-digest',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export interface Notification {
  kind: NotificationKind
  title: string
  body: string
  /** App-relative path. Deep-links to the exact review screen (section 11.4). */
  href: string
}

export function emailConfigured(): boolean {
  return hasEnvGroup('email')
}

async function sendEmail(notification: Notification): Promise<void> {
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
  if (!emailConfigured()) {
    // The log line carries the whole notification, not just its title: with no
    // email configured this is the only record outside the Activity drawer
    // that a gate opened, and a headline without the numbers is not a record.
    console.warn(
      `[notify] ${notification.kind}: ${notification.title} — ${notification.body} ` +
        `(${notification.href})`,
    )
    return
  }

  try {
    await sendEmail(notification)
  } catch (error) {
    console.error('[notify] delivery failed', error)
  }
}
