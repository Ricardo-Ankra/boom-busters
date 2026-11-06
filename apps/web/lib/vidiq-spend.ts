import {
  getWorkspace,
  recordVidiqCredits,
  vidiqCredential,
  vidiqCreditsThisMonth,
} from '@boom-busters/db'
import { vidiqClientFor } from '@boom-busters/providers/vidiq'
import type { VidiqCall, VidiqClient } from '@boom-busters/providers/vidiq'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * The one way the web app spends VidIQ credits: a check before the owner
 * commits to a run (`checkVidiqBudget`), and a check and a ledger row around
 * every call inside a run (`spendVidiq`). The bible researcher, the case
 * researcher and title scoring all go through here, so the cap and the ledger
 * mean the same thing for every caller.
 */

export type VidiqBudget =
  { ok: true; balance: number; capLeft: number } | { ok: false; error: string }

/**
 * Whether a run estimated at `estimate` credits may start: a key is stored,
 * VidIQ answers with its balance, the estimate fits what is left of this
 * month's cap, and it fits the balance. The cap is checked first. Spends
 * nothing.
 */
export async function checkVidiqBudget(estimate: number): Promise<VidiqBudget> {
  const apiKey = await vidiqCredential(db, env.SECRETS_ENCRYPTION_KEY)
  const client = vidiqClientFor(apiKey)
  if (!client) return { ok: false, error: 'Add a VidIQ key in Settings, Connections' }

  try {
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
    return { ok: true, balance, capLeft }
  } finally {
    await client.close()
  }
}

async function openClient(): Promise<VidiqClient> {
  const apiKey = await vidiqCredential(db, env.SECRETS_ENCRYPTION_KEY)
  const client = vidiqClientFor(apiKey)
  if (!client) throw new NonRetriableError('There is no VidIQ key to research with')
  return client
}

/** The monthly cap refused a call; a NonRetriableError, so callers that catch that keep working. */
export class VidiqCapReached extends NonRetriableError {
  // No constructor and no `name` override: the name stays `NonRetriableError`,
  // which Inngest reads to stop retrying (the AnswerStopped convention).
}

/** Runs `fn` with an open client and closes it after. For free calls only: use `spendVidiq` for anything that costs. */
export async function withVidiqClient<T>(fn: (client: VidiqClient) => Promise<T>): Promise<T> {
  const client = await openClient()
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

export interface VidiqSpendInput {
  channelId: string
  projectId?: string
  purpose: 'bible-research' | 'case-research' | 'keyword-measure' | 'search-space' | 'title-score'
  /** The VidIQ tool the call uses, as the ledger names it. */
  tool: string
  /** What the call is expected to cost, for the cap check made before it. */
  cost: number
}

/**
 * One VidIQ call and its ledger row, for use inside one step. The monthly cap
 * is checked first; the row is written after the call returns, so a call that
 * threw is never charged. The row carries the arguments as sent on the wire.
 */
export async function spendVidiq<T>(
  input: VidiqSpendInput,
  call: (client: VidiqClient) => Promise<VidiqCall<T>>,
): Promise<VidiqCall<T>> {
  const client = await openClient()
  try {
    const [{ settings }, spent] = await Promise.all([getWorkspace(db), vidiqCreditsThisMonth(db)])
    const cap = settings.vidiq.monthlyCreditCap
    if (spent + input.cost > cap) {
      throw new VidiqCapReached(
        `The VidIQ cap is reached: ${spent} of ${cap} credits used this month`,
      )
    }
    const result = await call(client)
    await recordVidiqCredits(db, {
      channelId: input.channelId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      purpose: input.purpose,
      tool: input.tool,
      args: result.args,
      credits: result.credits,
    })
    return result
  } finally {
    await client.close()
  }
}
