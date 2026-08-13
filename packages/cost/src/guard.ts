import { costLedger, getSettings } from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { BudgetExceededError, effectiveCeilingUsd, spentUsd } from '@boom-busters/schemas'
import type { Provider, Settings } from '@boom-busters/schemas'
import { eq, sql } from 'drizzle-orm'
import { monthTotalUsd, round4, type DbLike } from './ledger'

/**
 * The budget guard (build spec section 6):
 *
 * ```ts
 * withCost(provider, operation, projectId, estimate, fn)
 * ```
 *
 * Pre-flight: if total month spend + the estimate would cross the single
 * monthly ceiling, throw `BudgetExceededError`. That is *not* a failure — the
 * run parks on a budget gate and the UI asks the human to approve the overage
 * or abort. Nothing silently dies because the ceiling was hit.
 *
 * The cap used to be a per-provider matrix plus a kill switch; both were
 * removed by decision (2026-08-13) in favour of one number over the whole
 * ledger. Setting it to zero refuses everything, which is all the kill switch
 * ever did.
 *
 * The pre-flight check and the reservation happen in one transaction under a
 * single advisory lock, so two fan-out steps cannot each read "there is room
 * for one more" and then both spend it. The reservation is a ledger row with
 * `actual_usd IS NULL`, which the spend queries count at its estimate until it
 * settles.
 */

/** Postgres advisory-lock namespace. Arbitrary, but ours alone. */
const LOCK_NAMESPACE = 0x62_62 // 'bb'

/**
 * One lock, because there is one ceiling. The per-provider hash this replaced
 * existed to let independent caps reserve concurrently; a global cap read
 * under provider-scoped locks would race — two providers could each see room
 * for one more call and both take it.
 */
export const CEILING_LOCK_KEY = 1

/** What a guarded call returns: its value, plus what it actually cost. */
export interface Costed<T> {
  result: T
  /** Omit when the provider reports no usage; the estimate is then recorded. */
  actualUsd?: number
}

export interface CostSpec {
  provider: Provider
  /** Free text, shown in the ledger: `scripting`, `tts`, `stock-search`. */
  operation: string
  projectId?: string | null
  estimateUsd: number
  meta?: Record<string, unknown>
}

export interface WithCostOptions {
  /** Injected so tests can pin a month boundary. */
  now?: Date
  /** Pass when the caller already loaded settings; saves a query per step. */
  settings?: Settings
}

export async function withCost<T>(
  db: Database,
  spec: CostSpec,
  fn: () => Promise<Costed<T>>,
  options: WithCostOptions = {},
): Promise<T> {
  const now = options.now ?? new Date()
  const settings = options.settings ?? (await getSettings(db))

  const ledgerId = await reserve(db, spec, settings, now)

  try {
    const { result, actualUsd } = await fn()
    await settle(db, ledgerId, actualUsd ?? spec.estimateUsd)
    return result
  } catch (error) {
    const spent = spentUsd(error)
    if (spent === undefined) {
      // Nothing left the account, so nothing may sit in the ledger holding
      // budget hostage. Four retries of a transient blip must not add up to a
      // budget gate on spend that never happened.
      await release(db, ledgerId)
    } else {
      await settle(db, ledgerId, spent)
    }
    throw error
  }
}

/**
 * Check the cap and claim the estimate atomically. Returns the ledger row id.
 * Exported for the Inngest runners, which reserve inside one `step.run()` and
 * settle inside the next.
 */
export async function reserve(
  db: Database,
  spec: CostSpec,
  settings: Settings,
  now: Date = new Date(),
): Promise<string> {
  const estimate = round4(spec.estimateUsd)
  if (!Number.isFinite(estimate) || estimate < 0) {
    throw new Error(`estimateUsd must be a non-negative number, got ${spec.estimateUsd}`)
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${CEILING_LOCK_KEY})`)

    const monthSpend = await monthTotalUsd(tx, now)
    const ceiling = round4(effectiveCeilingUsd(settings.budgets, now))

    // Rounded to the ledger's own scale before comparing: at floating-point
    // precision `29.9 + 0.1 > 30` is true, and tripping a budget gate on a
    // rounding artefact would be indefensible.
    if (round4(monthSpend + estimate) > ceiling) {
      throw new BudgetExceededError({
        provider: spec.provider,
        operation: spec.operation,
        budgetUsd: ceiling,
        monthSpendUsd: monthSpend,
        estimateUsd: estimate,
      })
    }

    const [row] = await tx
      .insert(costLedger)
      .values({
        provider: spec.provider,
        operation: spec.operation,
        projectId: spec.projectId ?? null,
        estimatedUsd: estimate.toFixed(4),
        actualUsd: null,
        meta: spec.meta ?? {},
        occurredAt: now,
      })
      .returning({ id: costLedger.id })

    if (!row) throw new Error('cost ledger reservation returned no row')
    return row.id
  })
}

/** Record what the call really cost, closing the reservation. */
export async function settle(db: DbLike, ledgerId: string, actualUsd: number): Promise<void> {
  await db
    .update(costLedger)
    .set({ actualUsd: round4(actualUsd).toFixed(4), updatedAt: new Date() })
    .where(eq(costLedger.id, ledgerId))
}

/** Drop a reservation for a call that spent nothing. */
export async function release(db: DbLike, ledgerId: string): Promise<void> {
  await db.delete(costLedger).where(eq(costLedger.id, ledgerId))
}

// ---------------------------------------------------------------------------
// Read-only pre-flight
// ---------------------------------------------------------------------------

export interface BudgetStatus {
  /** Total across every provider — the ceiling is global. */
  monthSpendUsd: number
  ceilingUsd: number
  remainingUsd: number
  /** True when the guard would refuse the next call of this size. */
  wouldRefuse: boolean
}

/**
 * What the guard *would* decide, without reserving anything. The Costs screen
 * and the "Render master · ≈$0.25" button labels read this; it must never have
 * a side effect.
 */
export async function budgetStatus(
  db: DbLike,
  settings: Settings,
  options: { estimateUsd?: number; now?: Date } = {},
): Promise<BudgetStatus> {
  const now = options.now ?? new Date()
  const estimate = round4(options.estimateUsd ?? 0)
  const monthSpend = await monthTotalUsd(db, now)
  const ceiling = round4(effectiveCeilingUsd(settings.budgets, now))

  return {
    monthSpendUsd: monthSpend,
    ceilingUsd: ceiling,
    remainingUsd: round4(Math.max(0, ceiling - monthSpend)),
    wouldRefuse: round4(monthSpend + estimate) > ceiling,
  }
}
