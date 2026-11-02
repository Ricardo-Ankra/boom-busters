import {
  approvedTalkingPointSet,
  channelForProject,
  getProject,
  isAssembledShort,
  latestTimeline,
  listProjectNotices,
  setProjectStage,
  shortForPoint,
} from '@boom-busters/db'
import {
  noticesFor,
  parseEventData,
  PointScriptRecordSchema,
  serialiseError,
  teaserTextHash,
  TimelineSchema,
} from '@boom-busters/schemas'
import type {
  NoticeTarget,
  PointFetchesRecord,
  PointPlanRecord,
  PointScriptRecord,
  PointVoiceRecord,
  TalkingPoint,
} from '@boom-busters/schemas'
import type { Repair } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { recordRepairs, recordSkip } from '@/lib/notices'
import { inngest } from '../client'
import { events } from '../events'
import { markStageFailed, type GateContext } from '../lib/gates'
import {
  assemblePointShort,
  BRIDGE_LABEL,
  fetchPendingShots,
  countNewPictures,
  planOrReusePointShots,
  savePointProgress,
  savePointShort,
  voiceOrReusePointParagraph,
  writeOrReusePointScript,
} from '../lib/point-build'
import type { PendingOutcome } from '../lib/point-build'

/**
 * point-short-runner (playbook Shorts design 3.4): `shorts/point.build.requested`
 * builds one approved talking point into a `point` Short: its script, its
 * voice, its shot plan, its new pictures, then the compiled master on a new
 * row and a render request. One run per point; two run at a time and never
 * two for one point (`concurrency`, since `skip` is banned and a cancel would
 * throw away paid work).
 *
 * A point that already has a row is never rebuilt or re-bought: the event
 * then does nothing. A Short whose script is refused twice, whose voice or
 * plan cannot be made, or whose build fails past its retries, is skipped with
 * its reason on a `short` notice (subjectId is the point's id until a row
 * exists) and the others carry on. A budget refusal parks the stage, as every
 * paid step does.
 *
 * Every step computes what it needs itself: Inngest replays a finished step's
 * result to a run parked before a deploy, so nothing a later step relies on is
 * read outside a step.
 */

const FUNCTION_ID = 'point-short-runner'

/**
 * The stage is ready for review once every approved point has a Short or a
 * recorded skip. A project the owner has already left the Shorts stage is not
 * touched.
 */
async function settleStage(projectId: string): Promise<boolean> {
  const project = await getProject(db, projectId)
  if (project?.stage !== 'shorts') return false
  const approved = await approvedTalkingPointSet(db, projectId)
  if (!approved) return false
  const open = await listProjectNotices(db, projectId)
  for (const point of approved.points) {
    const row = await shortForPoint(db, projectId, point.id)
    if (row && isAssembledShort(row)) continue
    const stopped = noticesFor(open, 'short', point.id).some(
      (notice) => notice.kind === 'skipped' || notice.kind === 'stopped',
    )
    if (!stopped) return false
  }
  await setProjectStage(db, projectId, {
    stage: 'shorts',
    stageStatus: 'awaiting_review',
    shortsPhase: 'review',
  })
  return true
}

type Loaded =
  | { state: 'exists'; shortId: string }
  | { state: 'unknown' }
  | { state: 'build'; point: TalkingPoint }

