/**
 * The YouTube error mapper (build spec sections 9 and 13): every upload
 * failure becomes one of five typed actions, so the publish-runner never
 * branches on a vendor string and the UI never shows a raw one.
 *
 * - `quotaExceeded` (and its sibling `dailyLimitExceeded`): the API quota
 *   day is spent — requeue for tomorrow and notify.
 * - `uploadLimitExceeded`: the CHANNEL hit its upload limit — pause the
 *   whole queue 24 h; more attempts make it worse.
 * - auth failures (`invalid_grant`, 401s, credential reasons): only
 *   reconsenting helps — the "Reconnect YouTube" card in Needs-you.
 * - transient server trouble (5xx, `backendError`, rate limits): retry.
 * - everything else: fail this item and show the mapped message.
 */

import { z } from 'zod'

/**
 * What a publish_records row's `metadata` must hold before an upload may
 * start (spec section 7.2 item 8: "metadata approved" is a precondition).
 * Limits are YouTube's own: 100-char titles, 5000-byte descriptions, and a
 * combined tag budget of about 500 characters.
 */
export const PublishMetadataSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000),
  tags: z.array(z.string().trim().min(1).max(100)).max(60).default([]),
})
export type PublishMetadata = z.infer<typeof PublishMetadataSchema>

export type YoutubeErrorAction =
  | { kind: 'requeue-tomorrow' }
  | { kind: 'pause-queue'; hours: number }
  | { kind: 'reconnect' }
  | { kind: 'retry' }
  | { kind: 'fail' }

export interface YoutubeErrorInput {
  /** HTTP status, when the caller has one. */
  status?: number
  /** YouTube's machine reason (`errors[0].reason`), when parsed out. */
  reason?: string
  /** Free text — media-utils failures arrive as strings; tokens are found in them. */
  message?: string
}

const REQUEUE_REASONS = ['quotaExceeded', 'dailyLimitExceeded']
const PAUSE_REASONS = ['uploadLimitExceeded']
const RECONNECT_REASONS = [
  'invalid_grant',
  'authError',
  'invalidCredentials',
  'unauthorized',
  'forbidden',
]
const RETRY_REASONS = [
  'backendError',
  'internalError',
  'rateLimitExceeded',
  'userRateLimitExceeded',
]

function findToken(haystack: string, tokens: readonly string[]): boolean {
  const lower = haystack.toLowerCase()
  return tokens.some((token) => lower.includes(token.toLowerCase()))
}

export function mapYoutubeError(input: YoutubeErrorInput): YoutubeErrorAction {
  const text = `${input.reason ?? ''} ${input.message ?? ''}`.trim()

  // Reason tokens outrank the status: a 403 can mean quota, upload limit or
  // permissions, and only the reason says which.
  if (findToken(text, PAUSE_REASONS)) return { kind: 'pause-queue', hours: 24 }
  if (findToken(text, REQUEUE_REASONS)) return { kind: 'requeue-tomorrow' }
  if (findToken(text, RECONNECT_REASONS)) return { kind: 'reconnect' }
  if (findToken(text, RETRY_REASONS)) return { kind: 'retry' }

  if (input.status === 401) return { kind: 'reconnect' }
  if (input.status !== undefined && input.status >= 500) return { kind: 'retry' }

  return { kind: 'fail' }
}

/** What the notification and the status chip say for each action. */
export function describeYoutubeAction(action: YoutubeErrorAction): string {
  switch (action.kind) {
    case 'requeue-tomorrow':
      return "YouTube's daily API quota is spent — requeued for tomorrow."
    case 'pause-queue':
      return `The channel hit its upload limit — the queue is paused ${action.hours} h.`
    case 'reconnect':
      return 'YouTube no longer accepts the stored credentials — reconnect in Settings.'
    case 'retry':
      return 'YouTube had a transient problem — retrying.'
    case 'fail':
      return 'YouTube refused the upload.'
  }
}

/**
 * When the CURRENT YouTube quota day started. The API quota resets at
 * midnight Pacific Time — not UTC — so counting uploads "today" by UTC
 * would free the budget seven-to-eight hours early. Computed via the IANA
 * zone so daylight saving needs no table here.
 */
export function quotaDayStartUtc(now: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23, explicitly: some ICU builds render midnight as '24' under
    // hour12:false, which would put the day start a full day out.
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  ) as Record<string, string>

  // Seconds since Pacific midnight, subtracted from `now` — no zone maths
  // on the wall-clock date, which is where DST bugs live.
  const sincePacificMidnightMs =
    (Number(parts['hour']) * 3600 + Number(parts['minute']) * 60 + Number(parts['second'])) * 1000
  return new Date(now.getTime() - sincePacificMidnightMs - (now.getTime() % 1000))
}
