#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { channelYoutubeToken, getChannelBySlug, videoBackedRecords } from '@boom-busters/db'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { optionalText, readRawFlags } from '@/lib/live-set-args'
import { refreshAccessToken } from '@/lib/youtube'

/**
 * A one-off, read-only probe of the two YouTube reports the search learning
 * feature will lean on (spec "Data pulled"). It makes four raw calls for one
 * published video and saves each response, unedited and including any error
 * body, to `docs/superpowers/specs/2026-11-09-search-learning-probe/`.
 *
 *   pnpm --filter @boom-busters/web probe:search-terms --channel <slug> [--video <youtubeVideoId>]
 *
 * It reads the owner's analytics (free, its own quota) and writes nothing to
 * the database: no verify stamps, no snapshots. Without `--video` it picks the
 * channel's newest live master publish record.
 */

const REPORTS_ENDPOINT = 'https://youtubeanalytics.googleapis.com/v2/reports'
const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos'
const LIFETIME_START = '2020-01-01'
const DAY_MS = 24 * 60 * 60 * 1000

const OUT_DIR = path.resolve(
  process.cwd(),
  '../../docs/superpowers/specs/2026-11-09-search-learning-probe',
)

interface RawCall {
  url: string
  status: number | null
  ok: boolean
  body: unknown
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** One GET, never throwing on a bad status: the body is the finding. */
async function rawGet(
  endpoint: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<RawCall> {
  const url = `${endpoint}?${new URLSearchParams(params).toString()}`
  try {
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // Not JSON: keep the text as it came.
    }
    return { url, status: response.status, ok: response.ok, body }
  } catch (error) {
    return {
      url,
      status: null,
      ok: false,
      body: { networkError: error instanceof Error ? error.message : String(error) },
    }
  }
}

function save(file: string, call: RawCall): void {
  writeFileSync(path.join(OUT_DIR, file), `${JSON.stringify(call, null, 2)}\n`, 'utf8')
  console.log(`${file}: ${call.status ?? 'no response'}${call.ok ? '' : ' (failed, saved anyway)'}`)
}

async function chooseVideo(channelId: string): Promise<string> {
  const records = await videoBackedRecords(db, channelId)
  const newest = records
    .filter((record) => record.targetType === 'master' && record.status === 'live')
    .sort((a, b) => (b.publishAt?.getTime() ?? 0) - (a.publishAt?.getTime() ?? 0))[0]
  if (!newest?.youtubeVideoId) throw new Error('This channel has no live master video to probe.')
  console.log(
    `Chose the newest live master: ${newest.youtubeVideoId} (publish record ${newest.id}, publishAt ${newest.publishAt?.toISOString() ?? 'unknown'})`,
  )
  return newest.youtubeVideoId
}

async function main(): Promise<void> {
  const raw = readRawFlags(process.argv.slice(2))
  const slug = optionalText(raw, 'channel')
  if (!slug) throw new Error('--channel <slug> is required.')
  const explicitVideo = optionalText(raw, 'video')

  const channel = await getChannelBySlug(db, slug)
  if (!channel) throw new Error(`No channel with the slug "${slug}".`)

  const videoId = explicitVideo ?? (await chooseVideo(channel.id))
  if (explicitVideo) console.log(`Using the video given: ${videoId}`)

  const refreshToken = await channelYoutubeToken(db, channel.id, env.SECRETS_ENCRYPTION_KEY)
  if (!refreshToken) throw new Error(`The channel "${slug}" has no stored YouTube connection.`)
  const { accessToken } = await refreshAccessToken(refreshToken)

  mkdirSync(OUT_DIR, { recursive: true })

  // Call 4 first: its publishedAt fixes the first-7-days range.
  const facts = await rawGet(
    VIDEOS_ENDPOINT,
    { part: 'status,snippet,contentDetails', id: videoId },
    accessToken,
  )
  save('04-video-facts.json', facts)

  const items = (facts.body as { items?: { snippet?: { publishedAt?: string } }[] }).items
  const publishedAt = items?.[0]?.snippet?.publishedAt
  const publishDay = publishedAt ? new Date(publishedAt) : null
  const today = isoDay(new Date())

  const searchParams = {
    ids: 'channel==MINE',
    dimensions: 'insightTrafficSourceDetail',
    filters: `video==${videoId};insightTrafficSourceType==YT_SEARCH`,
    metrics: 'views,estimatedMinutesWatched',
    sort: '-views',
    maxResults: '25',
  }

  save(
    '01-search-terms-lifetime.json',
    await rawGet(
      REPORTS_ENDPOINT,
      { ...searchParams, startDate: LIFETIME_START, endDate: today },
      accessToken,
    ),
  )

  if (!publishDay || Number.isNaN(publishDay.getTime())) {
    const skipped: RawCall = {
      url: '',
      status: null,
      ok: false,
      body: { skipped: 'The video facts gave no snippet.publishedAt, so no first-7-days range.' },
    }
    save('02-search-terms-first-7-days.json', skipped)
    save('03-totals-first-7-days.json', skipped)
    return
  }

  const startDate = isoDay(publishDay)
  const endDate = isoDay(new Date(publishDay.getTime() + 7 * DAY_MS))
  console.log(`First-7-days range: ${startDate} to ${endDate}`)

  save(
    '02-search-terms-first-7-days.json',
    await rawGet(REPORTS_ENDPOINT, { ...searchParams, startDate, endDate }, accessToken),
  )
  save(
    '03-totals-first-7-days.json',
    await rawGet(
      REPORTS_ENDPOINT,
      {
        ids: 'channel==MINE',
        filters: `video==${videoId}`,
        metrics: 'views,averageViewDuration,subscribersGained,likes,comments',
        startDate,
        endDate,
      },
      accessToken,
    ),
  )
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