export const pointShortRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Point Short',
    retries: 3,
    // Two builds at a time, and one per point. Not a singleton: `skip` is
    // banned (a cancelled run keeps its lock) and `cancel` would throw away
    // paid work. A duplicate event queues behind the first and then finds the
    // row it made.
    concurrency: [{ limit: 2 }, { key: 'event.data.pointId', limit: 1 }],
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      const pointId = event.data.event.data['pointId']
      if (typeof projectId !== 'string' || typeof pointId !== 'string') return
      await recordSkip(
        { projectId, subject: 'short', subjectId: pointId },
        `The Short was skipped: its build stopped: ${String(serialiseError(event.data.error).message ?? 'unknown')}`,
      )
      await settleStage(projectId).catch(() => false)
    },
    triggers: [events.shortsPointBuildRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, pointId } = parseEventData('shorts/point.build.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }
    const target: NoticeTarget = { projectId, subject: 'short', subjectId: pointId }

    const loaded = await step.run('load-point', async (): Promise<Loaded> => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      const existing = await shortForPoint(db, projectId, pointId)
      // Only an assembled Short is done; a draft (a build cut off after its
      // script or voice) is resumed from what it holds, never rebought.
      if (existing && isAssembledShort(existing)) return { state: 'exists', shortId: existing.id }
      const point = (await approvedTalkingPointSet(db, projectId))?.points.find(
        (candidate) => candidate.id === pointId,
      )
      return point ? { state: 'build', point } : { state: 'unknown' }
    })

    if (loaded.state === 'exists') {
      return { projectId, pointId, outcome: 'exists' as const, shortId: loaded.shortId }
    }
    if (loaded.state === 'unknown') {
      return { projectId, pointId, outcome: 'unknown-point' as const }
    }
    const { point } = loaded

    const overBudget = async (name: string, gate: Record<string, unknown>) => {
      await step.run(name, () => markStageFailed(ctx, gate))
      return { projectId, pointId, outcome: 'over-budget' as const }
    }
    const skip = async (reason: string) => {
      await step.run('point-skipped', async () => {
        await recordSkip(target, `The Short "${point.title}" was skipped: ${reason}`)
        await settleStage(projectId)
      })
      return { projectId, pointId, outcome: 'skipped' as const, reason }
    }

    // -----------------------------------------------------------------------
    // Script
    // -----------------------------------------------------------------------
    const written = await step.run('write-script', () => writeOrReusePointScript(projectId, point))
    if (!written.ok && 'gate' in written) return overBudget('script-over-budget', written.gate)
    if (!written.ok) return skip(written.skipped)

    // -----------------------------------------------------------------------
    // Voice: one paragraph a step, so a retry re-serves what was already bought
    // -----------------------------------------------------------------------
    const voice: PointVoiceRecord = { scriptVersion: written.scriptVersion, paragraphs: [] }
    for (const [index, paragraph] of written.script.paragraphs.entries()) {
      const spoken = await step.run(`tts-${index}`, () =>
        voiceOrReusePointParagraph({
          projectId,
          pointId,
          scriptVersion: written.scriptVersion,
          index,
          text: paragraph.text,
        }),
      )
      if (!spoken.ok && 'gate' in spoken) return overBudget('tts-over-budget', spoken.gate)
      if (!spoken.ok) return skip(spoken.skipped)
      voice.paragraphs.push({
        textHash: teaserTextHash(paragraph.text),
        r2Key: spoken.r2Key,
        durationMs: spoken.durationMs,
        wordTimings: spoken.wordTimings,
      })
    }

    // -----------------------------------------------------------------------
    // Shot plan
    // -----------------------------------------------------------------------
    const planned = await step.run('plan-shots', async () => {
      const row = await latestTimeline(db, projectId)
      if (!row) throw new NonRetriableError('There is no compiled master timeline to plan from.')
      return planOrReusePointShots(projectId, pointId, {
        script: written.script,
        voice,
        master: TimelineSchema.parse(row.json),
        sourceChapters: point.sourceChapters,
        note: null,
      })
    })
    if (!planned.ok && 'gate' in planned) return overBudget('plan-over-budget', planned.gate)
    if (!planned.ok) return skip(planned.skipped)

    // -----------------------------------------------------------------------
    // New pictures: each its own step, so a paid still is never bought twice
    // -----------------------------------------------------------------------
    const fetched = await fetchPendingShots(
      projectId,
      planned.plan,
      (name, fn) => step.run(name, fn) as Promise<PendingOutcome>,
    )
    if (!fetched.ok && 'gate' in fetched) return overBudget('fetch-over-budget', fetched.gate)
    if (!fetched.ok) return skip(fetched.skipped)
    const hadPending = planned.plan.shots.some((shot) => shot.pending !== null)
    if (hadPending) {
      await step.run('save-fetched', () =>
        savePointProgress({
          projectId,
          pointId,
          plan: fetched.plan,
          fetches: fetched.fetches,
        }),
      )
    }
    // A reused plan has no pending shots; its pictures come from the stored pool.
    const fetchesUsed = hadPending ? fetched.fetches : (planned.fetches ?? fetched.fetches)

    // -----------------------------------------------------------------------
    // Assemble and store
    // -----------------------------------------------------------------------
    const assembled = await step.run('assemble', async () => {
      const row = await latestTimeline(db, projectId)
      if (!row)
        throw new NonRetriableError('There is no compiled master timeline to assemble from.')
      const channel = await channelForProject(db, projectId)
      const script: PointScriptRecord = PointScriptRecordSchema.parse({
        ...written.script,
        scriptVersion: written.scriptVersion,
        pointId,
      })
      const plan: PointPlanRecord = fetched.plan
      const fetches: PointFetchesRecord = fetchesUsed
      const { timeline, findings } = assemblePointShort({
        master: TimelineSchema.parse(row.json),
        script,
        voice,
        plan,
        bridge: {
          label: BRIDGE_LABEL,
          channelName: channel.name,
          handle: channel.handle ?? '',
        },
        newImageCount: hadPending ? fetched.fetched : countNewPictures(plan, fetches),
      })
      const saved = await savePointShort({
        projectId,
        pointId,
        script,
        voice,
        plan,
        fetches,
        timeline,
      })

      // What the script's and plan's repairs trimmed, and which new pictures
      // could not be had, on the Short's own card; the skip note an earlier
      // attempt left on the point is retired now there is a row.
      const repairs: Repair[] = [...written.repairs, ...planned.repairs, ...fetched.repairs]
      await recordRepairs({ projectId, subject: 'short', subjectId: saved.shortId }, repairs)
      await recordRepairs(target, [])
      return { shortId: saved.shortId, findings: findings.length }
    })

    await step.sendEvent('request-render', [
      events.shortsRenderRequested.create({ projectId, shortId: assembled.shortId }),
    ])

    const ready = await step.run('settle-stage', () => settleStage(projectId))

    return {
      projectId,
      pointId,
      outcome: 'built' as const,
      shortId: assembled.shortId,
      findings: assembled.findings,
      stageReady: ready,
    }
  },
)
