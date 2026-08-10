import { cancelRunsForProject, markProjectCancelled } from '@boom-busters/db'
import { db } from '@/lib/db'
import { inngest } from '../client'
import { events } from '../events'

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
    triggers: [events.projectCancelled],
  },
  async ({ event, step }) => {
    const { projectId, reason } = event.data

    const closed = await step.run('release', async () => {
      await markProjectCancelled(db, projectId)
      return cancelRunsForProject(db, projectId)
    })

    return { projectId, reason, runsClosed: closed }
  },
)
