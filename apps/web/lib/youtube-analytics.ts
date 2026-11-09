import 'server-only'

/**
 * The YouTube Analytics reads the analytics-runner makes (build spec
 * sections 5 and 7.2 item 9), against the `yt-analytics.readonly` scope the
 * OAuth connect already requested.
 *
 * Three honesty notes, decided at build time (M8):
 *
 * - **Numbers are lifetime-to-date**, not per-day: the digest computes
 *   deltas between two snapshots, which survives a day whose cron never ran.
 *   A caller may pass a date range to get a bounded window instead.
 * - **There is no impressions CTR in this API** — that number lives only in
 *   Studio. The `ctrBySource` column carries views by traffic source type,
 *   the closest thing the API actually answers.
 * - **RPM needs the `yt-analytics-monetary.readonly` scope**, which the app
 *   never asked for. It stays null rather than being guessed; adding the
 *   scope means a reconnect, which is an owner decision.
 */

const REPORTS_ENDPOINT = 'https://youtubeanalytics.googleapis.com/v2/reports'
const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos'

/** The channel's whole history — cheap, and immune to publish-date maths. */
const LIFETIME_START = '2020-01-01'

/** The traffic source type the Analytics API uses for YouTube search. */
export const SEARCH_SOURCE_KEY = 'YT_SEARCH'

export interface DateRange {
  start: string
  end: string
}

export interface VideoAnalytics {
  retentionCurve: { pct: number; ratio: number }[]
  viewsBySource: Record<string, number>
  views: number | null
  avgViewDurationSec: number | null
  searchTerms: { term: string; views: number; minutes: number }[]
  subscribersGained: number | null
  likes: number | null
  comments: number | null
}

export interface VideoFacts {
  privacyStatus: string | null
  publishedAt: string | null
  durationSec: number | null
}

interface ReportsResponse {
  rows?: (string | number)[][]
  error?: { message?: string }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function report(
  accessToken: string,
  params: Record<string, string>,
  range?: DateRange,
): Promise<(string | number)[][]> {
  const search = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: range?.start ?? LIFETIME_START,
    endDate: range?.end ?? isoDay(new Date()),
    ...params,
  })
  const response = await fetch(`${REPORTS_ENDPOINT}?${search.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  const payload = (await response.json().catch(() => ({}))) as ReportsResponse
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `reports.query answered ${response.status}`)
  }
  return payload.rows ?? []
}

function numberOrNull(value: string | number | undefined): number | null {
  return value === undefined ? null : Number(value)
}

/**
 * Everything one snapshot needs, in four reports. A video too new to have
 * analytics comes back with empty rows, which is a valid (empty) snapshot,
 * not an error. With a `range` every report covers just that window.
 */
export async function fetchVideoAnalytics(
  accessToken: string,
  videoId: string,
  range?: DateRange,
): Promise<VideoAnalytics> {
  const filters = `video==${videoId}`

  const [retention, totals, sources, terms] = await Promise.all([
    report(
      accessToken,
      { metrics: 'audienceWatchRatio', dimensions: 'elapsedVideoTimeRatio', filters },
      range,
    ),
    report(
      accessToken,
      { metrics: 'views,averageViewDuration,subscribersGained,likes,comments', filters },
      range,
    ),
    report(
      accessToken,
      { metrics: 'views', dimensions: 'insightTrafficSourceType', filters, sort: '-views' },
      range,
    ),
    report(
      accessToken,
      {
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceDetail',
        filters: `${filters};insightTrafficSourceType==${SEARCH_SOURCE_KEY}`,
        sort: '-views',
        maxResults: '25',
      },
      range,
    ),
  ])

  const retentionCurve = retention.map((row) => ({
    pct: Math.round(Number(row[0]) * 100),
    ratio: Number(row[1]),
  }))

  const viewsBySource: Record<string, number> = {}
  for (const row of sources) {
    viewsBySource[String(row[0])] = Number(row[1])
  }

  const searchTerms = terms.map((row) => ({
    term: String(row[0]),
    views: Number(row[1]),
    minutes: Number(row[2]),
  }))

  const totalsRow = totals[0]
  return {
    retentionCurve,
    viewsBySource,
    views: totalsRow ? numberOrNull(totalsRow[0]) : null,
    avgViewDurationSec: totalsRow ? numberOrNull(totalsRow[1]) : null,
    searchTerms,
    subscribersGained: totalsRow ? numberOrNull(totalsRow[2]) : null,
    likes: totalsRow ? numberOrNull(totalsRow[3]) : null,
    comments: totalsRow ? numberOrNull(totalsRow[4]) : null,
  }
}

/** ISO 8601 duration as YouTube writes it (`P#DT#H#M#S`) to seconds; null when unparseable. */
function parseIsoDuration(value: string | undefined): number | null {
  if (!value) return null
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value)
  if (!match || value === 'P' || value.endsWith('T')) return null
  const [days = 0, hours = 0, minutes = 0, seconds = 0] = match
    .slice(1)
    .map((part) => Number(part ?? 0))
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}

