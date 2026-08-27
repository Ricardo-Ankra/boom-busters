import {
  recordVerifyResult,
  scheduledPublishItems,
  snapshotsSince,
  updatePublishRecord,
  upsertAnalyticsSnapshot,
  videoBackedRecords,
  youtubeRefreshToken,
} from '@boom-busters/db'
import { buildDigestRequest, mockDigest, mockProvidersEnabled } from '@boom-busters/providers'
import type { DigestLine } from '@boom-busters/providers'
import { BudgetExceededError } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { callLlm } from '@/lib/llm'
import { notify } from '@/lib/notify'
import {
  fetchPrivacyStatuses,
  fetchVideoAnalytics,
  mockVideoAnalytics,
} from '@/lib/youtube-analytics'
import { pingChannel, refreshAccessToken, youtubeConfigured, YoutubeAuthError } from '@/lib/youtube'
import { inngest } from '../client'
import { events } from '../events'

/**
 * analytics-runner (build spec section 7.2 item 9) — the only cron in the
 * system, daily at 06:00 UTC, plus `analytics/refresh.requested` so the
 * owner has a button and the tests have a trigger.
 *
 * Four jobs, in order:
 *
 * 1. **The health ping** (decision 171): `channels.list` with a token minted
 *    from the stored refresh token. A dead refresh token stamps the
 *    credential invalid, which is what raises the "Reconnect YouTube" card.
 * 2. **Scheduled → live reconciliation**: while `apiAuditPassed` is off the
 *    human flips videos public in Studio and tells nobody, so `videos.list
 *    part=status` is how records learn they went live.
 * 3. **Snapshots**: lifetime-to-date numbers per live video into
 *    `analytics_snapshots`, one row per video per UTC day, upserted.
 * 4. **The Monday digest**: deltas computed in code, narrated by the
 *    `digest`-routed model, delivered through `notify()`.
 *
 * Mock mode does all four against deterministic fixtures and no network.
 */

const FUNCTION_ID = 'analytics-runner'

/** 06:00 UTC: after YouTube's day has closed everywhere that matters. */
export const ANALYTICS_CRON = 'TZ=UTC 0 6 * * *'

type TokenState =
  { mode: 'mock' } | { mode: 'absent' } | { mode: 'dead' } | { mode: 'live'; accessToken: string }

/** UTC midnight of the run's day — the snapshot's dedupe key. */
function utcToday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** The steepest fall between neighbouring retention points, as % through. */
export function worstRetentionDrop(curve: { pct: number; ratio: number }[] | null): number | null {
  if (!curve || curve.length < 2) return null
  let worstAt: number | null = null
  let worstFall = 0
  for (let index = 1; index < curve.length; index += 1) {
    const fall = curve[index - 1]!.ratio - curve[index]!.ratio
    if (fall > worstFall) {
      worstFall = fall
      worstAt = curve[index]!.pct
    }
  }
  return worstFall > 0.02 ? worstAt : null
}

