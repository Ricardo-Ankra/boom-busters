'use server'

import { getProject, markProjectCancelled, setProjectStage } from '@boom-busters/db'
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
// Starting
// ---------------------------------------------------------------------------

export async function startDemoPipeline(
  projectId: string,
  options: { forceBudgetGate?: boolean } = {},
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badId(projectId)
  if (invalid) return invalid

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }

  // A second run of the same project would race the first over the same
  // stage columns. Refuse plainly rather than producing two runs whose
  // writes interleave.
  if (project.stageStatus === 'running' || project.stageStatus === 'awaiting_review') {
    return { ok: false, error: 'This project already has a run in flight.' }
  }

  await setProjectStage(db, projectId, {
    stage: 'dossier',
    stageStatus: 'queued',
    inngestRunId: null,
  })

  const sent = await send(
    events.demoRequested.create({
      projectId,
      ...(options.forceBudgetGate ? { forceBudgetGate: true } : {}),
    }),
    'start the run',
  )

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
  if (project?.stageStatus !== 'awaiting_review') {
    return { ok: false, error: 'This gate is not open.' }
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

  // Stamped here, before the event goes out, so the UI reflects the stop the
  // moment the button returns. `cancel-reconciler` closes the run rows when
  // Inngest delivers the event.
  await markProjectCancelled(db, projectId)

  const sent = await send(
    events.projectCancelled.create({
      projectId,
      reason: reason?.trim() || 'Stopped from the project screen',
    }),
    'stop the run',
  )

  refresh(projectId)
  return sent
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
