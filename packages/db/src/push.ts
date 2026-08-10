import { eq } from 'drizzle-orm'
import type { Database } from './client'
import { pushSubscriptions } from './schema'
import type { PushSubscriptionRow } from './schema'

/**
 * Web Push subscription storage (build spec section 11.4).
 *
 * The browser owns the subscription; we only keep enough to send to it. The
 * endpoint is the identity, so re-subscribing from the same browser updates
 * the row rather than growing a duplicate that would double every alert.
 */

export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent?: string | null
}

export async function savePushSubscription(
  db: Database,
  subscription: PushSubscriptionInput,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: subscription.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: subscription.userAgent ?? null,
        updatedAt: new Date(),
      },
    })
}

export async function listPushSubscriptions(db: Database): Promise<PushSubscriptionRow[]> {
  return db.select().from(pushSubscriptions)
}

/**
 * Drop a subscription the push service rejected as gone (404/410). Keeping it
 * would mean every future notification burns a failed request per send.
 */
export async function deletePushSubscription(db: Database, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
}

export async function markPushNotified(db: Database, endpoint: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastNotifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(pushSubscriptions.endpoint, endpoint))
}
