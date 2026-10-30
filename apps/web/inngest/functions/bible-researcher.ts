import {
  approvedScriptOpenings,
  getBibleDraft,
  getChannel,
  getWorkspace,
  recordVidiqCredits,
  vidiqCredential,
  vidiqCreditsThisMonth,
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
  vidiqClientFor,
} from '@boom-busters/providers/vidiq'
import type { VidiqCall, VidiqClient, VidiqVideo } from '@boom-busters/providers/vidiq'
import { bibleDraftUnits, parseEventData } from '@boom-busters/schemas'
import type { BibleDraftInputs, BibleResearchDigest } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import { OWN_LINES_LIMIT, researchPlanFor } from '@/lib/bible-research'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { callLlm } from '@/lib/llm'
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
const PURPOSE = 'bible-research'

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

async function openClient(): Promise<VidiqClient> {
  const apiKey = await vidiqCredential(db, env.SECRETS_ENCRYPTION_KEY)
  const client = vidiqClientFor(apiKey)
  if (!client) throw new NonRetriableError('There is no VidIQ key to research with')
  return client
}

/**
 * One VidIQ call and its ledger row, for use inside one step. The monthly cap
 * is checked first; the row is written after the call returns, so a call that
 * threw is never charged.
 */
async function spend<T>(
  channelId: string,
  tool: string,
  args: Record<string, unknown>,
  cost: number,
  call: (client: VidiqClient) => Promise<VidiqCall<T>>,
): Promise<T> {
  const client = await openClient()
  try {
    const [{ settings }, spent] = await Promise.all([getWorkspace(db), vidiqCreditsThisMonth(db)])
    const cap = settings.vidiq.monthlyCreditCap
    if (spent + cost > cap) {
      throw new NonRetriableError(
        `The VidIQ cap is reached: ${spent} of ${cap} credits used this month`,
      )
    }
    const result = await call(client)
    await recordVidiqCredits(db, {
      channelId,
      purpose: PURPOSE,
      tool,
      args,
      credits: result.credits,
    })
    return result.data
  } finally {
    await client.close()
  }
}

/** Marks the draft's job failed with the reason; the owner sees it on the draft. */
export async function failBibleResearch(channelId: string, message: string): Promise<void> {
  try {
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({
        ...draft,
        job: {
          kind: 'research',
          state: 'failed',
          current: null,
          error: message,
          startedAt: draft.job?.startedAt ?? new Date().toISOString(),
        },
      }),
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
      await failBibleResearch(channelId, String(event.data.error?.message ?? 'Unknown error'))
    },
    triggers: [events.bibleResearchRequested],
  },
  async ({ event, step }) => {
    const { channelId } = parseEventData('bible/research.requested', event.data)

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
        const found = await spend(
          channelId,
          'vidiq_channel_videos',
          { channel: channel.ref },
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
            const found = await spend(
              channelId,
              'vidiq_get_videos_by_ids',
              { ids: plan.videoIds },
              VIDIQ_CREDIT_COST.getVideosByIds,
              (client) => client.getVideosByIds(plan.videoIds),
            )
            return found.map(keep)
          })

    const outliers: KeptVideo[] = await step.run('outliers', async () => {
      const found = await spend(
        channelId,
        'vidiq_outliers',
        { keyword: plan.outlierKeyword, ...(plan.language ? { language: plan.language } : {}) },
        VIDIQ_CREDIT_COST.outliers,
        (client) =>
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
        try {
          const transcript = await spend(
            channelId,
            'vidiq_video_transcript',
            { videoId: video.videoId, ...(plan.language ? { language: plan.language } : {}) },
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

    await step.run('save-digest', async () => {
      await writeBibleDraft(
        db,
        channelId,
        (draft) => ({
          ...draft,
          research: digest,
          job: {
            kind: 'research',
            state: 'done',
            current: null,
            error: null,
            startedAt: draft.job?.startedAt ?? new Date().toISOString(),
          },
        }),
        { allowWhileRunning: true },
      )
    })

    await step.sendEvent(
      'draft-requested',
      events.bibleDraftRequested.create({ channelId, units: bibleDraftUnits() }),
    )

    return { outcome: 'researched' as const, videos: digest.videos.length }
  },
)
