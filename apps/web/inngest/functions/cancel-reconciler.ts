import { cancelRunsForProject, markProjectCancelled } from '@boom-busters/db'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { inngest } from '../client'
import { events } from '../events'
import { resolveRunRowId } from '../middleware/run-mirror'

/**
 * Reconcile the database when a project is cancelled (build spec section 7).
 *
 * The spec describes this as a `finally` handler inside each runner. It is a
 * separate function instead, for a reason worth recording: a cancelled Inngest
 * run cannot durably execute new steps — cancellation stops it where it
 * stands. A `finally` block therefore cannot reliably write the cancelled
 * state, which is exactly the state the UI depends on.
 *
 * Triggering on the same `project/cancelled` event gives the same guarantee
 * with none of that fragility, and it works no matter who emitted the event —
 * the Stop button, an alarm, or a replay from the Inngest dashboard.
 */
export const cancelReconciler = inngest.createFunction(
  {
    id: 'cancel-reconciler',
    name: 'Release a cancelled project',
    retries: 4,
    onFailure: async ({ event }) => {
      // Four failed attempts to release a cancelled project leave it wedged:
      // runs marked live that are not, restarts refused. Say so instead of
      // failing into silence (decision 236).
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await notify({
        kind: 'run-failed',
        title: 'A stopped project could not be released',
        body: `The stop was sent but the bookkeeping failed: ${String(
          event.data.error?.message ?? 'unknown error',
        )}. Press Stop again to retry the sweep.`,
        href: `/projects/${projectId}`,
      })
    },
    triggers: [events.projectCancelled],
  },
  async ({ event, step, runId }) => {
    const { projectId, reason } = event.data

    const closed = await step.run('release', async () => {
      await markProjectCancelled(db, projectId)

      // This function is itself a run against the same project, so it has to
      // exclude its own mirror row or it cancels itself.
      const ownRunRow = await resolveRunRowId({
        inngestRunId: runId,
        functionId: 'cancel-reconciler',
        projectId,
      })
      return cancelRunsForProject(db, projectId, { exceptRunId: ownRunRow })
    })

    return { projectId, reason, runsClosed: closed }
  },
)
