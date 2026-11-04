import { and, eq, sql } from 'drizzle-orm'
import type { Database } from './client'
import { costLedger, projects } from './schema'

export interface CostPerMinute {
  usdPerMinute: number
  /** How many finished projects the figure comes from. */
  projects: number
}

/**
 * What a minute of finished video has cost: each finished project's ledger
 * (`actual_usd` where known, else `estimated_usd`) over its target runtime,
 * summed. The channel's own projects first; every channel's when it has none;
 * null when nobody has finished one.
 */
export async function costPerMinute(
  db: Database,
  channelId: string,
): Promise<CostPerMinute | null> {
  const read = async (scope: string | null): Promise<CostPerMinute | null> => {
    const perProject = db
      .select({
        runtime: projects.targetRuntimeMin,
        spend:
          sql<string>`coalesce(sum(coalesce(${costLedger.actualUsd}, ${costLedger.estimatedUsd})), 0)`.as(
            'spend',
          ),
        id: projects.id,
      })
      .from(projects)
      .leftJoin(costLedger, eq(costLedger.projectId, projects.id))
      .where(
        scope === null
          ? eq(projects.stage, 'done')
          : and(eq(projects.stage, 'done'), eq(projects.channelId, scope)),
      )
      .groupBy(projects.id, projects.targetRuntimeMin)
      .as('per_project')
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        spend: sql<string>`coalesce(sum(${perProject.spend}), 0)`,
        minutes: sql<string>`coalesce(sum(${perProject.runtime}), 0)`,
      })
      .from(perProject)
    const minutes = Number(row?.minutes ?? 0)
    if (!row || row.count === 0 || minutes <= 0) return null
    return { usdPerMinute: Number(row.spend) / minutes, projects: row.count }
  }
  return (await read(channelId)) ?? (await read(null))
}
