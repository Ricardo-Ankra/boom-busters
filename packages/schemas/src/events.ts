import { z } from 'zod'
import { UlidSchema } from './ids'

/**
 * The event contracts that chain the pipeline together (build spec section 7).
 *
 * Naming is the spec's: events are `project/<stage>.<verb>`, functions are
 * `<stage>-runner`. Every payload is a Zod object here rather than a
 * TypeScript interface at the Inngest client, because these cross a process
 * boundary — a `gate/script.approved` can be sent by a server action, replayed
 * from the Inngest dashboard, or fired by a test harness, and only a runtime
 * schema catches a bad one at the edge.
 *
 * Stages that have no runner yet (M3 onward) still define their events here:
 * the contract is what the milestone codes against, and defining it once
 * avoids renaming events later when a runner finally lands.
 *
 * **No `.default()` anywhere in this file.** These schemas are handed to
 * Inngest as Standard Schemas, and Inngest rejects any schema whose input and
 * output types differ — a default is a transform. That constraint is a good
 * one for wire payloads regardless: a field the sender omits should be absent,
 * not silently filled in with a value the sender never chose.
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const projectRef = { projectId: UlidSchema }

/** The five human gates (spec principle 1). `preview` is Gate 5a. */
export const GATE_STAGES = ['dossier', 'script', 'voice', 'visuals', 'preview'] as const
export const GateStageSchema = z.enum(GATE_STAGES)
export type GateStage = z.infer<typeof GateStageSchema>

const GateApprovedSchema = z.object({
  ...projectRef,
  /** Who clicked. Single-user today, but the audit trail costs nothing. */
  approvedBy: z.email().optional(),
})

const GateChangesRequestedSchema = z.object({
  ...projectRef,
  note: z.string().min(1, 'a change request must say what to change'),
})

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

export const ProjectCreatedSchema = z.object({
  ...projectRef,
  caseId: UlidSchema,
})

export const ProjectCancelledSchema = z.object({
  ...projectRef,
  /** Required: a run that vanished without a stated reason is a support case. */
  reason: z.string().min(1),
})

export const ProjectMasterReadySchema = z.object({
  ...projectRef,
  renderId: UlidSchema,
})

export const VoiceRetakeRequestedSchema = z.object({
  ...projectRef,
  takeId: UlidSchema,
  note: z.string().min(1),
})

export const RenderCompletedSchema = z.object({
  ...projectRef,
  renderId: UlidSchema,
  outputS3Key: z.string().min(1),
  costUsd: z.number().min(0),
})

export const RenderFailedSchema = z.object({
  ...projectRef,
  renderId: UlidSchema,
  reason: z.enum(['error', 'timeout']),
  message: z.string().optional(),
})

/**
 * The budget gate (spec section 6). `BudgetExceededError` parks the run here;
 * approving records the acknowledged overage so the guard lets the retry past.
 */
export const BudgetApprovedSchema = z.object({
  ...projectRef,
  provider: z.string().min(1),
  /** Extra headroom granted for this month, in USD, on top of the cap. */
  additionalUsd: z.number().min(0),
})

export const BudgetAbortedSchema = z.object({
  ...projectRef,
  provider: z.string().min(1),
})

/**
 * The M2 demo pipeline: a no-op run with two gates that proves park, resume
 * and cancel against real Inngest infrastructure (spec section 14.2). It is
 * not part of the production pipeline and is replaced stage by stage from M3.
 */
export const DemoRequestedSchema = z.object({
  ...projectRef,
  /** Forces a `BudgetExceededError` at step 2, to exercise the budget gate. */
  forceBudgetGate: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * Every event the system sends, by name. This object is the single source the
 * Inngest client's `EventSchemas` is built from, so an event that is not here
 * cannot be sent in typed code at all.
 */
export const EVENT_SCHEMAS = {
  'project/created': ProjectCreatedSchema,
  'project/cancelled': ProjectCancelledSchema,
  'project/master.ready': ProjectMasterReadySchema,

  'gate/dossier.approved': GateApprovedSchema,
  'gate/dossier.changes_requested': GateChangesRequestedSchema,
  'gate/script.approved': GateApprovedSchema,
  'gate/script.changes_requested': GateChangesRequestedSchema,
  'gate/voice.approved': GateApprovedSchema,
  'gate/voice.changes_requested': GateChangesRequestedSchema,
  'gate/visuals.approved': GateApprovedSchema,
  'gate/visuals.changes_requested': GateChangesRequestedSchema,
  'gate/preview.approved': GateApprovedSchema,
  'gate/preview.changes_requested': GateChangesRequestedSchema,

  'budget/approved': BudgetApprovedSchema,
  'budget/aborted': BudgetAbortedSchema,

  'voice/retake.requested': VoiceRetakeRequestedSchema,
  'render/completed': RenderCompletedSchema,
  'render/failed': RenderFailedSchema,

  'demo/pipeline.requested': DemoRequestedSchema,
} as const

export type EventName = keyof typeof EVENT_SCHEMAS
export type EventPayload<N extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[N]>

export const EVENT_NAMES = Object.keys(EVENT_SCHEMAS) as EventName[]

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

export function gateApprovedEvent(stage: GateStage): EventName {
  return `gate/${stage}.approved`
}

export function gateChangesRequestedEvent(stage: GateStage): EventName {
  return `gate/${stage}.changes_requested`
}

/**
 * Parse an untrusted payload for a named event. Server actions and webhooks
 * both go through this, so a malformed event never reaches a runner.
 */
export function parseEventData<N extends EventName>(name: N, data: unknown): EventPayload<N> {
  return EVENT_SCHEMAS[name].parse(data) as EventPayload<N>
}
