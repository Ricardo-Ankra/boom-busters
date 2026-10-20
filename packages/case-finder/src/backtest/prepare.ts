import path from 'node:path'
import { CHANNEL_HANDLES } from '../config'
import { buildHitlist } from '../hitlist/build'
import type { ChannelUploads } from '../types'
import { codeStamp, countByLane, dayOf, dirOf, readHitlist, type CliContext } from './context'
import {
  FIXTURE_PATH,
  SNAPSHOT_FILES,
  writeJson,
  type HitlistSnapshot,
  type ProposalsSnapshot,
  type UploadsSnapshot,
} from './snapshots'
import { proposeSubjects, type SubjectFixture } from './subjects'

/**
 * The commands that build the back-test's inputs before any run: the
 * hitlist snapshot, and the channel uploads with their proposed subjects
 * for the owner's hand-check.
 */

export async function runHitlist(
  ctx: CliContext,
  deps: { fetchText: (url: string) => Promise<string>; loPuckiCsv: string | null },
): Promise<number> {
  const stamp = await codeStamp(ctx)
  if ('refusal' in stamp) {
    ctx.log(stamp.refusal)
    return 1
  }
  let unresolvedBySeed: Record<string, number> = {}
  const entries = await buildHitlist({
    wikipedia: ctx.sources.wikipedia,
    wikidata: ctx.sources.wikidata,
    pageviews: ctx.sources.pageviews,
    fetchText: deps.fetchText,
    loPuckiCsv: deps.loPuckiCsv,
    log: ctx.log,
    now: () => ctx.now,
    onSummary: (s) => (unresolvedBySeed = s.unresolvedBySeed),
  })
  const snapshot: HitlistSnapshot = {
    builtOn: dayOf(ctx.now),
    codeTree: stamp.codeTree,
    entries,
    unresolvedBySeed,
  }
  await writeJson(path.join(dirOf(ctx), SNAPSHOT_FILES.hitlist), snapshot)
  const lanes = countByLane(entries)
  const unresolved = Object.values(unresolvedBySeed).reduce((a, b) => a + b, 0)
  ctx.log(
    `hitlist: ${entries.length} entries (downfall ${lanes.downfall}, success ${lanes.success}, ` +
      `no lane ${lanes.none}); ${unresolved} seed names unresolved`,
  )
  return 0
}

export async function runSubjects(ctx: CliContext): Promise<number> {
  const stamp = await codeStamp(ctx)
  if ('refusal' in stamp) {
    ctx.log(stamp.refusal)
    return 1
  }
  const hitlist = await readHitlist(ctx)
  const uploads = new Map<string, ChannelUploads>()
  for (const handle of CHANNEL_HANDLES) {
    const channel = await ctx.sources.youtube.channelByHandle(handle)
    // Every page: the outcome measure needs each channel's whole history.
    uploads.set(
      handle,
      await ctx.sources.youtube.uploads(channel.channelId, channel.uploadsPlaylistId),
    )
  }
  const proposals = proposeSubjects(uploads, hitlist.entries)
  const draft: SubjectFixture[] = proposals.map((p) =>
    p.proposedQid === null
      ? { videoId: p.videoId, qid: null, verdict: 'miss-not-on-hitlist', note: 'lane: ?' }
      : { videoId: p.videoId, qid: p.proposedQid, verdict: 'subject' },
  )
  const dir = dirOf(ctx)
  const uploadsSnapshot: UploadsSnapshot = {
    fetchedOn: dayOf(ctx.now),
    codeTree: stamp.codeTree,
    channels: Object.fromEntries(uploads),
  }
  const proposalsSnapshot: ProposalsSnapshot = { codeTree: stamp.codeTree, proposals }
  await writeJson(path.join(dir, SNAPSHOT_FILES.uploads), uploadsSnapshot)
  await writeJson(path.join(dir, SNAPSHOT_FILES.proposals), proposalsSnapshot)
  await writeJson(path.join(dir, 'backtest-subjects.draft.json'), draft)
  const matched = proposals.filter((p) => p.proposedQid !== null).length
  ctx.log(
    `subjects: ${[...uploads.values()].reduce((n, c) => n + c.uploads.length, 0)} uploads; ` +
      `${proposals.length} long-form proposals, ${matched} with a proposed subject. ` +
      `Hand-check backtest-subjects.draft.json into ${FIXTURE_PATH} and commit it.`,
  )
  return 0
}
