import { addNotice, replaceNotices } from '@boom-busters/db'
import { describeRepairs } from '@boom-busters/providers'
import type { Repair } from '@boom-busters/providers'
import { serialiseError } from '@boom-busters/schemas'
import type { NoticeTarget } from '@boom-busters/schemas'
import { db } from '@/lib/db'

/**
 * Notices (decision 293). An answer that lands for a subject replaces that
 * subject's open notices with one line of its repairs, or with none, so a
 * clean answer retires the old note. A stop is added beside what is there:
 * the notes of the answer the owner still has stay true. A skip, where
 * nothing was made, replaces them (decision 294).
 *
 * All three are best-effort, as `notify()` is: a notice must never fail or
 * retry the work it reports, and they run after paid work in the same step.
 */
export async function recordRepairs(
  target: NoticeTarget,
  repairs: readonly Repair[] = [],
): Promise<void> {
  const message = describeRepairs(repairs)
  const kind = repairs.some((repair) => repair.action === 'dropped') ? 'dropped' : 'trimmed'
  try {
    await replaceNotices(db, target, message === null ? [] : [{ kind, message }])
  } catch (error) {
    console.error('[notices] could not record a notice', target, serialiseError(error))
  }
}

export async function recordStop(
  target: NoticeTarget,
  kind: 'stopped' | 'skipped',
  message: string,
): Promise<void> {
  try {
    await addNotice(db, target, { kind, message })
  } catch (error) {
    console.error('[notices] could not record a notice', target, serialiseError(error))
  }
}

/**
 * A skip: the thing was not made at all (today only the Shorts stage's
 * teaser, when no teaser row exists). It replaces the subject's open
 * notices, since nothing is left for an older note to describe, so a retry
 * that skips again leaves one line, not two. Only for a subject with
 * nothing made: a skip beside a thing that exists would retire its notes.
 */
export async function recordSkip(target: NoticeTarget, message: string): Promise<void> {
  try {
    await replaceNotices(db, target, [{ kind: 'skipped', message }])
  } catch (error) {
    console.error('[notices] could not record a notice', target, serialiseError(error))
  }
}
