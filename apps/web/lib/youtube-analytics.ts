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

export interface VideoAnalytics {
  retentionCurve: { pct: number; ratio: number }[]
  viewsBySource: Record<string, number>
  views: number | null
  avgViewDurationSec: number | null
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
): Promise<(string | number)[][]> {
  const search = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: LIFETIME_START,
    endDate: isoDay(new Date()),
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

/**
 * Everything one snapshot needs, in three reports. A video too new to have
 * analytics comes back with empty rows, which is a valid (empty) snapshot,
 * not an error.
 */
export async function fetchVideoAnalytics(
  accessToken: string,
  videoId: string,
): Promise<VideoAnalytics> {
  const filters = `video==${videoId}`

  const [retention, totals, sources] = await Promise.all([
    report(accessToken, {
      metrics: 'audienceWatchRatio',
      dimensions: 'elapsedVideoTimeRatio',
      filters,
    }),
    report(accessToken, { metrics: 'views,averageViewDuration', filters }),
    report(accessToken, {
      metrics: 'views',
      dimensions: 'insightTrafficSourceType',
      filters,
      sort: '-views',
    }),
  ])

  const retentionCurve = retention.map((row) => ({
    pct: Math.round(Number(row[0]) * 100),
    ratio: Number(row[1]),
  }))

  const viewsBySource: Record<string, number> = {}
  for (const row of sources) {
    viewsBySource[String(row[0])] = Number(row[1])
  }

  const totalsRow = totals[0]
  return {
    retentionCurve,
    viewsBySource,
    views: totalsRow ? Number(totalsRow[0]) : null,
    avgViewDurationSec: totalsRow ? Number(totalsRow[1]) : null,
  }
}

/**
 * `videos.list part=status` for up to 50 ids at once (1 quota unit) — how
 * the cron learns a scheduled video went public, since the human flips it
 * in Studio while `apiAuditPassed` is off and tells nobody.
 */
export async function fetchPrivacyStatuses(
  accessToken: string,
  videoIds: readonly string[],
): Promise<Map<string, string>> {
  const statuses = new Map<string, string>()
  for (let at = 0; at < videoIds.length; at += 50) {
    const batch = videoIds.slice(at, at + 50)
    const params = new URLSearchParams({ part: 'status', id: batch.join(',') })
    const response = await fetch(`${VIDEOS_ENDPOINT}?${params.toString()}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      throw new Error(`videos.list answered ${response.status}`)
    }
    const payload = (await response.json().catch(() => ({}))) as {
      items?: { id?: string; status?: { privacyStatus?: string } }[]
    }
    for (const item of payload.items ?? []) {
      if (item.id && item.status?.privacyStatus) statuses.set(item.id, item.status.privacyStatus)
    }
  }
  return statuses
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/** Deterministic per video: the same id always graphs the same story. */
export function mockVideoAnalytics(videoId: string): VideoAnalytics {
  let seed = 0
  for (const char of videoId) seed = (seed * 31 + char.charCodeAt(0)) % 9973

  const retentionCurve = Array.from({ length: 20 }, (_, index) => {
    const pct = index * 5
    // A believable curve: sharp early drop, slow decay, a mid-video dip.
    const base = 0.95 - pct * 0.006 - (pct > 40 && pct < 55 ? 0.08 : 0)
    const wobble = ((seed + index * 7) % 10) / 200
    return { pct, ratio: Math.max(0.1, Number((base - wobble).toFixed(3))) }
  })

  return {
    retentionCurve,
    viewsBySource: {
      BROWSE: 400 + (seed % 300),
      SUGGESTED: 250 + (seed % 200),
      SEARCH: 120 + (seed % 90),
      SHORTS: 80 + (seed % 400),
    },
    views: 1000 + (seed % 5000),
    avgViewDurationSec: 240 + (seed % 300),
  }
}
