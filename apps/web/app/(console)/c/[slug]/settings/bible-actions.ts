'use server'

import {
  BibleDraftBusyError,
  getWorkspace,
  openBibleDraft,
  vidiqCredential,
  vidiqCreditsThisMonth,
  writeBibleDraft,
} from '@boom-busters/db'
import { estimateResearchCredits, vidiqClientFor } from '@boom-busters/providers/vidiq'
import { BibleDraftInputsSchema, UlidSchema, jobIsRunning } from '@boom-busters/schemas'
import { auth } from '@/auth'
import { researchPlanFor } from '@/lib/bible-research'
import { channelWriteRefusal } from '@/lib/channel-lookup'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import type { ActionResult } from './actions'

/**
 * The bible drafting actions: research first (this file), drafting after. Each
 * is a POST endpoint of its own, so each re-checks the session.
 */

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

const BUSY: ActionResult = {
  ok: false,
  error: "A run is already working on this channel's draft.",
}

type Estimate =
  { ok: true; estimate: number; balance: number; capLeft: number } | { ok: false; error: string }

/** The checks both actions make: the key, the inputs, the plan, the balance and the monthly cap. */
async function checkResearch(channelId: string, input: unknown): Promise<Estimate> {
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

  const parsed = BibleDraftInputsSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid input',
    }
  }

  const apiKey = await vidiqCredential(db, env.SECRETS_ENCRYPTION_KEY)
  const client = vidiqClientFor(apiKey)
  if (!client) return { ok: false, error: 'Add a VidIQ key in Settings, Connections' }

  try {
    const plan = await researchPlanFor(channelId, parsed.data)
    if ('error' in plan) return { ok: false, error: plan.error }
    const estimate = estimateResearchCredits(plan)

    let balance: number
    try {
      balance = (await client.balance()).totalCredits
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `VidIQ did not answer: ${message}` }
    }

    const { settings } = await getWorkspace(db)
    const cap = settings.vidiq.monthlyCreditCap
    const capLeft = Math.max(0, cap - (await vidiqCreditsThisMonth(db)))
    if (estimate > capLeft) {
      return {
        ok: false,
        error: `This run needs about ${estimate} credits; ${capLeft} are left of this month's cap of ${cap}.`,
      }
    }
    if (estimate > balance) {
      return {
        ok: false,
        error: `This run needs about ${estimate} credits; the VidIQ balance is ${balance}.`,
      }
    }
    return { ok: true, estimate, balance, capLeft }
  } finally {
    await client.close()
  }
}

/** What the research would cost, before the owner commits to it. Spends nothing. */
export async function estimateBibleResearchAction(
  channelId: string,
  inputs: unknown,
): Promise<Estimate> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  return checkResearch(channelId, inputs)
}

/**
 * Save the inputs on the channel's draft, mark the research running and send
 * the run. Every check is made again here: the estimate on screen may be old.
 */
export async function startBibleResearchAction(
  channelId: string,
  inputs: unknown,
): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

  const open = await openBibleDraft(db, channelId)
  if (open.job && jobIsRunning(open.job)) return BUSY

  const checked = await checkResearch(channelId, inputs)
  if (!checked.ok) return checked
  const parsed = BibleDraftInputsSchema.parse(inputs)

  try {
    await writeBibleDraft(db, channelId, (draft) => ({
      ...draft,
      inputs: parsed,
      job: {
        kind: 'research',
        state: 'running',
        current: null,
        error: null,
        startedAt: new Date().toISOString(),
      },
    }))
  } catch (error) {
    if (error instanceof BibleDraftBusyError) return BUSY
    throw error
  }

  try {
    await inngest.send(events.bibleResearchRequested.create({ channelId }))
  } catch (error) {
    console.error('[bible] could not send the research run', error)
    // Nothing is running: say so, or the draft stays locked until the job goes stale.
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({
        ...draft,
        job: {
          kind: 'research',
          state: 'failed',
          current: null,
          error: 'The research run could not be started',
          startedAt: draft.job?.startedAt ?? new Date().toISOString(),
        },
      }),
      { allowWhileRunning: true },
    )
    return {
      ok: false,
      error:
        'Could not reach Inngest to start the research. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  return { ok: true }
}
