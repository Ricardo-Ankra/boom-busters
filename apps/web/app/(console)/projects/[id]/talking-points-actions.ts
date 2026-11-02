'use server'

import {
  approveTalkingPointSet,
  claimShortsCheckpoint,
  getProject,
  hasLiveRun,
  insertTalkingPointSet,
  latestTalkingPointSet,
} from '@boom-busters/db'
import { SHORT_RULES, UlidSchema } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { events } from '@/inngest/events'
import { inngest } from '@/inngest/client'
import { db } from '@/lib/db'
import { TALKING_POINTS_RUNNER } from '@/lib/talking-points-review'

/**
 * The Talking points screen's actions (playbook Shorts design 3.3): approve a
 * set, ask for the whole set or one point to be redone, add a point, remove
 * one. Only the first four spend; a removal writes a new version directly.
 *
 * The runner queues per project instead of cancelling, so a second request
 * would be a second paid call. Every action that would send one therefore
 * refuses first while a `talking-points-runner` run is live.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

const ALREADY_REDOING = 'Talking points are already being redone.'
const INNGEST_UNREACHABLE = 'Could not reach Inngest to redo the talking points.'

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

function refresh(projectId: string): void {
  revalidatePath(`/projects/${projectId}`)
}

/** The note as the runner takes it: trimmed, and null when nothing was written. */
function noteOf(note: string): string | null {
  const trimmed = note.trim()
  return trimmed === '' ? null : trimmed
}

async function runnerIsLive(projectId: string): Promise<boolean> {
  return hasLiveRun(db, projectId, { functionName: TALKING_POINTS_RUNNER })
}

export async function approveTalkingPoints(
  projectId: string,
  version: number,
): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(projectId).success) return { ok: false, error: 'Unknown project' }
  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }
  if (project.stage !== 'shorts' || project.shortsPhase !== 'points') {
    return { ok: false, error: 'These talking points are not waiting for approval.' }
  }
  if (project.stageStatus === 'running' || (await runnerIsLive(projectId))) {
    return {
      ok: false,
      error: 'Talking points are being redone. Approve once the new set appears.',
    }
  }

  // Win the points to review transition before anything is stamped or sent:
  // a second approval arriving together loses here and sends nothing.
  const won = await claimShortsCheckpoint(db, projectId, {
    from: { shortsPhase: 'points', stageStatus: 'awaiting_review' },
    to: { shortsPhase: 'review', stageStatus: 'running' },
  })
  if (!won) return { ok: false, error: 'These talking points are already being approved.' }
  const backToPoints = () =>
    claimShortsCheckpoint(db, projectId, {
      from: { shortsPhase: 'review', stageStatus: 'running' },
      to: { shortsPhase: 'points', stageStatus: 'awaiting_review' },
    })

  const outcome = await approveTalkingPointSet(db, projectId, version)
  if (outcome === 'stale') {
    await backToPoints()
    return {
      ok: false,
      error: 'A newer set of talking points exists. Review it before approving.',
    }
  }
  if (outcome === 'missing') {
    await backToPoints()
    return { ok: false, error: 'That set of talking points no longer exists.' }
  }

  const set = await latestTalkingPointSet(db, projectId)
  const points = set?.points ?? []
  try {
    await inngest.send(
      points.map((point) =>
        events.shortsPointBuildRequested.create({ projectId, pointId: point.id }),
      ),
    )
  } catch (error) {
    console.error('[talking-points] could not send the builds', error)
    // Back to where the owner can press Approve again.
    await backToPoints()
    return { ok: false, error: 'Could not reach Inngest to start building the Shorts.' }
  }
  refresh(projectId)
  return { ok: true }
}

type PointsRequest =
  | { mode: 'all'; note: string | null }
  | { mode: 'one'; pointId: string; note: string | null }
  | { mode: 'add'; note: string | null }

