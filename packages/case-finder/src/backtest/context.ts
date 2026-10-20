import path from 'node:path'
import type { Sources } from '../evidence'
import { laneOf } from '../hitlist/build'
import type { HitlistEntry, IsoDate, Lane } from '../types'
import {
  CONFIG_PATH,
  SNAPSHOT_FILES,
  configRefusal,
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
 * A live command that writes a snapshot refuses while config.ts is
 * uncommitted, and stamps what it writes with the committed blob.
 */
export async function configBlob(
  ctx: CliContext,
): Promise<{ blob: string | null } | { refusal: string }> {
  if (ctx.mock) return { blob: null }
  const refusal = await configRefusal(ctx.git)
  return refusal === null ? { blob: await ctx.git.blob(CONFIG_PATH) } : { refusal }
}

export function countByLane(entries: HitlistEntry[]): Record<Lane | 'none', number> {
  const counts = { downfall: 0, success: 0, none: 0 }
  for (const e of entries) counts[laneOf(e.tags) ?? 'none']++
  return counts
}
