import {
  approvedTalkingPointSet,
  deleteShorts,
  getProject,
  latestTimeline,
  listShorts,
  setProjectStage,
  shortForPoint,
} from '@boom-busters/db'
import { parseEventData, serialiseError, TimelineSchema } from '@boom-busters/schemas'
import { segmentInMaster } from '@boom-busters/timeline'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { inngest } from '../client'
import { events } from '../events'
import { markStageFailed } from '../lib/gates'

/**
 * shorts-runner: `project/master.ready` hands the Shorts stage to talking
 * points (playbook Shorts design 3.1 and 3.5). With no approved set it asks
 * the talking-points runner for a proposal, and that runner parks the stage
 * at `points`. With an approved set it requests one build per approved point
 * that has no Short yet and parks the stage at `review`.
 *
 * Re-entry (the master re-rendered, `master.ready` fired again): an approved
 * set means the stage never pauses at `points` again, a built Short is kept
 * exactly as curated and never re-bought, and only points with no Short are
 * built. Legacy `excerpt` and `teaser` rows are left as they are; the one
 * thing done to them is decision 300's clean-up of excerpts cut from an
 * earlier script, which can never render against the rebuilt master.
 */

const FUNCTION_ID = 'shorts-runner'

export const shortsRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Shorts',
    retries: 4,
    // One live run per project: a duplicate trigger cancels the run it
    // duplicates rather than stacking beside it (decision 233, amended).
    singleton: { key: 'event.data.projectId', mode: 'cancel' },
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await markStageFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        serialiseError(event.data.error),
      )
    },
    triggers: [events.projectMasterReady],
  },
  async ({ event, step }) => {
    const { projectId } = parseEventData('project/master.ready', event.data)

    const plan = await step.run('plan-shorts-stage', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      await setProjectStage(db, projectId, { stage: 'shorts', stageStatus: 'running' })

      // Decision 300: an excerpt cut from an earlier script points at
      // narration the rebuilt master no longer has and can never render.
      const timelineRow = await latestTimeline(db, projectId)
      const master = timelineRow ? TimelineSchema.safeParse(timelineRow.json) : null
      let replaced = 0
      if (master?.success) {
        const stale = (await listShorts(db, projectId)).filter(
          (row) => row.kind === 'excerpt' && !segmentInMaster(master.data, row.segmentRef),
        )
        await deleteShorts(
          db,
          stale.map((row) => row.id),
        )
        replaced = stale.length
      }

      const approved = await approvedTalkingPointSet(db, projectId)
      if (!approved) return { approved: false as const, replaced }

      const toBuild: string[] = []
      for (const point of approved.points) {
        if (!(await shortForPoint(db, projectId, point.id))) toBuild.push(point.id)
      }
      return { approved: true as const, replaced, toBuild, total: approved.points.length }
    })

    if (!plan.approved) {
      // The talking-points runner proposes and parks the stage at `points`.
      await step.sendEvent('request-talking-points', [
        events.shortsPointsRequested.create({ projectId, mode: 'all', note: null }),
      ])
      return { projectId, outcome: 'points-requested' as const, replaced: plan.replaced }
    }

    if (plan.toBuild.length > 0) {
      await step.sendEvent(
        'request-point-builds',
        plan.toBuild.map((pointId) =>
          events.shortsPointBuildRequested.create({ projectId, pointId }),
        ),
      )
    }

    await step.run('shorts-ready', () =>
      setProjectStage(db, projectId, {
        stage: 'shorts',
        stageStatus: 'awaiting_review',
        shortsPhase: 'review',
      }),
    )

    return {
      projectId,
      outcome:
        plan.toBuild.length > 0 ? ('builds-requested' as const) : ('reused-existing' as const),
      requested: plan.toBuild.length,
      kept: plan.total - plan.toBuild.length,
      replaced: plan.replaced,
    }
  },
)
