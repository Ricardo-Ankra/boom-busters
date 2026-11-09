import { VIDIQ_CREDIT_COST, VidiqError } from '@boom-busters/providers/vidiq'
import type { VidiqComment } from '@boom-busters/providers/vidiq'
import type { FieldCheck, NicheTest } from '@boom-busters/schemas'
import { spendVidiq, VidiqCapReached, withVidiqClient } from '@/lib/vidiq-spend'

/**
 * The evidence a case research run buys through VidIQ: who ranks for a
 * keyword, the comments on a winning video, and a niche test of an angle.
 * Each helper makes exactly one purchase or none, so a caller can wrap each
 * in its own Inngest step. VidIQ's text is data; nothing here acts on it.
 */

/** How a skipped check is recorded when the monthly cap refused it. */
export const CAP_REACHED = 'credit cap'

/** The spend path's cap refusal, exported for the run to catch and record as a skip. */
export { VidiqCapReached as CapReached }

const PURPOSE = 'case-research' as const
const FIELD_MAX = 10

export async function searchField(keyword: string, channelId: string): Promise<FieldCheck> {
  const { data } = await spendVidiq(
    {
      channelId,
      purpose: PURPOSE,
      tool: 'vidiq_youtube_search',
      cost: VIDIQ_CREDIT_COST.youtubeSearch,
    },
    (client) => client.youtubeSearch(keyword),
  )
  return {
    keyword,
    checkedAt: new Date().toISOString(),
    results: data.slice(0, FIELD_MAX).map((r) => ({
      videoId: r.videoId,
      title: r.title,
      channelTitle: r.channelTitle,
      subscribers: r.subscribers,
      views: r.views,
      publishedAt: r.publishedAt,
      seconds: r.seconds,
    })),
  }
}

/** How far down a search the rank check looks. */
const RANK_DEPTH = 10

/**
 * Where a video stands in a YouTube search for one keyword: its 1-based place
 * among the first 10 results, or null when it is not there. One purchase.
 */
export async function rankFor(
  keyword: string,
  videoId: string,
  channelId: string,
): Promise<number | null> {
  const { data } = await spendVidiq(
    {
      channelId,
      purpose: 'search-report',
      tool: 'vidiq_youtube_search',
      cost: VIDIQ_CREDIT_COST.youtubeSearch,
    },
    (client) => client.youtubeSearch(keyword),
  )
  const at = data.slice(0, RANK_DEPTH).findIndex((result) => result.videoId === videoId)
  return at < 0 ? null : at + 1
}

/** Comments on one video, without the creator's own words: they are not the audience. */
export async function readComments(
  videoId: string,
  channelId: string,
): Promise<(VidiqComment & { videoId: string })[]> {
  const { data } = await spendVidiq(
    {
      channelId,
      purpose: PURPOSE,
      tool: 'vidiq_video_comments',
      cost: VIDIQ_CREDIT_COST.videoComments,
    },
    (client) => client.videoComments(videoId),
  )
  return data.filter((c) => !c.byOwner).map((c) => ({ ...c, videoId }))
}

/** Starts a niche test and returns its job id; `awaitNicheTest` collects it. */
export async function startNicheTest(
  args: { niche: string; idea: string; language?: string },
  channelId: string,
): Promise<string> {
  const { data } = await spendVidiq(
    {
      channelId,
      purpose: PURPOSE,
      tool: 'vidiq_comment_insights',
      cost: VIDIQ_CREDIT_COST.commentInsights,
    },
    (client) => client.commentInsightsValidate(args),
  )
  return data.jobId
}

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** The completed job's result is a guess at a shape, so every field is read tolerantly. */
function nicheTestOf(angle: string, raw: unknown): NicheTest {
  const result = record(raw)
  const verdict = text(result['verdict']) ?? text(result['summary']) ?? 'No verdict returned'
  const items = Array.isArray(result['directEvidence'])
    ? result['directEvidence']
    : Array.isArray(result['evidence'])
      ? result['evidence']
      : []
  const evidence = items.flatMap((item) => {
    const e = record(item)
    const line = text(e['summary']) ?? text(e['text']) ?? text(e['quote'])
    if (line === null) return []
    const count = e['threadCount'] ?? e['count']
    return [{ text: line.slice(0, 200), count: typeof count === 'number' ? count : null }]
  })
  const notes = result['notes']
  const notesText = Array.isArray(notes)
    ? notes.filter((n): n is string => typeof n === 'string').join(' ')
    : (text(notes) ?? '')
  return {
    angle,
    verdict: verdict.slice(0, 300),
    direct: evidence.length > 0,
    evidence: evidence.slice(0, 3),
    notes: notesText.slice(0, 500),
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Where a niche job stands after the wait: done, still running at VidIQ, or failed for good. */
export type NicheWait =
  { state: 'done'; test: NicheTest } | { state: 'running' } | { state: 'failed' }

/**
 * Polls the niche job until it finishes. `running` when there was no answer in
 * time (the job is paid for and may yet finish); `failed` for a failed or
 * expired job, a poll error or an unknown status. Polls cost nothing and are
 * not recorded; one client serves the whole wait.
 */
export async function awaitNicheTest(
  jobId: string,
  angle: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<NicheWait> {
  const { timeoutMs = 90_000, intervalMs = 5_000 } = options
  return withVidiqClient(async (client): Promise<NicheWait> => {
    let waited = 0
    for (;;) {
      let state
      try {
        state = (await client.jobPoll(jobId)).data
      } catch (error) {
        if (error instanceof VidiqError) return { state: 'failed' }
        throw error
      }
      if (state.status === 'completed')
        return { state: 'done', test: nicheTestOf(angle, state.result) }
      if (state.status !== 'inprogress') return { state: 'failed' }
      if (waited + intervalMs > timeoutMs) return { state: 'running' }
      await sleep(intervalMs)
      waited += intervalMs
    }
  })
}
