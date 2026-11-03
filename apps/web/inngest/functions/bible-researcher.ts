import {
  approvedScriptOpenings,
  getBibleDraft,
  getChannel,
  writeBibleDraft,
} from '@boom-busters/db'
import {
  buildResearchDigestRequest,
  mockProvidersEnabled,
  mockResearchDigest,
  parseResearchDigest,
} from '@boom-busters/providers'
import {
  TRANSCRIPT_CAP,
  VIDIQ_CREDIT_COST,
  VidiqError,
  transcriptOpening,
} from '@boom-busters/providers/vidiq'
import type { VidiqCall, VidiqClient, VidiqVideo } from '@boom-busters/providers/vidiq'
import { bibleDraftUnits, parseEventData } from '@boom-busters/schemas'
import type { BibleDraft, BibleDraftInputs, BibleResearchDigest } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import { OWN_LINES_LIMIT, researchPlanFor } from '@/lib/bible-research'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { spendVidiq } from '@/lib/vidiq-spend'
import { inngest } from '../client'
import { events } from '../events'

/**
 * bible-researcher: what a new channel's admired channels, videos and own
 * scripts have in common, as a short digest on the channel's bible draft.
 *
 * Each VidIQ call is a step of its own, and the step records the call's
 * credits in the ledger once the call has returned, so a restart between steps
 * neither repeats a call nor loses its cost. Only openings (the first minute of
 * four transcripts) reach the digest prompt, and only the digest is stored.
 *
 * The draft's `inputs` are read inside the first step; the event carries only
 * the channel.
 */

const FUNCTION_ID = 'bible-researcher'
const PURPOSE = 'bible-research' as const

/** Videos kept from each channel's list: the most viewed. */
const CHANNEL_VIDEOS_KEPT = 10
/** The digest names at most this many videos (its schema's own limit). */
const DIGEST_VIDEOS_MAX = 60

type KeptVideo = Pick<VidiqVideo, 'videoId' | 'title' | 'channel' | 'views'>

const keep = (video: VidiqVideo): KeptVideo => ({
  videoId: video.videoId,
  title: video.title,
  channel: video.channel,
  views: video.views,
})

const byViews = (a: KeptVideo, b: KeptVideo) => (b.views ?? -1) - (a.views ?? -1)

/**
 * One VidIQ call and its ledger row, for use inside one step (the shared
 * `spendVidiq`, charged to the channel and to no project).
 */
async function spend<T>(
  channelId: string,
  tool: string,
  cost: number,
  call: (client: VidiqClient) => Promise<VidiqCall<T>>,
): Promise<T> {
  const result = await spendVidiq({ channelId, purpose: PURPOSE, tool, cost }, call)
  return result.data
}

/**
 * Whether this run still owns the draft's job: the stored job began when the
 * run's job did. An event without a start (sent before runs carried one) owns
 * whatever job there is.
 */
function owns(draft: BibleDraft, jobStartedAt: string | undefined): boolean {
  return jobStartedAt === undefined || draft.job?.startedAt === jobStartedAt
}

/**
 * Refreshes the job's heartbeat at the start of a step, so a long run is not
 * taken as dead. A run that no longer owns the job stops before it spends.
 */
async function beat(channelId: string, jobStartedAt: string | undefined): Promise<void> {
  const lost = await writeBibleDraft(
    db,
    channelId,
    (draft) =>
      owns(draft, jobStartedAt) && draft.job
        ? { ...draft, job: { ...draft.job, heartbeatAt: new Date().toISOString() } }
        : draft,
    { allowWhileRunning: true },
  ).then((draft) => !owns(draft, jobStartedAt))
  if (lost) throw new NonRetriableError('A newer job has taken the draft; this research stops')
}

/**
 * Marks the draft's job failed with the reason; the owner sees it on the draft.
 * A run that no longer owns the job (a newer one started) leaves it alone.
 */
export async function failBibleResearch(
  channelId: string,
  message: string,
  jobStartedAt?: string,
): Promise<void> {
  try {
    await writeBibleDraft(
      db,
      channelId,
      (draft) =>
        owns(draft, jobStartedAt)
          ? {
              ...draft,
              job: {
                ...draft.job,
                kind: 'research',
                state: 'failed',
                current: null,
                error: message,
                startedAt: draft.job?.startedAt ?? new Date().toISOString(),
              },
            }
          : draft,
      { allowWhileRunning: true },
    )
  } catch (error) {
    console.error('[bible-researcher] could not record the failure', error)
  }
}

