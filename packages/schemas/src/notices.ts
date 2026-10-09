import { z } from 'zod'

/**
 * Notices (decision 293): one line on the card an answer concerns, saying
 * what a repair trimmed or dropped, or why a task stopped. The owner reads
 * it there and dismisses it; the next answer for the same subject retires it.
 */

export const NOTICE_SUBJECTS = [
  'project',
  'direction',
  'dossier',
  'script',
  'teaser',
  'cast',
  'slot',
  'case',
] as const

export const NOTICE_KINDS = ['trimmed', 'dropped', 'stopped', 'skipped'] as const

/** One readable line; a longer one is cut to the limit before it is stored. */
export const NOTICE_MESSAGE_MAX = 1000

export type NoticeSubject = (typeof NOTICE_SUBJECTS)[number]
export type NoticeKind = (typeof NOTICE_KINDS)[number]

/** What a notice is about: a project-wide subject, or one cast member, slot or case. */
export type NoticeTarget = {
  projectId: string | null
  subject: NoticeSubject
  subjectId: string | null
}

export type NewNotice = { kind: NoticeKind; message: string }

export const NoticeSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  subject: z.enum(NOTICE_SUBJECTS),
  subjectId: z.string().nullable(),
  kind: z.enum(NOTICE_KINDS),
  message: z.string(),
  createdAt: z.date(),
})

export type Notice = z.infer<typeof NoticeSchema>

/** The open notices for one subject, or one item of it, in the order given. */
export function noticesFor(
  notices: readonly Notice[],
  subject: NoticeSubject,
  subjectId: string | null = null,
): Notice[] {
  return notices.filter((notice) => notice.subject === subject && notice.subjectId === subjectId)
}
