import { addNotice, replaceNotices } from '@boom-busters/db'
import { describeRepairs } from '@boom-busters/providers'
import type { Repair } from '@boom-busters/providers'
import type { NoticeTarget } from '@boom-busters/schemas'
import { db } from '@/lib/db'

/**
 * Notices (decision 293). An answer that lands for a subject replaces that
 * subject's open notices with one line of its repairs, or with none, so a
 * clean answer retires the old note. A stop is added beside what is there:
 * the notes of the answer the owner still has stay true.
 */
export async function recordRepairs(
  target: NoticeTarget,
  repairs: readonly Repair[] = [],
): Promise<void> {
  const message = describeRepairs(repairs)
  const kind = repairs.some((repair) => repair.action === 'dropped') ? 'dropped' : 'trimmed'
  await replaceNotices(db, target, message === null ? [] : [{ kind, message }])
}

export async function recordStop(
  target: NoticeTarget,
  kind: 'stopped' | 'skipped',
  message: string,
): Promise<void> {
  await addNotice(db, target, { kind, message })
}
