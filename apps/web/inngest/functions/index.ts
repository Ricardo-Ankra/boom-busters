import { cancelReconciler } from './cancel-reconciler'
import { demoPipeline } from './demo-pipeline'
import { dossierReviser } from './dossier-reviser'
import { dossierRunner } from './dossier-runner'
import { scriptRunner } from './script-runner'

/**
 * Every Inngest function this app serves. The serve route registers exactly
 * this array, so a function that is not here is not deployed — which is the
 * behaviour you want when a half-written runner is sitting on a branch.
 *
 * M4-M7 add `voice-runner`, `visuals-runner`, `assembly-runner`,
 * `render-runner`, `shorts-runner`, `publish-runner` and `analytics-runner`
 * (spec section 7).
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
export const functions = [cancelReconciler, dossierRunner, dossierReviser, scriptRunner]

export { cancelReconciler, demoPipeline, dossierReviser, dossierRunner, scriptRunner }
