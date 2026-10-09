'use server'

import { dismissNotice } from '@boom-busters/db'
import { UlidSchema } from '@boom-busters/schemas'
import { auth } from '@/auth'
import { db } from '@/lib/db'

/** The Dismiss button on a notice (decision 293). The caller refreshes its page. */
export async function dismissNoticeAction(
  noticeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
  if (!UlidSchema.safeParse(noticeId).success) return { ok: false, error: 'Unknown id' }
  await dismissNotice(db, noticeId)
  return { ok: true }
}