/**
 * `videos.list part=status,snippet,contentDetails` for up to 50 ids at once
 * (1 quota unit): privacy, the real publish time and the duration.
 */
export async function fetchVideoFacts(
  accessToken: string,
  videoIds: readonly string[],
): Promise<Map<string, VideoFacts>> {
  const facts = new Map<string, VideoFacts>()
  for (let at = 0; at < videoIds.length; at += 50) {
    const batch = videoIds.slice(at, at + 50)
    const params = new URLSearchParams({
      part: 'status,snippet,contentDetails',
      id: batch.join(','),
    })
    const response = await fetch(`${VIDEOS_ENDPOINT}?${params.toString()}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      throw new Error(`videos.list answered ${response.status}`)
    }
    const payload = (await response.json().catch(() => ({}))) as {
      items?: {
        id?: string
        status?: { privacyStatus?: string }
        snippet?: { publishedAt?: string }
        contentDetails?: { duration?: string }
      }[]
    }
    for (const item of payload.items ?? []) {
      if (!item.id) continue
      facts.set(item.id, {
        privacyStatus: item.status?.privacyStatus ?? null,
        publishedAt: item.snippet?.publishedAt ?? null,
        durationSec: parseIsoDuration(item.contentDetails?.duration),
      })
    }
  }
  return facts
}

/**
 * How the cron learns a scheduled video went public, since the human flips it
 * in Studio while `apiAuditPassed` is off and tells nobody.
 */
export async function fetchPrivacyStatuses(
  accessToken: string,
  videoIds: readonly string[],
): Promise<Map<string, string>> {
  const statuses = new Map<string, string>()
  for (const [id, fact] of await fetchVideoFacts(accessToken, videoIds)) {
    if (fact.privacyStatus) statuses.set(id, fact.privacyStatus)
  }
  return statuses
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

function seedOf(videoId: string): number {
  let seed = 0
  for (const char of videoId) seed = (seed * 31 + char.charCodeAt(0)) % 9973
  return seed
}

const MOCK_TERM_WORDS = ['case', 'story', 'collapse', 'explained', 'documentary']

/** Inclusive length of a range in days; an unreadable range counts as the full 28. */
function rangeDays(range: DateRange): number {
  const span = (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000
  return Number.isFinite(span) ? Math.max(1, Math.round(span) + 1) : 28
}

/**
 * Deterministic per video: the same id always graphs the same story. With a
 * range the counts scale by min(1, days / 28), so a day-7 report is smaller
 * than a day-28 one.
 */
export function mockVideoAnalytics(videoId: string, range?: DateRange): VideoAnalytics {
  const seed = seedOf(videoId)
  const factor = range ? Math.min(1, rangeDays(range) / 28) : 1
  const scale = (value: number) => Math.round(value * factor)

  const retentionCurve = Array.from({ length: 20 }, (_, index) => {
    const pct = index * 5
    // A believable curve: sharp early drop, slow decay, a mid-video dip.
    const base = 0.95 - pct * 0.006 - (pct > 40 && pct < 55 ? 0.08 : 0)
    const wobble = ((seed + index * 7) % 10) / 200
    return { pct, ratio: Math.max(0.1, Number((base - wobble).toFixed(3))) }
  })

  const searchTerms = MOCK_TERM_WORDS.map((word, index) => ({
    term: `${word} ${seed}`,
    views: scale(40 - index * 7 + (seed % 10)),
    minutes: scale(90 - index * 15 + (seed % 20)),
  }))

  return {
    retentionCurve,
    viewsBySource: {
      BROWSE: scale(400 + (seed % 300)),
      SUGGESTED: scale(250 + (seed % 200)),
      [SEARCH_SOURCE_KEY]: scale(120 + (seed % 90)),
      SHORTS: scale(80 + (seed % 400)),
    },
    views: scale(1000 + (seed % 5000)),
    avgViewDurationSec: 240 + (seed % 300),
    searchTerms,
    subscribersGained: scale(5 + (seed % 20)),
    likes: scale(30 + (seed % 100)),
    comments: scale(3 + (seed % 15)),
  }
}

/** Mock facts: public, the fallback publish date, a seeded 10 to 25 minute duration. */
export function mockVideoFacts(
  videoIds: readonly string[],
  fallback: Map<string, Date>,
): Map<string, VideoFacts> {
  const facts = new Map<string, VideoFacts>()
  for (const id of videoIds) {
    facts.set(id, {
      privacyStatus: 'public',
      publishedAt: fallback.get(id)?.toISOString() ?? null,
      durationSec: 600 + (seedOf(id) % 900),
    })
  }
  return facts
}
