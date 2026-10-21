import path from 'node:path'
import type { Sources } from '../evidence'
import { laneOf } from '../hitlist/build'
import type { HitlistEntry, IsoDate, Lane } from '../types'
import {
  CODE_PATH,
  SNAPSHOT_FILES,
  packageRefusal,
  readJson,
  snapshotDir,
  type GitAdapter,
  type HitlistSnapshot,
} from './snapshots'

/** What every back-test command is handed, and the helpers they share. */

export interface CliContext {
  /** The repo root: snapshots, the fixture and the report all live under it. */
  root: string
  mock: boolean
  sources: Sources
  git: GitAdapter
  /** One instant for the whole process, so a run that crosses midnight still hits the cache. */
  now: Date
  log: (line: string) => void
  quotaNote: () => string
}

const DAY_MS = 86_400_000

export const dayOf = (now: Date): IsoDate => now.toISOString().slice(0, 10)
export const dayBefore = (day: IsoDate): IsoDate =>
  new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)

export const dirOf = (ctx: CliContext) => snapshotDir(ctx.root, ctx.mock)

export const readHitlist = (ctx: CliContext) =>
  readJson<HitlistSnapshot>(path.join(dirOf(ctx), SNAPSHOT_FILES.hitlist), 'run hitlist first')

/**
 * A live command refuses while the package has uncommitted changes, and
 * stamps what it writes with the committed code tree. Mock mode does neither.
 */
export async function codeStamp(
  ctx: CliContext,
): Promise<{ codeTree: string | null } | { refusal: string }> {
  if (ctx.mock) return { codeTree: null }
  const refusal = await packageRefusal(ctx.git)
  return refusal === null ? { codeTree: await ctx.git.objectAt(CODE_PATH) } : { refusal }
}

/** Said before a live pass 1 starts, so the owner knows a long first day is expected. */
export function passOneWarning(entries: number, dates: number): string {
  const at = dates === 1 ? 'one date' : `each of ${dates} dates`
  return (
    `Pass 1 walks ${entries.toLocaleString('en-US')} hitlist entries at ${at}. ` +
    'The first day can take several hours (pageviews, redirects and revisions are fetched ' +
    'politely, one request at a time); later runs read the cache.'
  )
}

export function countByLane(entries: HitlistEntry[]): Record<Lane | 'none', number> {
  const counts = { downfall: 0, success: 0, none: 0 }
  for (const e of entries) counts[laneOf(e.tags) ?? 'none']++
  return counts
}
