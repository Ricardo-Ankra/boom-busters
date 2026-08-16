import {
  BudgetApprovedSchema,
  DemoRequestedSchema,
  EVENT_NAMES,
  ProjectCancelledSchema,
  ProjectCreatedSchema,
  ProjectMasterReadySchema,
  RenderCompletedSchema,
  RenderFailedSchema,
  VoiceRetakeRequestedSchema,
  EVENT_SCHEMAS,
} from '@boom-busters/schemas'
import { eventType } from 'inngest'

/**
 * The event registry from `@boom-busters/schemas`, bound to Inngest.
 *
 * Inngest 4 dropped `EventSchemas` in favour of `eventType(name, {schema})`,
 * which takes a Standard Schema — Zod 4 is one natively. The names are spelled
 * out here rather than generated from `EVENT_SCHEMAS`, because a mapped object
 * loses the string literal types and with them every bit of type safety on
 * `inngest.send()` and on triggers. A test asserts the two stay in step.
 *
 * `packages/schemas` deliberately does not import `inngest`: the schemas are a
 * contract that server actions, tests and (later) the render broker all read,
 * none of which should have to depend on the orchestrator.
 */
export const events = {
  projectCreated: eventType('project/created', { schema: ProjectCreatedSchema }),
  projectCancelled: eventType('project/cancelled', { schema: ProjectCancelledSchema }),
  projectMasterReady: eventType('project/master.ready', { schema: ProjectMasterReadySchema }),

  dossierApproved: eventType('gate/dossier.approved', {
    schema: EVENT_SCHEMAS['gate/dossier.approved'],
  }),
  dossierChangesRequested: eventType('gate/dossier.changes_requested', {
    schema: EVENT_SCHEMAS['gate/dossier.changes_requested'],
  }),
  scriptApproved: eventType('gate/script.approved', {
    schema: EVENT_SCHEMAS['gate/script.approved'],
  }),
  scriptChangesRequested: eventType('gate/script.changes_requested', {
    schema: EVENT_SCHEMAS['gate/script.changes_requested'],
  }),
  voiceApproved: eventType('gate/voice.approved', {
    schema: EVENT_SCHEMAS['gate/voice.approved'],
  }),
  voiceChangesRequested: eventType('gate/voice.changes_requested', {
    schema: EVENT_SCHEMAS['gate/voice.changes_requested'],
  }),
  visualsApproved: eventType('gate/visuals.approved', {
    schema: EVENT_SCHEMAS['gate/visuals.approved'],
  }),
  visualsChangesRequested: eventType('gate/visuals.changes_requested', {
    schema: EVENT_SCHEMAS['gate/visuals.changes_requested'],
  }),
  previewApproved: eventType('gate/preview.approved', {
    schema: EVENT_SCHEMAS['gate/preview.approved'],
  }),
  previewChangesRequested: eventType('gate/preview.changes_requested', {
    schema: EVENT_SCHEMAS['gate/preview.changes_requested'],
  }),

  budgetApproved: eventType('budget/approved', { schema: BudgetApprovedSchema }),

  voiceRetakeRequested: eventType('voice/retake.requested', {
    schema: VoiceRetakeRequestedSchema,
  }),
  renderCompleted: eventType('render/completed', { schema: RenderCompletedSchema }),
  renderFailed: eventType('render/failed', { schema: RenderFailedSchema }),

  demoRequested: eventType('demo/pipeline.requested', { schema: DemoRequestedSchema }),
} as const

/** Every event name bound above, for the drift test. */
export const BOUND_EVENT_NAMES = Object.values(events).map((event) => event.name)

export { EVENT_NAMES }