export const analyticsRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Analytics (daily)',
    retries: 2,
    // The cron and a manual refresh must not interleave their upserts.
    concurrency: [{ limit: 1 }],
    triggers: [{ cron: ANALYTICS_CRON }, events.analyticsRefreshRequested],
  },
  async ({ step }) => {
    // -----------------------------------------------------------------------
    // 1. Token + health ping
    // -----------------------------------------------------------------------

    const token = await step.run('mint-access-token', async (): Promise<TokenState> => {
      if (mockProvidersEnabled()) return { mode: 'mock' }
      if (!youtubeConfigured()) return { mode: 'absent' }
      const refreshToken = await youtubeRefreshToken(db, env.SECRETS_ENCRYPTION_KEY)
      if (!refreshToken) return { mode: 'absent' }

      try {
        const grant = await refreshAccessToken(refreshToken)
        return { mode: 'live', accessToken: grant.accessToken }
      } catch (error) {
        if (error instanceof YoutubeAuthError && error.needsReconnect) {
          // The one failure a retry can never fix — stamp it and say so.
          await recordVerifyResult(db, 'youtube', 'invalid')
          await notify({
            kind: 'reconnect-youtube',
            title: 'YouTube needs reconnecting',
            body: 'The stored refresh token was refused. Uploads and analytics stop until you reconnect.',
            href: '/settings?tab=connections',
          })
          return { mode: 'dead' }
        }
        throw error
      }
    })

    if (token.mode === 'live') {
      await step.run('ping-channel', async () => {
        const ping = await pingChannel(token.accessToken)
        await recordVerifyResult(db, 'youtube', ping.ok ? 'ok' : 'invalid')
        if (!ping.ok) {
          await notify({
            kind: 'reconnect-youtube',
            title: 'YouTube needs reconnecting',
            body: `The daily channel ping failed: ${ping.error ?? 'unknown error'}`,
            href: '/settings?tab=connections',
          })
        }
        return ping
      })
    }

    if (token.mode === 'absent' || token.mode === 'dead') {
      return { outcome: token.mode === 'dead' ? 'needs-reconnect' : 'not-connected' } as const
    }

    // -----------------------------------------------------------------------
    // 2. Scheduled → live reconciliation
    // -----------------------------------------------------------------------

    const reconciled = await step.run('reconcile-live', async () => {
      const records = await videoBackedRecords(db)
      const pending = records.filter(
        (record) => record.status === 'scheduled' || record.status === 'uploaded',
      )
      if (pending.length === 0) return 0

      let flipped = 0
      if (token.mode === 'mock') {
        // Deterministic stand-in: a slot in the past means the video went out.
        const now = Date.now()
        for (const record of pending) {
          if (record.publishAt && record.publishAt.getTime() <= now) {
            await updatePublishRecord(db, record.id, { status: 'live' })
            flipped += 1
          }
        }
        return flipped
      }

      const statuses = await fetchPrivacyStatuses(
        token.accessToken,
        pending.map((record) => record.youtubeVideoId!),
      )
      for (const record of pending) {
        if (statuses.get(record.youtubeVideoId!) === 'public') {
          await updatePublishRecord(db, record.id, { status: 'live' })
          flipped += 1
        }
      }
      return flipped
    })

    // -----------------------------------------------------------------------
    // 3. Snapshots, one step per video — a video that errors retries alone
    // -----------------------------------------------------------------------

    const live = await step.run('list-live-videos', async () => {
      const records = await videoBackedRecords(db)
      return records
        .filter((record) => record.status === 'live')
        .map((record) => record.youtubeVideoId!)
    })

    for (const videoId of live) {
      await step.run(`snapshot-${videoId}`, async () => {
        const analytics =
          token.mode === 'mock'
            ? mockVideoAnalytics(videoId)
            : await fetchVideoAnalytics(token.accessToken, videoId)
        await upsertAnalyticsSnapshot(db, {
          videoId,
          date: utcToday(new Date()),
          retentionCurve: analytics.retentionCurve,
          ctrBySource: analytics.viewsBySource,
          views: analytics.views,
          avgViewDurationSec: analytics.avgViewDurationSec,
          // Needs the monetary scope the app never requested — see
          // lib/youtube-analytics.ts. Null beats a guess.
          rpm: null,
        })
      })
    }

    // -----------------------------------------------------------------------
    // 4. The Monday digest
    // -----------------------------------------------------------------------

    const digestSent = await step.run('weekly-digest', async () => {
      const now = new Date()
      if (now.getUTCDay() !== 1) return false

      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const [snapshots, labelled] = await Promise.all([
        snapshotsSince(db, weekAgo),
        scheduledPublishItems(db),
      ])
      if (snapshots.length === 0) return false

      const labelOf = new Map(
        labelled
          .filter((item) => item.youtubeVideoId !== null)
          .map((item) => [item.youtubeVideoId!, { label: item.label, type: item.targetType }]),
      )

      const byVideo = new Map<string, typeof snapshots>()
      for (const snapshot of snapshots) {
        const list = byVideo.get(snapshot.videoId) ?? []
        list.push(snapshot)
        byVideo.set(snapshot.videoId, list)
      }

      const lines: DigestLine[] = [...byVideo.entries()].map(([videoId, rows]) => {
        const first = rows[0]!
        const last = rows[rows.length - 1]!
        const sources = last.ctrBySource ?? {}
        const topSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        const named = labelOf.get(videoId)
        return {
          label: named?.label ?? videoId,
          targetType: named?.type ?? 'master',
          views: last.views,
          viewsDelta:
            last.views !== null && first.views !== null && rows.length > 1
              ? last.views - first.views
              : null,
          avgViewDurationSec: last.avgViewDurationSec,
          topSource,
          worstDropPct: worstRetentionDrop(last.retentionCurve),
        }
      })

      const weekOf = now.toISOString().slice(0, 10)
      let body: string
      if (mockProvidersEnabled()) {
        body = mockDigest({ weekOf, lines })
      } else {
        try {
          body = (await callLlm(buildDigestRequest({ weekOf, lines }))).text
        } catch (error) {
          // A digest is never worth a budget gate: the numbers keep landing
          // in snapshots, and next Monday tries again.
          if (error instanceof BudgetExceededError) {
            console.warn('[analytics] digest skipped — over budget')
            return false
          }
          throw error
        }
      }

      await notify({
        kind: 'weekly-digest',
        title: `Weekly digest · ${weekOf}`,
        body,
        href: '/',
      })
      return true
    })

    return {
      outcome: 'ran' as const,
      reconciled,
      snapshots: live.length,
      digestSent,
    }
  },
)
