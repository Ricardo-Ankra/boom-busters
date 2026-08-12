'use server'

import {
  PIPELINE_STAGES,
  blockingClaims,
  cancelRunsForProject,
  deleteProject,
  getDossier,
  getLatestScript,
  getProject,
  hasLiveRun,
  markProjectCancelled,
  projectDeletionSummary,
  setProjectStage,
} from '@boom-busters/db'
import { voiceGateBlockedReason } from '@/lib/voice-review'
import type { ProjectStage } from '@boom-busters/db'
import { GateStageSchema, ProviderSchema, UlidSchema } from '@boom-busters/schemas'
import type { GateStage } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { events } from '@/inngest/events'
import { inngest } from '@/inngest/client'
import { db } from '@/lib/db'

/**
 * The buttons that drive a run (build spec section 11.1: every action is a
 * visible, labelled button).
 *
 * Each action is a POST endpoint in its own right, so each re-checks the
 * session rather than trusting `proxy.ts`, and each validates its arguments
 * with the same Zod schema the Inngest function will validate them with.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!email) throw new Error('Not signed in')
  return email
}

function badId(projectId: string): ActionResult | null {
  return UlidSchema.safeParse(projectId).success ? null : { ok: false, error: 'Unknown project' }
}

/**
 * Send an event, turning an unreachable orchestrator into a message rather
 * than a 500.
 *
 * Locally that means the Inngest Dev Server is not running; in production it
 * means Inngest is down or the keys are wrong. Either way the honest thing is
 * to say so on the button the user just pressed.
 */