export const bibleResearcher = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Bible research',
    retries: 2,
    concurrency: [{ key: 'event.data.channelId', limit: 1 }],
    onFailure: async ({ event }) => {
      const channelId = event.data.event.data['channelId']
      if (typeof channelId !== 'string') return
      const jobStartedAt = event.data.event.data['jobStartedAt']
      await failBibleResearch(
        channelId,
        String(event.data.error?.message ?? 'Unknown error'),
        typeof jobStartedAt === 'string' ? jobStartedAt : undefined,
      )
    },
    triggers: [events.bibleResearchRequested],
  },
  async ({ event, step }) => {
    const { channelId, jobStartedAt } = parseEventData('bible/research.requested', event.data)

    const planned = await step.run('plan', async () => {
      const draft = await getBibleDraft(db, channelId)
      if (!draft?.inputs) throw new NonRetriableError('The draft has no inputs to research')
      const plan = await researchPlanFor(channelId, draft.inputs)
      if ('error' in plan) throw new NonRetriableError(plan.error)
      return { inputs: draft.inputs, plan, channelName: (await getChannel(db, channelId)).name }
    })
    const { plan, channelName } = planned
    const inputs: BibleDraftInputs = planned.inputs

    // The admired channels (and the own one): the most viewed videos of each.
    const lists: { own: boolean; ref: string; videos: KeptVideo[] }[] = []
    for (const [index, channel] of plan.channels.entries()) {
      const videos = await step.run(`channel-videos-${index}`, async () => {
        await beat(channelId, jobStartedAt)
        const found = await spend(
          channelId,
          'vidiq_channel_videos',
          VIDIQ_CREDIT_COST.channelVideos,
          (client) => client.channelVideos(channel.ref),
        )
        return found.map(keep).sort(byViews).slice(0, CHANNEL_VIDEOS_KEPT)
      })
      lists.push({ own: channel.own, ref: channel.ref, videos })
    }

    const named: KeptVideo[] =
      plan.videoIds.length === 0
        ? []
        : await step.run('videos-by-ids', async () => {
            await beat(channelId, jobStartedAt)
            const found = await spend(
              channelId,
              'vidiq_get_videos_by_ids',
              VIDIQ_CREDIT_COST.getVideosByIds,
              (client) => client.getVideosByIds(plan.videoIds),
            )
            return found.map(keep)
          })

    const outliers: KeptVideo[] = await step.run('outliers', async () => {
      await beat(channelId, jobStartedAt)
      const found = await spend(channelId, 'vidiq_outliers', VIDIQ_CREDIT_COST.outliers, (client) =>
        client.outliers({
          keyword: plan.outlierKeyword,
          ...(plan.language ? { language: plan.language } : {}),
        }),
      )
      return found.map(keep)
    })

    // Free: the channel's own approved scripts, as their first lines.
    const ownLines: string[] = await step.run('own-lines', () =>
      approvedScriptOpenings(db, channelId, OWN_LINES_LIMIT),
    )

    // The transcripts: the most viewed videos that are not the channel's own.
    const others = new Map<string, KeptVideo>()
    for (const video of [
      ...lists.filter((l) => !l.own).flatMap((l) => l.videos),
      ...named,
      ...outliers,
    ]) {
      if (!others.has(video.videoId)) others.set(video.videoId, video)
    }
    const wanted = [...others.values()].sort(byViews).slice(0, TRANSCRIPT_CAP)

    const openings: { videoId: string; text: string }[] = []
    for (const video of wanted) {
      const opening = await step.run(`transcript-${video.videoId}`, async () => {
        await beat(channelId, jobStartedAt)
        try {
          const transcript = await spend(
            channelId,
            'vidiq_video_transcript',
            VIDIQ_CREDIT_COST.videoTranscript,
            (client) =>
              client.videoTranscript({
                videoId: video.videoId,
                ...(plan.language ? { language: plan.language } : {}),
              }),
          )
          return transcriptOpening(transcript)
        } catch (error) {
          // A video without a transcript is a video without an opening, not a failed run.
          if (error instanceof VidiqError) return null
          throw error
        }
      })
      if (opening) openings.push({ videoId: video.videoId, text: opening })
    }

    const digest: BibleResearchDigest = await step.run('digest', async () => {
      await beat(channelId, jobStartedAt)
      if (mockProvidersEnabled()) return mockResearchDigest(inputs)

      const seen = new Set<string>()
      const videos: BibleResearchDigest['videos'] = []
      const add = (video: KeptVideo, own: boolean, channel: string) => {
        if (seen.has(video.videoId)) return
        seen.add(video.videoId)
        videos.push({
          videoId: video.videoId,
          channel: video.channel ?? channel,
          title: video.title,
          views: video.views,
          own,
        })
      }
      for (const list of lists) for (const video of list.videos) add(video, list.own, list.ref)
      for (const video of named) add(video, false, 'Unknown channel')
      for (const video of outliers) add(video, false, 'Unknown channel')

      const request = buildResearchDigestRequest({
        channelName,
        inputs,
        videos: videos.slice(0, DIGEST_VIDEOS_MAX),
        openings,
        ownLines,
      })
      const answer = await callForAnswer({
        request,
        parse: (text) => parseResearchDigest(text),
        // Charged to the channel, to no project.
        complete: (req, call) =>
          callLlm(req, { channelId, ...(call === 'answer' ? {} : { purpose: call }) }),
      })
      return answerOrStop(answer, 'The research digest could not be written')
    })

    const handOver = await step.run('save-digest', async () => {
      const startedAt = new Date().toISOString()
      let handedOver = false
      await writeBibleDraft(
        db,
        channelId,
        (draft) => {
          // A newer job took the draft meanwhile: it keeps it.
          if (!owns(draft, jobStartedAt)) return draft
          handedOver = true
          return {
            ...draft,
            research: digest,
            // The drafting run follows at once: keep the draft locked until it
            // takes over (a lost event frees it by the 30-minute stale rule).
            job: {
              kind: 'draft',
              state: 'running',
              current: null,
              error: null,
              startedAt,
              heartbeatAt: startedAt,
              units: bibleDraftUnits(),
            },
          }
        },
        { allowWhileRunning: true },
      )
      return handedOver ? { startedAt } : null
    })
    if (!handOver) return { outcome: 'superseded' as const }

    await step.sendEvent(
      'draft-requested',
      events.bibleDraftRequested.create({
        channelId,
        units: bibleDraftUnits(),
        jobStartedAt: handOver.startedAt,
      }),
    )

    return { outcome: 'researched' as const, videos: digest.videos.length }
  },
)
