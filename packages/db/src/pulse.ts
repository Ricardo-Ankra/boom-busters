import { sql } from 'drizzle-orm'
import type { Database } from './client'
import { projects, runEvents, runs } from './schema'

/**
 * The pulse: an opaque token that changes whenever anything a pipeline
 * screen shows has changed — the project row, its run mirror, or a run
 * event. `LiveRefresh` polls this (a few hundred bytes) instead of
 * re-rendering the whole page every interval, because a full project-page
 * render reads ~400 KB out of Postgres and a 3-second loop of that was
 * most of a month's Neon transfer allowance (measured 2026-08-21).
 *
 * Renders are deliberately NOT part of the pulse: mid-render progress
 * writes land every couple of seconds and the render panel already has its
 * own progress poll — folding them in would turn every render back into
 * the full-page loop this exists to end. The run mirror still moves on
 * every render-runner step, so terminal transitions refresh the page.
 */

/** Epoch-seconds text of the newest change for one project, '' if unknown. */
export async function projectPulse(db: Database, projectId: string): Promise<string> {
  const rows = await db.execute(sql`
    select extract(epoch from greatest(
      (select ${projects.updatedAt} from ${projects} where ${projects.id} = ${projectId}),
      (select max(${runs.updatedAt}) from ${runs} where ${runs.projectId} = ${projectId}),
      (select max(${runEvents.occurredAt}) from ${runEvents}
         join ${runs} on ${runs.id} = ${runEvents.runId}
         where ${runs.projectId} = ${projectId})
    ))::text as pulse
  `)
  const pulse = (rows[0] as { pulse: string | null } | undefined)?.pulse
  return pulse ?? ''
}

/** The dashboard's variant: the newest change across every project. */
export async function globalPulse(db: Database): Promise<string> {
  const rows = await db.execute(sql`
    select extract(epoch from greatest(
      (select max(${projects.updatedAt}) from ${projects}),
      (select max(${runs.updatedAt}) from ${runs})
    ))::text as pulse
  `)
  const pulse = (rows[0] as { pulse: string | null } | undefined)?.pulse
  return pulse ?? ''
}
