import {
  getProject,
  getRunByInngestId,
  hasLiveRun,
  recordRunEvent,
  setProjectStage,
  setRunStatus,
} from '@boom-busters/db'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { inngest } from '../client'

/**
 * cancellation-mirror (decision 235, closing a decision 220 debt).
 *
 * A run cancelled OUTSIDE the app (the Inngest dashboard's Cancel, or the
 * REST API) stops without any of the hooks the run mirror listens to. The
 * mirror row stayed `running` forever: `hasLiveRun` kept refusing restarts,
 * the screen kept offering Stop for a run that no longer existed, and the
 * only recovery was knowing to press Stop and let the sweep clean up.
 *
 * Inngest emits `inngest/function.cancelled` for every cancellation, whoever
 * asked for it. Triggering on that closes the row the moment it happens:
 *
 * - The app's own Stop also lands here (its `project/cancelled` cancels every
 *   runner via `cancelOn`), but by then `cancelRunsForProject` has closed the
 *   rows, so this finds them terminal and does nothing. Idempotence is the
 *   whole design.
 * - When the cancelled run was a STAGE runner and the project shows `running`
 *   with no other live run behind it, the stage is marked failed so the rail
 *   stops claiming progress nobody is making, and a notification says what
 *   happened in words. A cancelled side job (a retaker, a re-fetch) never
 *   touches the stage, the same rule as decisions 219 and 234.
 */

const FUNCTION_ID = 'cancellation-mirror'

export const cancellationMirror = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Mirror an outside cancellation',
    retries: 4,
    triggers: [{ event: 'inngest/function.cancelled' }],
  },
  async ({ event, step }) => {
    const inngestRunId = (event.data as Record<string, unknown> | undefined)?.['run_id']
    if (typeof inngestRunId !== 'string' || inngestRunId === '') {
      return { outcome: 'no-run-id' as const }
    }

    const closed = await step.run('close-mirror-row', async () => {
      const run = await getRunByInngestId(db, inngestRunId)
      if (!run) return { outcome: 'unknown-run' as const }
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return { outcome: 'already-closed' as const }
      }

      await recordRunEvent(db, {
        runId: run.id,
        kind: 'run.cancelled',
        message: 'Cancelled outside the app (the Inngest dashboard, or the API)',
      })
      await setRunStatus(db, run.id, 'cancelled')
      return {
        outcome: 'closed' as const,
        stage: run.stage,
        projectId: run.projectId,
      }
    })

    if (closed.outcome !== 'closed' || !closed.stage || !closed.projectId) {
      return { inngestRunId, outcome: closed.outcome }
    }

    // A stage runner died: if nothing else is moving and the project still
    // claims to be running, stop the rail from lying.
    await step.run('settle-the-stage', async () => {
      const project = await getProject(db, closed.projectId as string)
      if (project?.stageStatus !== 'running') return
      if (await hasLiveRun(db, closed.projectId as string)) return

      await setProjectStage(db, closed.projectId as string, { stageStatus: 'failed' })
      await notify({
        kind: 'run-failed',
        title: 'A run was cancelled outside the app',
        body:
          `The ${String(closed.stage)} run was cancelled from the Inngest side, so the stage ` +
          'is stopped. Restart it from the project screen when you are ready.',
        href: `/projects/${closed.projectId}`,
      })
    })

    return { inngestRunId, outcome: 'closed' as const }
  },
)
