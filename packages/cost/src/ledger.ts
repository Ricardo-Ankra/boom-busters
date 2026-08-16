import { costLedger, projects } from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'

/**
 * The cost ledger: every provider call that spends money leaves a row here,
 * and the monthly per-provider aggregate is what the budget guard compares
 * against (build spec section 5).
 *
 * Two details carry the whole design:
 *
 * 1. **Spend is `coalesce(actual, estimated)`.** A row written but not yet
 *    settled is a live reservation, and it counts. That is what stops two
 *    concurrent calls from each seeing room under the cap and both proceeding.
 * 2. **Money is `numeric(12,4)`, which postgres.js hands back as a string.**
 *    Every read parses explicitly; nothing here lets a float in by accident.
 */

/** A transaction handle is accepted anywhere a database is. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DbLike = Database | Tx

/** Every provider the ledger can record, including the ones with no cap. */
export type LedgerProvider = (typeof costLedger.$inferSelect)['provider']

/** USD rounded to the ledger column's own scale, so comparisons are exact. */
export function round4(usd: number): number {
  return Math.round(usd * 10_000) / 10_000
}

function toUsd(value: string | number | null): number {
  if (value === null) return 0
  return typeof value === 'number' ? value : Number.parseFloat(value)
}

/** UTC month window `[start, end)` containing `when`. */
export function monthBounds(when: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1)),
    end: new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth() + 1, 1)),
  }
}

const spendExpr = sql<string>`coalesce(sum(coalesce(${costLedger.actualUsd}, ${costLedger.estimatedUsd})), 0)`

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/** This month's spend for one provider, counting unsettled reservations. */
export async function monthSpendUsd(
  db: DbLike,
  provider: LedgerProvider,
  when: Date,
): Promise<number> {
  const { start, end } = monthBounds(when)
  const [row] = await db
    .select({ total: spendExpr })
    .from(costLedger)
    .where(
      and(
        eq(costLedger.provider, provider),
        gte(costLedger.occurredAt, start),
        lt(costLedger.occurredAt, end),
      ),
    )
  return round4(toUsd(row?.total ?? 0))
}

/** This month's spend for every provider that has any. Feeds the Costs bars. */
export async function monthSpendByProvider(
  db: DbLike,
  when: Date,
): Promise<Partial<Record<LedgerProvider, number>>> {
  const { start, end } = monthBounds(when)
  const rows = await db
    .select({ provider: costLedger.provider, total: spendExpr })
    .from(costLedger)
    .where(and(gte(costLedger.occurredAt, start), lt(costLedger.occurredAt, end)))
    .groupBy(costLedger.provider)

  const out: Partial<Record<LedgerProvider, number>> = {}
  for (const row of rows) out[row.provider] = round4(toUsd(row.total))
  return out
}

export async function monthTotalUsd(db: DbLike, when: Date): Promise<number> {
  const { start, end } = monthBounds(when)
  const [row] = await db
    .select({ total: spendExpr })
    .from(costLedger)
    .where(and(gte(costLedger.occurredAt, start), lt(costLedger.occurredAt, end)))
  return round4(toUsd(row?.total ?? 0))
}

export interface ProjectSpend {
  projectId: string | null
  title: string | null
  totalUsd: number
}

/** Per-project breakdown for the Costs screen (spec section 11.3). */
export async function monthSpendByProject(db: DbLike, when: Date): Promise<ProjectSpend[]> {
  const { start, end } = monthBounds(when)
  const rows = await db
    .select({
      projectId: costLedger.projectId,
      title: projects.title,
      total: spendExpr,
    })
    .from(costLedger)
    .leftJoin(projects, eq(costLedger.projectId, projects.id))
    .where(and(gte(costLedger.occurredAt, start), lt(costLedger.occurredAt, end)))
    .groupBy(costLedger.projectId, projects.title)

  return rows
    .map((row) => ({
      projectId: row.projectId,
      title: row.title,
      totalUsd: round4(toUsd(row.total)),
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd)
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  id: string
  provider: LedgerProvider
  operation: string
  projectId: string | null
  estimatedUsd: number
  actualUsd: number | null
  settled: boolean
  meta: Record<string, unknown>
  occurredAt: Date
}

export interface LedgerFilter {
  provider?: LedgerProvider
  projectId?: string
  limit?: number
  offset?: number
}

/** The filterable ledger table (spec section 11.3). Newest first. */
export async function listLedger(db: DbLike, filter: LedgerFilter = {}): Promise<LedgerEntry[]> {
  const conditions = [
    filter.provider ? eq(costLedger.provider, filter.provider) : undefined,
    filter.projectId ? eq(costLedger.projectId, filter.projectId) : undefined,
  ].filter((c) => c !== undefined)

  const rows = await db
    .select()
    .from(costLedger)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(costLedger.occurredAt))
    .limit(Math.min(filter.limit ?? 100, 500))
    .offset(filter.offset ?? 0)

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    operation: row.operation,
    projectId: row.projectId,
    estimatedUsd: toUsd(row.estimatedUsd),
    actualUsd: row.actualUsd === null ? null : toUsd(row.actualUsd),
    settled: row.actualUsd !== null,
    meta: row.meta,
    occurredAt: row.occurredAt,
  }))
}

/**
 * Record spend that no cap governs — renders and YouTube uploads, whose
 * spending decision is the explicit pre-render confirm rather than a monthly
 * budget (spec section 8.1). Visible in the ledger and the Costs screen; never
 * a reason to refuse work.
 */
export async function recordCost(
  db: DbLike,
  entry: {
    provider: LedgerProvider
    operation: string
    projectId?: string | null
    actualUsd: number
    meta?: Record<string, unknown>
    occurredAt?: Date
  },
): Promise<string> {
  const amount = round4(entry.actualUsd)
  const [row] = await db
    .insert(costLedger)
    .values({
      provider: entry.provider,
      operation: entry.operation,
      projectId: entry.projectId ?? null,
      estimatedUsd: amount.toFixed(4),
      actualUsd: amount.toFixed(4),
      meta: entry.meta ?? {},
      ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
    })
    .returning({ id: costLedger.id })

  if (!row) throw new Error('cost ledger insert returned no row')
  return row.id
}

/**
 * Test-only: empty the ledger. Exported so tests need not depend on
 * `drizzle-orm` directly — SQL stays inside the packages that own it.
 */
export async function truncateLedger(db: DbLike): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE ${costLedger}`)
}