async function send(
  event: Parameters<typeof inngest.send>[0],
  what: string,
): Promise<ActionResult> {
  try {
    await inngest.send(event)
    return { ok: true }
  } catch (error) {
    console.error(`[projects] could not send ${what}`, error)
    return {
      ok: false,
      error:
        `Could not reach Inngest to ${what}. ` +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
}

function refresh(projectId: string): void {
  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
  revalidatePath('/costs')
}

// ---------------------------------------------------------------------------
// Restarting
// ---------------------------------------------------------------------------

/**
 * Run the current stage again.
 *
 * There is deliberately no "start" action. Research begins when the project is
 * created and every later stage begins when the one before it is approved, so
 * the only thing a human ever needs is a way back from a stage that stopped —
 * a failure, a Stop, or a project stranded at a review with no run behind it.
 *
 * This replaces `startDemoPipeline`, which was M2 scaffolding and outlived its
 * purpose badly. It was the only button on the project screen, so it read as
 * *the* way to start a project; pressing it reset the stage and started the
 * no-op demo pipeline **alongside** the real dossier run. The demo then opened
 * and closed genuine review gates on a genuine project, and approving one of
 * its fake gates sent `gate/dossier.approved` to the script runner with no
 * dossier written — which is exactly the "The dossier is gone, so there is
 * nothing to script from" failure in the production run mirror.
 */
export async function restartStage(projectId: string, stage?: string): Promise<ActionResult> {
  const approvedBy = await requireOwner()
  const invalid = badId(projectId)
  if (invalid) return invalid

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }

  /**
   * Which stage to re-run, defaulting to the one the project is on.
   *
   * Taking it as an argument is what makes going *back* possible. Without it a
   * project that had reached `script` could only ever re-run the script: its
   * dossier — the research the narration was written from — was unreachable,
   * which is half of why the rail needed to be navigable at all.
   */
  const target = stage ?? project.stage
  if (!PIPELINE_STAGES.includes(target as ProjectStage)) {
    return { ok: false, error: `Unknown stage "${target}"` }
  }
  if (PIPELINE_STAGES.indexOf(target as ProjectStage) > PIPELINE_STAGES.indexOf(project.stage)) {
    // Re-running a stage the project has not reached would run it on inputs
    // that do not exist yet.
    return { ok: false, error: `This project has not reached the ${target} stage yet.` }
  }

  // A second run would race the first over the same stage columns. The mirror
  // is what knows, not `stageStatus`: a project left at `awaiting_review` with
  // no run behind it must still be restartable.
  if (await hasLiveRun(db, projectId)) {
    return {
      ok: false,
      error: 'This project already has a run in flight. Stop it first if you want to start over.',
    }
  }

  /**
   * A stage cannot be re-run without the thing it is run *from*.
   *
   * The script runner's first step loads the dossier and gives up if there
   * isn't one. Re-running `script` on a project with no dossier therefore fails
   * every time, and the production run mirror shows exactly that: a
   * `script`/`failed` project with no dossier row, restarted from this action,
   * dying on `load-dossier` with "The dossier is gone, so there is nothing to
   * script from." A button that can only fail should not be a button.
   */
  if (target === 'script' && !(await getDossier(db, projectId))) {
    return {
      ok: false,
      error:
        'There is no dossier to write this script from. Run the dossier stage first — the ' +
        'script is written from its claims.',
    }
  }

  // The same rule one stage down: narration is read from the script.
  if (target === 'voice' && !(await getLatestScript(db, projectId))) {
    return {
      ok: false,
      error:
        'There is no script to narrate. Run the script stage first — the narration is read from ' +
        'its chapters.',
    }
  }

  /**
   * Re-entering a stage means re-sending the event its runner triggers on.
   * Only these three have runners; anything else would send an event nothing
   * is subscribed to, report success, and do nothing.
   */
  const entry =
    target === 'dossier'
      ? events.projectCreated.create({ projectId, caseId: project.caseId })
      : target === 'script'
        ? events.dossierApproved.create({ projectId, approvedBy })
        : target === 'voice'
          ? events.scriptApproved.create({ projectId, approvedBy })
          : null

  if (!entry) {
    return {
      ok: false,
      error: `The ${target} stage has no runner yet, so there is nothing to restart.`,
    }
  }

  /**
   * The project moves back to the stage being re-run.
   *
   * Downstream work is deliberately left where it is (decision, PROGRESS.md
   * M3.2): the old script stays in the database and stays readable, and the
   * version stamp it carries is what makes the rail show it as built from
   * research that has since been replaced. Deleting it here would make a
   * mis-click destroy work that was paid for.
   */
  await setProjectStage(db, projectId, {
    stage: target as ProjectStage,
    stageStatus: 'queued',
    inngestRunId: null,
    // The stop this is recovering from is over. Left in place it would keep
    // every screen calling a running project cancelled.
    cancelledAt: null,
  })

  const sent = await send(entry, 'restart the stage')

  refresh(projectId)
  return sent
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

const GATE_EVENT = {
  dossier: events.dossierApproved,
  script: events.scriptApproved,
  voice: events.voiceApproved,
  visuals: events.visualsApproved,
  preview: events.previewApproved,
} as const satisfies Record<GateStage, unknown>

const CHANGES_EVENT = {
  dossier: events.dossierChangesRequested,
  script: events.scriptChangesRequested,
  voice: events.voiceChangesRequested,
  visuals: events.visualsChangesRequested,
  preview: events.previewChangesRequested,
} as const satisfies Record<GateStage, unknown>

export async function approveGate(projectId: string, stage: string): Promise<ActionResult> {
  const approvedBy = await requireOwner()
  const invalid = badId(projectId)
  if (invalid) return invalid

  const parsedStage = GateStageSchema.safeParse(stage)
  if (!parsedStage.success) return { ok: false, error: `Unknown gate "${stage}"` }

  const project = await getProject(db, projectId)
  if (project?.stageStatus !== 'awaiting_review' || !(await hasLiveRun(db, projectId))) {
    // Refused rather than sent into the void: an approval with no run waiting
    // on it would report success and change nothing.
    return { ok: false, error: 'No run is waiting at this gate.' }
  }

  /**
   * The dossier gate's blocker, enforced here and not only by a disabled
   * button (spec section 11.3).
   *
   * A disabled button is a hint. This is the thing that actually stops an
   * unsourced assertion reaching a script: the action refuses even if the
   * request arrives from a stale tab, a replayed form post, or anything else
   * that never rendered the button at all.
   */
  if (parsedStage.data === 'dossier') {
    const blocking = await blockingClaims(db, projectId)
    if (blocking.length > 0) {
      return {
        ok: false,
        error:
          `${blocking.length} claim(s) are still unsourced. Verify each against a source, or ` +
          'quarantine it to keep it out of the script.',
      }
    }
  }

  /**
   * The voice gate's blocker, and it is the spec's wording rather than a
   * convenience: "the main run's gate wait is only satisfied when the UI
   * approve action verifies zero flagged takes server-side" (section 7.3).
   *
   * Server-side is the load-bearing part. A flagged paragraph whose retake
   * never arrived would otherwise be approved into an assembly that narrates
   * the take you rejected.
   */
  if (parsedStage.data === 'voice') {
    const blocked = await voiceGateBlockedReason(db, projectId)
    if (blocked) return { ok: false, error: blocked }
  }

  const sent = await send(
    GATE_EVENT[parsedStage.data].create({ projectId, approvedBy }),
    'approve the gate',
  )

  refresh(projectId)
  return sent
}

export async function requestChanges(
  projectId: string,
  stage: string,
  note: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badId(projectId)
  if (invalid) return invalid

  const parsedStage = GateStageSchema.safeParse(stage)
  if (!parsedStage.success) return { ok: false, error: `Unknown gate "${stage}"` }

  const trimmed = note.trim()
  if (trimmed === '') return { ok: false, error: 'Say what needs to change.' }

  const sent = await send(
    CHANGES_EVENT[parsedStage.data].create({ projectId, note: trimmed }),
    'send the change request',
  )

  refresh(projectId)
  return sent
}

// ---------------------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------------------

export async function stopProject(projectId: string, reason?: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badId(projectId)
  if (invalid) return invalid

  /**
   * The event goes first, and nothing is stamped until it is accepted.
   *
   * It used to be the other way round, so that the screen would reflect the
   * stop the instant the button returned. That reads well and is a lie when the
   * send fails: the project shows `cancelled` while its run carries on spending
   * money, and — because the run mirror still holds a live run — the screen
   * goes on offering Stop and refuses a restart. A project could be stopped,
   * still running, and unrecoverable at the same time.
   */
  const sent = await send(
    events.projectCancelled.create({
      projectId,
      reason: reason?.trim() || 'Stopped from the project screen',
    }),
    'stop the run',
  )
  if (!sent.ok) return sent

  await markProjectCancelled(db, projectId)
  // `cancel-reconciler` does this too when Inngest delivers the event. Doing it
  // here as well is what makes the screen honest immediately: until the mirror
  // shows no live run, the project has no way back.
  await cancelRunsForProject(db, projectId)

  refresh(projectId)
  return sent
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * Delete a project and everything produced under it.
 *
 * Deliberately a hard delete rather than an archive. A project you have decided
 * against is clutter on the one screen you use to see what needs you, and an
 * archive that nothing can filter is a second list nobody reads. This is the
 * same call `deleteCase` makes: destroy when nothing depends on it, refuse when
 * something does.
 *
 * Two refusals, both because deleting would leave something incoherent rather
 * than merely lost:
 *
 * - **A live run.** Its next step would write a dossier, a chapter or a gate
 *   against a project row that no longer exists, and the failure would surface
 *   minutes later as an unexplained run error.
 * - **Anything published.** `publish_records` is polymorphic, so no foreign key
 *   stops a delete from stranding a row that points at a live YouTube video.
 *   The record of what is public has to outlast the console's tidying.
 *
 * The spend survives either way: `cost_ledger.project_id` is `set null`, so the
 * Costs screen never gets cheaper because a project was deleted.
 */
export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badId(projectId)
  if (invalid) return invalid

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }

  if (await hasLiveRun(db, projectId)) {
    return {
      ok: false,
      error: 'A run is still in flight on this project. Stop it first, then delete it.',
    }
  }

  const summary = await projectDeletionSummary(db, projectId)
  if (summary.publishedCount > 0) {
    return {
      ok: false,
      error:
        'This project has been published to YouTube. Deleting it would leave the publish record ' +
        'pointing at nothing — take the video down first if you really mean to remove it.',
    }
  }

  const deleted = await deleteProject(db, projectId)
  if (!deleted) return { ok: false, error: 'That project no longer exists' }

  revalidatePath('/projects')
  revalidatePath('/')
  revalidatePath('/cases')
  revalidatePath('/costs')

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Budget gate
// ---------------------------------------------------------------------------

export async function approveOverage(
  projectId: string,
  provider: string,
  additionalUsd: number,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badId(projectId)
  if (invalid) return invalid

  const parsedProvider = ProviderSchema.safeParse(provider)
  if (!parsedProvider.success) return { ok: false, error: `Unknown provider "${provider}"` }

  if (!Number.isFinite(additionalUsd) || additionalUsd <= 0) {
    return { ok: false, error: 'Enter how much extra to allow, in dollars.' }
  }

  const sent = await send(
    events.budgetApproved.create({
      projectId,
      provider: parsedProvider.data,
      additionalUsd,
    }),
    'approve the overage',
  )

  refresh(projectId)
  return sent
}

export async function abortOverage(projectId: string, provider: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badId(projectId)
  if (invalid) return invalid

  const parsedProvider = ProviderSchema.safeParse(provider)
  if (!parsedProvider.success) return { ok: false, error: `Unknown provider "${provider}"` }

  const sent = await send(
    events.budgetAborted.create({ projectId, provider: parsedProvider.data }),
    'abort the run',
  )
  await stopProject(projectId, `Aborted at the ${parsedProvider.data} budget gate`)

  return sent
}