async function requestPoints(projectId: string, request: PointsRequest): Promise<ActionResult> {
  if (await runnerIsLive(projectId)) return { ok: false, error: ALREADY_REDOING }
  // The run mirror only shows a run seconds after `send`, so the guard that
  // closes the gap is this compare-and-set: one press wins `awaiting_review`
  // to `running`, and a second finds nothing to claim. The runner sets
  // `running` itself at its start and `awaiting_review` when it parks.
  const claimed = await claimShortsCheckpoint(db, projectId, {
    from: { shortsPhase: 'points', stageStatus: 'awaiting_review' },
    to: { shortsPhase: 'points', stageStatus: 'running' },
  })
  if (!claimed) return { ok: false, error: ALREADY_REDOING }
  try {
    await inngest.send(events.shortsPointsRequested.create({ projectId, ...request }))
  } catch (error) {
    console.error('[talking-points] could not send the request', error)
    await claimShortsCheckpoint(db, projectId, {
      from: { shortsPhase: 'points', stageStatus: 'running' },
      to: { shortsPhase: 'points', stageStatus: 'awaiting_review' },
    })
    return { ok: false, error: INNGEST_UNREACHABLE }
  }
  refresh(projectId)
  return { ok: true }
}

async function ownedProject(projectId: string) {
  if (!UlidSchema.safeParse(projectId).success) return undefined
  return getProject(db, projectId)
}

export async function redoTalkingPoints(projectId: string, note: string): Promise<ActionResult> {
  await requireOwner()
  if (!(await ownedProject(projectId))) return { ok: false, error: 'Unknown project' }
  return requestPoints(projectId, { mode: 'all', note: noteOf(note) })
}

export async function redoTalkingPoint(
  projectId: string,
  pointId: string,
  note: string,
): Promise<ActionResult> {
  await requireOwner()
  if (!(await ownedProject(projectId))) return { ok: false, error: 'Unknown project' }
  const latest = await latestTalkingPointSet(db, projectId)
  if (!latest?.points.some((point) => point.id === pointId)) {
    return { ok: false, error: 'That talking point is no longer in the set.' }
  }
  // The live-run refusal comes first inside `requestPoints`, so a redo and an
  // add pressed together cannot both pass this read and both be paid for.
  return requestPoints(projectId, { mode: 'one', pointId, note: noteOf(note) })
}

export async function addTalkingPoint(projectId: string, note: string): Promise<ActionResult> {
  await requireOwner()
  if (!(await ownedProject(projectId))) return { ok: false, error: 'Unknown project' }
  const latest = await latestTalkingPointSet(db, projectId)
  if (latest && latest.points.length >= SHORT_RULES.pointsMax) {
    return {
      ok: false,
      error:
        `There are already ${latest.points.length} talking points, the most allowed. ` +
        'Remove one first.',
    }
  }
  return requestPoints(projectId, { mode: 'add', note: noteOf(note) })
}

export async function removeTalkingPoint(
  projectId: string,
  pointId: string,
): Promise<ActionResult> {
  await requireOwner()
  if (!(await ownedProject(projectId))) return { ok: false, error: 'Unknown project' }
  // A removal writes a version too, so it must not race the runner's.
  const project = await ownedProject(projectId)
  if (
    (await runnerIsLive(projectId)) ||
    (project?.shortsPhase === 'points' && project.stageStatus === 'running')
  ) {
    return { ok: false, error: ALREADY_REDOING }
  }

  const latest = await latestTalkingPointSet(db, projectId)
  const removed = latest?.points.find((point) => point.id === pointId)
  if (!latest || !removed)
    return { ok: false, error: 'That talking point is no longer in the set.' }
  if (latest.points.length <= SHORT_RULES.pointsMin) {
    return {
      ok: false,
      error:
        `A set needs at least ${SHORT_RULES.pointsMin} talking points. ` +
        'Redo one instead of removing it.',
    }
  }

  // Keep the owner's order, closed up so it still reads 1, 2, 3.
  const kept = latest.points
    .filter((point) => point.id !== pointId)
    .sort((a, b) => a.order - b.order)
    .map((point, index) => ({ ...point, order: index + 1 }))
  await insertTalkingPointSet(db, {
    projectId,
    scriptVersion: latest.scriptVersion,
    points: kept,
    note: `Removed: ${removed.title}`,
  })
  refresh(projectId)
  return { ok: true }
}
