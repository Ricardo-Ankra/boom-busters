import { getRunByInngestId, recordRunEvent, setRunStatus } from '@boom-busters/db'
import { db } from '@/lib/db'
import { inngest } from '../client'

/**
 * failure-mirror: closes the mirror row of a run Inngest has given up on.
 *
 * The run mirror's own `onRunError` hook marks a run failed when its last
 * attempt throws. A run whose last attempt is KILLED never reaches that hook:
 * a step that runs past the route's 300-second limit is cut off by the
 * platform (an HTTP 504), Inngest retries it, and after the last retry it
 * fails the run with no code of ours running. Two bible drafts died that way
 * on 2026-11-27 and their rows said "running" until they were closed by hand,
 * so the top bar counted two runs nobody could find.
 *
 * Inngest emits `inngest/function.failed` for every failed run, however it
 * failed. Like `cancellation-mirror`, this is idempotent: a row the hook
 * already closed is left alone. The stage is not touched here; every stage
 * runner's own `onFailure` settles it.
 */

const FUNCTION_ID = 'failure-mirror'

/** The failure's message, from the event's `error`, in a form a person can read. */
function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return 'Inngest marked the run failed without a reason'
}

export const failureMirror = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Mirror a failed run',
    retries: 4,
    triggers: [{ event: 'inngest/function.failed' }],
  },
  async ({ event, step }) => {
    const data = (event.data ?? {}) as Record<string, unknown>
    // Its own failure would trigger it again: with the database down, each
    // failed pass would start the next. The run mirror's hook records it.
    const functionId = data['function_id']
    if (typeof functionId === 'string' && functionId.endsWith(FUNCTION_ID)) {
      return { outcome: 'own-failure' as const }
    }
    const inngestRunId = data['run_id']
    if (typeof inngestRunId !== 'string' || inngestRunId === '') {
      return { outcome: 'no-run-id' as const }
    }
    const error = data['error']
    const message = messageOf(error)

    const closed = await step.run('close-mirror-row', async () => {
      const run = await getRunByInngestId(db, inngestRunId)
      if (!run) return 'unknown-run' as const
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return 'already-closed' as const
      }
      const serialised =
        error && typeof error === 'object' ? (error as Record<string, unknown>) : { message }
      await recordRunEvent(db, { runId: run.id, kind: 'run.failed', message, data: serialised })
      await setRunStatus(db, run.id, 'failed', serialised)
      return 'closed' as const
    })

    return { inngestRunId, outcome: closed }
  },
)
