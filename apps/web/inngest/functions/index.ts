import { cancelReconciler } from './cancel-reconciler'
import { demoPipeline } from './demo-pipeline'
import { dossierReviser } from './dossier-reviser'
import { dossierRunner } from './dossier-runner'

/**
 * Every Inngest function this app serves. The serve route registers exactly
 * this array, so a function that is not here is not deployed — which is the
 * behaviour you want when a half-written runner is sitting on a branch.
 *
 * M4-M7 add `voice-runner`, `visuals-runner`, `assembly-runner`,
 * `render-runner`, `shorts-runner`, `publish-runner` and `analytics-runner`
 * (spec section 7).
 */
export const functions = [demoPipeline, cancelReconciler, dossierRunner, dossierReviser]

export { cancelReconciler, demoPipeline, dossierReviser, dossierRunner }
