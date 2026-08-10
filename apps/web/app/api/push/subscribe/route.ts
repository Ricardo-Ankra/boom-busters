import { deletePushSubscription, savePushSubscription } from '@boom-busters/db'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'

/**
 * Store or drop a Web Push subscription (build spec section 11.4).
 *
 * Session-checked like any other write endpoint: `proxy.ts` covers navigation,
 * but this is a POST endpoint of its own and must not rely on that.
 */

export const runtime = 'nodejs'

const SubscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const parsed = SubscriptionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return new Response('Invalid subscription', { status: 400 })

  await savePushSubscription(db, {
    endpoint: parsed.data.endpoint,
    keys: parsed.data.keys,
    userAgent: request.headers.get('user-agent'),
  })

  return Response.json({ ok: true })
}

export async function DELETE(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const parsed = z.object({ endpoint: z.url() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return new Response('Invalid subscription', { status: 400 })

  await deletePushSubscription(db, parsed.data.endpoint)
  return Response.json({ ok: true })
}
