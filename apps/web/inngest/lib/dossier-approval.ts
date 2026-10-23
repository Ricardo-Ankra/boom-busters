import { markDossierApproved } from '@boom-busters/db'
import type { GetStepTools } from 'inngest'
import { db } from '@/lib/db'
import type { inngest } from '../client'
import { closeReviewGate, markStageFailed, type GateContext } from './gates'

type StepTools = GetStepTools<typeof inngest>

/**
 * Wait on the open dossier gate, then close it, or fail it after 30 days.
 *
 * The runner waits here after its first save. A revision asked for after
 * approval (design decision 7) waits here too: the runner finished at that
 * approval, so the revision is the run the gate bar and the approve action
 * find, and the one that closes the gate when the owner approves. The
 * approval itself starts the script runner, which writes a fresh script.
 */
export async function awaitDossierApproval(
  step: StepTools,
  ctx: GateContext,
): Promise<'approved' | 'gate-timeout'> {
  const approval = await step.waitForEvent('await-dossier-gate', {
    event: 'gate/dossier.approved',
    timeout: '30d',
    if: 'async.data.projectId == event.data.projectId',
  })

  if (!approval) {
    // Thirty days without a decision. Failing is more honest than waiting
    // forever on a run nobody remembers starting.
    await step.run('gate-timed-out', () =>
      markStageFailed(ctx, {
        message: 'The dossier gate went 30 days without a decision.',
      }),
    )
    return 'gate-timeout'
  }

  await step.run('close-gate', async () => {
    await markDossierApproved(db, ctx.projectId)
    await closeReviewGate(ctx, { stage: 'dossier', nextStage: 'script' })
  })

  return 'approved'
}
