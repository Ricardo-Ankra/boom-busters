import { z } from 'zod'
import { UlidSchema } from './ids'
import { ShotSlotTypeSchema } from './visuals'

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
  /**
   * The record of why this retake exists — a flag note, "Re-read after an
   * edit", or "Another take". There is no separate `direction` field any
   * more: it existed for Gemini, whose prompt could carry a sentence of
   * English. ElevenLabs is steered *in the text* — audio tags, pause tags,
   * punctuation — so a steer arrives as a re-read of edited words, not as a
   * side channel the vendor may or may not honour.
   */
  note: z.string().min(1),
})

export const VisualsRefetchRequestedSchema = z.object({
  ...projectRef,
  slotId: UlidSchema,
  /**
   * Why this slot is being bought again — "Brief edited", "Regenerate",
   * "Another pass". Required for the same reason a retake note is: a paid
   * call with no stated cause is unauditable.
   */
  note: z.string().min(1),
})

/**
 * The plan checkpoint inside the visuals stage (staged-visuals design,
 * 2026-08-26): the owner has reviewed and edited the shot PLAN, and asks the
 * parked visuals-runner to fetch and generate the assets. Deliberately a
 * plain event rather than a sixth gate stage — it is the first half of gate
 * 4, not a new gate on the rail.
 */
export const VisualsPlanApprovedSchema = z.object({
  ...projectRef,
})

/**
 * Change one slot's type (still → stock, still → map, …). Handled by the
 * slot-retyper: mechanical when the target's fields derive from the shared
 * description, one small model call when the target needs structured data
 * (chart series with claim refs, map coordinates).
 */
export const VisualsRetypeRequestedSchema = z.object({
  ...projectRef,
  slotId: UlidSchema,
  targetType: ShotSlotTypeSchema,
})

/**
 * A media-utils job finished (M6.7). The broker hook route verifies the
 * HMAC and emits this; the waiting runner matches on jobId. `result` stays
 * untyped here — the waiting step parses it against the job kind's result
 * schema from broker.ts, which owns those shapes.
 */
export const MediaJobCompletedSchema = z.object({
  ...projectRef,
  jobId: UlidSchema,
  kind: z.enum(['qc', 'loudnorm', 'transcribe', 'upload-youtube']),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
})

/**
 * Ask for a cheap half-resolution draft of the latest timeline (M6.8). The
 * assembly-runner sends it after storing a compiled timeline, and the
 * preview screen's "Render draft" button re-sends it after a music swap.
 * The draft-runner never touches gates or stages — a draft is advisory.
 */
export const RenderDraftRequestedSchema = z.object({
  ...projectRef,
})

/**
 * Render (or re-render) one Short (M7.3). The shorts-runner fans these out
 * after resolving candidates, and the Shorts screen's per-card render button
 * re-sends one after an ending change made the last render stale. Handled by
 * the short-render-runner, one Short per run, concurrency-capped.
 */
export const ShortsRenderRequestedSchema = z.object({
  ...projectRef,
  shortId: UlidSchema,
})

/**
 * Publish one item (M7.6) — the UI's schedule action creates/updates the
 * publish_records row FIRST, then sends this. `attempt` exists for the
 * error mapper's `retry` action: a transient upload failure re-emits with
 * attempt+1, capped in the runner, so a flapping YouTube cannot loop forever.
 */
export const PublishRequestedSchema = z.object({
  ...projectRef,
  targetType: z.enum(['master', 'short']),
  targetId: UlidSchema,
  attempt: z.number().int().min(0).optional(),
})

/**
 * ONE event per render outcome, success or failure in its `result` field —
 * exactly the section 9 wording ("normalise into one Inngest event").
 *
 * It replaced a `render/completed`/`render/failed` pair on 2026-08-23,
 * because two event names force the runner into two `waitForEvent` steps,
 * and `Promise.all` over them cannot settle until BOTH do — the one that
 * never fires only settles at its timeout, so every render sat "rendering"
 * for the full timeout window after it had actually finished.
 */
export const RenderSettledSchema = z.object({
  ...projectRef,
  renderId: UlidSchema,
  result: z.enum(['completed', 'failed']),
  /** Present on completions. */
  outputS3Key: z.string().min(1).optional(),
  costUsd: z.number().min(0).optional(),
  /** Present on failures. */
  reason: z.enum(['error', 'timeout']).optional(),
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

/**
 * Run the analytics pass NOW rather than at the next 06:00 UTC cron tick
 * (M8). Carries nothing: the pass reads everything it needs from the
 * database. Exists so the owner has a button and the tests have a trigger —
 * the cron stays the only *schedule*.
 */
export const AnalyticsRefreshRequestedSchema = z.object({
  requestedBy: z.string().min(1).optional(),
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

  'voice/retake.requested': VoiceRetakeRequestedSchema,
  'visuals/refetch.requested': VisualsRefetchRequestedSchema,
  'visuals/plan.approved': VisualsPlanApprovedSchema,
  'visuals/retype.requested': VisualsRetypeRequestedSchema,
  'media/job.completed': MediaJobCompletedSchema,
  'render/draft.requested': RenderDraftRequestedSchema,
  'shorts/render.requested': ShortsRenderRequestedSchema,
  'publish/requested': PublishRequestedSchema,
  'render/settled': RenderSettledSchema,

  'analytics/refresh.requested': AnalyticsRefreshRequestedSchema,

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
