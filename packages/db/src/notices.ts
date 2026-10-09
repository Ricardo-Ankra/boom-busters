import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { NOTICE_MESSAGE_MAX, NoticeSchema } from '@boom-busters/schemas'
import type { NewNotice, Notice, NoticeTarget } from '@boom-busters/schemas'
import type { Database } from './client'
import { notices } from './schema'
import type { NoticeRow } from './schema'

/**
 * Notices (decision 293). An answer that lands replaces its subject's open
 * notices (`replaceNotices`, an empty list included, so a clean answer retires
 * the old note); a stop adds one (`addNotice`). The cards read a project's
 * open notices once and pick theirs with `noticesFor`.
 */

function toNotice(row: NoticeRow): Notice {
  return NoticeSchema.parse({
    id: row.id,
    projectId: row.projectId,
    subject: row.subject,
    subjectId: row.subjectId,
    kind: row.kind,
    message: row.message,
    createdAt: row.createdAt,
  })
}

const openFor = (target: NoticeTarget) =>
  and(
    target.projectId === null ? isNull(notices.projectId) : eq(notices.projectId, target.projectId),
    eq(notices.subject, target.subject),
    target.subjectId === null ? isNull(notices.subjectId) : eq(notices.subjectId, target.subjectId),
    isNull(notices.dismissedAt),
  )

const toRow = (target: NoticeTarget, notice: NewNotice) => ({
  projectId: target.projectId,
  subject: target.subject,
  subjectId: target.subjectId,
  kind: notice.kind,
  message: notice.message.slice(0, NOTICE_MESSAGE_MAX),
})

export async function replaceNotices(
  db: Database,
  target: NoticeTarget,
  list: readonly NewNotice[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(notices).set({ dismissedAt: new Date() }).where(openFor(target))
    if (list.length > 0)
      await tx.insert(notices).values(list.map((notice) => toRow(target, notice)))
  })
}

export async function addNotice(
  db: Database,
  target: NoticeTarget,
  notice: NewNotice,
): Promise<void> {
  await db.insert(notices).values(toRow(target, notice))
}

export async function listProjectNotices(db: Database, projectId: string): Promise<Notice[]> {
  const rows = await db
    .select()
    .from(notices)
    .where(and(eq(notices.projectId, projectId), isNull(notices.dismissedAt)))
    .orderBy(desc(notices.createdAt), desc(notices.id))
  return rows.map(toNotice)
}

export async function listCaseNotices(db: Database, caseIds: readonly string[]): Promise<Notice[]> {
  if (caseIds.length === 0) return []
  const rows = await db
    .select()
    .from(notices)
    .where(
      and(
        isNull(notices.projectId),
        eq(notices.subject, 'case'),
        inArray(notices.subjectId, [...caseIds]),
        isNull(notices.dismissedAt),
      ),
    )
    .orderBy(desc(notices.createdAt), desc(notices.id))
  return rows.map(toNotice)
}

/** Dismissing an already retired notice is a no-op: a stale tab must not error. */
export async function dismissNotice(db: Database, noticeId: string): Promise<void> {
  await db
    .update(notices)
    .set({ dismissedAt: new Date() })
    .where(and(eq(notices.id, noticeId), isNull(notices.dismissedAt)))
}
