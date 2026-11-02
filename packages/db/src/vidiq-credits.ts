import { monthKey } from '@boom-busters/schemas'
import { and, gte, lt, sql } from 'drizzle-orm'
import type { Database } from './client'
import { vidiqCredits } from './schema'

/**
 * The VidIQ credits ledger: one row per call, so the monthly cap is a sum and
 * a spend is traceable to the tool, arguments and project that caused it.
 */

export async function recordVidiqCredits(
  db: Database,
  input: {
    channelId: string
    projectId?: string
    purpose: string
    tool: string
    args: Record<string, unknown>
    credits: number
  },
): Promise<void> {
  await db.insert(vidiqCredits).values({
    channelId: input.channelId,
    projectId: input.projectId ?? null,
    purpose: input.purpose,
    tool: input.tool,
    args: input.args,
    credits: input.credits,
  })
}

/** Credits spent across the whole workspace in the UTC month of `now`. */
export async function vidiqCreditsThisMonth(db: Database, now: Date = new Date()): Promise<number> {
  const [year, month] = monthKey(now).split('-').map(Number) as [number, number]
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${vidiqCredits.credits}), 0)::int` })
    .from(vidiqCredits)
    .where(and(gte(vidiqCredits.occurredAt, start), lt(vidiqCredits.occurredAt, end)))
  return row?.total ?? 0
}
