import { assemblyRunner } from './assembly-runner'
import { cancelReconciler } from './cancel-reconciler'
import { dossierReviser } from './dossier-reviser'
import { dossierRunner } from './dossier-runner'
import { draftRunner } from './draft-runner'
import { publishRunner } from './publish-runner'
import { renderRunner } from './render-runner'
import { scriptRunner } from './script-runner'
import { shortRenderRunner } from './short-render-runner'
import { shortsRunner } from './shorts-runner'
import { slotRefetcher } from './slot-refetcher'
import { slotRetyper } from './slot-retyper'
import { visualsRunner } from './visuals-runner'
import { voiceRetaker } from './voice-retaker'
import { voiceRunner } from './voice-runner'

/**
 * Every Inngest function this app serves. The serve route registers exactly
 * this array, so a function that is not here is not deployed — which is the
 * behaviour you want when a half-written runner is sitting on a branch.
 *
 * M7 adds `shorts-runner`, `short-render-runner` and `publish-runner`
 * (below); still to come: `analytics-runner` (M8, spec section 7).
 *
 * **`demoPipeline` is deliberately not here.** It did its job — spec section
 * 14.2 asked it to prove park/resume/cancel on production infra, and the M2
 * trace in PROGRESS.md is that proof. What it does now is damage: it waits on
 * the same `gate/dossier.approved` and `gate/script.approved` events the real
 * runners do, so any demo run left parked on a real project resumes on that
 * project's next approval and its `finish` step drops the project straight to
 * `done`. Production had exactly that — a stale `demo-runner` parked at the
 * script gate of a project whose real script was written and waiting for
 * review.
 *
 * Unregistering it archives it on the next sync, which is what stops those
 * parked runs resuming at all. The function and its tests stay in the tree, so
 * `pnpm test` still exercises the orchestration spine end to end without
 * anything being able to reach it in production.
 */
export const functions = [
  cancelReconciler,
  dossierRunner,
  dossierReviser,
  scriptRunner,
  voiceRunner,
  voiceRetaker,
  visualsRunner,
  slotRefetcher,
  slotRetyper,
  assemblyRunner,
  draftRunner,
  renderRunner,
  shortsRunner,
  shortRenderRunner,
  publishRunner,
]

// `demoPipeline` is deliberately absent here too: its test imports it from
// `./demo-pipeline` directly, and a barrel export made an unregistered
// function look registered.
export {
  assemblyRunner,
  cancelReconciler,
  draftRunner,
  publishRunner,
  renderRunner,
  dossierReviser,
  dossierRunner,
  scriptRunner,
  shortRenderRunner,
  shortsRunner,
  slotRefetcher,
  slotRetyper,
  visualsRunner,
  voiceRunner,
  voiceRetaker,
}
