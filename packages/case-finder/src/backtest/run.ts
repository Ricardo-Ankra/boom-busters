import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CHANNEL_HANDLES, CONFIG_VERSION } from '../config'
import { gatherAt, laneAt, type Sources } from '../evidence'
import { buildHitlist, laneOf } from '../hitlist/build'
import { KILL_LEGAL } from '../score/gates'
import { rank, type LaneResult, type Scored } from '../score/rank'
import { QuotaExhaustedError } from '../sources/quota'
import type { ChannelUploads, HitlistEntry, IsoDate, Lane } from '../types'
import { outcomeRatio } from './outcome'
import { renderReport, verdict, type CaseRow, type ReportMeta } from './report'
import {
  proposeSubjects,
  selectTestSet,
  type SelectedSubject,
  type SubjectFixture,
  type SubjectProposal,
} from './subjects'

/**
 * The back-test's three commands, with every outside dependency injected
 * (sources, git, the file-system root, the clock) so the CLI test runs them
 * end to end on mocks in a temp folder. `scripts/backtest.ts` only parses the
 * arguments, wires live or mock sources and calls these.
 */

export const CONFIG_PATH = 'packages/case-finder/src/config.ts'
export const FIXTURE_PATH = 'packages/case-finder/fixtures/backtest-subjects.json'

export interface GitAdapter {
  /** `git status --porcelain -- <path>`, the path relative to the repo root. */
  porcelain(relPath: string): Promise<string>
  /** Whether `git ls-files --error-unmatch -- <path>` succeeds. */
  isTracked(relPath: string): Promise<boolean>
  /** The short HEAD commit. */
  head(): Promise<string>
}

/** The paid baseline call, wired by the script to a provider adapter. */
export interface BaselineScorer {
  model: string
  score(names: string[]): Promise<{ scores: Map<string, number>; costUsd: number | null }>
}

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

interface HitlistSnapshot {
  builtOn: IsoDate
  entries: HitlistEntry[]
  unresolvedBySeed: Record<string, number>
}

const LANES: readonly Lane[] = ['downfall', 'success']
const DAY_MS = 86_400_000

const dayOf = (now: Date): IsoDate => now.toISOString().slice(0, 10)
const dayBefore = (day: IsoDate): IsoDate =>
  new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)

/** Mock snapshots sit apart, so a mock hitlist can never feed a live `subjects` or `run`. */
const snapshotDir = (ctx: CliContext) =>
  path.join(ctx.root, '.cache', 'case-finder', ...(ctx.mock ? ['mock'] : []))

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

async function readJson<T>(file: string, missing: string): Promise<T> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new Error(`${path.basename(file)} is missing: ${missing}`)
  }
  return JSON.parse(text) as T
}

const readHitlist = (ctx: CliContext) =>
  readJson<HitlistSnapshot>(path.join(snapshotDir(ctx), 'hitlist.json'), 'run hitlist first')

function countByLane(entries: HitlistEntry[]): Record<Lane | 'none', number> {
  const counts = { downfall: 0, success: 0, none: 0 }
  for (const e of entries) counts[laneOf(e.tags) ?? 'none']++
  return counts
}

export async function runHitlist(
  ctx: CliContext,
  deps: { fetchText: (url: string) => Promise<string>; loPuckiCsv: string | null },
): Promise<number> {
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
  const snapshot: HitlistSnapshot = { builtOn: dayOf(ctx.now), entries, unresolvedBySeed }
  await writeJson(path.join(snapshotDir(ctx), 'hitlist.json'), snapshot)
  const lanes = countByLane(entries)
  const unresolved = Object.values(unresolvedBySeed).reduce((a, b) => a + b, 0)
  ctx.log(
    `hitlist: ${entries.length} entries (downfall ${lanes.downfall}, success ${lanes.success}, ` +
      `no lane ${lanes.none}); ${unresolved} seed names unresolved`,
  )
  return 0
}

export async function runSubjects(ctx: CliContext): Promise<number> {
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
  const dir = snapshotDir(ctx)
  await writeJson(path.join(dir, 'channel-uploads.json'), Object.fromEntries(uploads))
  await writeJson(path.join(dir, 'subject-proposals.json'), proposals)
  await writeJson(path.join(dir, 'backtest-subjects.draft.json'), draft)
  const matched = proposals.filter((p) => p.proposedQid !== null).length
  ctx.log(
    `subjects: ${[...uploads.values()].reduce((n, c) => n + c.uploads.length, 0)} uploads; ` +
      `${proposals.length} long-form proposals, ${matched} with a proposed subject. ` +
      `Hand-check backtest-subjects.draft.json into ${FIXTURE_PATH} and commit it.`,
  )
  return 0
}

/** Why a live run must not start, or null. The pre-registration rests on these (spec anti-goals). */
async function liveRefusal(git: GitAdapter): Promise<string | null> {
  if ((await git.porcelain(CONFIG_PATH)).trim() !== '') {
    return `Refusing a live run: ${CONFIG_PATH} has uncommitted changes. Its values are pre-registered; commit them first.`
  }
  if (!(await git.isTracked(FIXTURE_PATH))) {
    return `Refusing a live run: ${FIXTURE_PATH} is not committed. Hand-check the subjects draft and commit it first.`
  }
  if ((await git.porcelain(FIXTURE_PATH)).trim() !== '') {
    return `Refusing a live run: ${FIXTURE_PATH} has uncommitted changes. Commit the hand-check first.`
  }
  return null
}

/**
 * The hand-checked fixture. A mock run without one (ruling R14) takes every
 * proposal with a proposed subject as that subject and skips the rest, so the
 * mock path runs end to end; its report says MOCK.
 */
async function readFixture(
  ctx: CliContext,
  proposals: SubjectProposal[],
): Promise<SubjectFixture[]> {
  const file = path.join(ctx.root, FIXTURE_PATH)
  try {
    return JSON.parse(await readFile(file, 'utf8')) as SubjectFixture[]
  } catch (error) {
    if (!ctx.mock) throw error
    return proposals.map((p) =>
      p.proposedQid === null
        ? { videoId: p.videoId, qid: null, verdict: 'skip-not-single' }
        : { videoId: p.videoId, qid: p.proposedQid, verdict: 'subject' },
    )
  }
}

/** A miss names its subject in the fixture note (`name: ...`, up to a `;`), if the checker gave one. */
function missName(note: string | undefined): string | null {
  const m = /name:\s*([^;\n]+)/.exec(note ?? '')
  return m ? m[1]!.trim() : null
}

interface UsableCase {
  subject: SelectedSubject
  proposal: SubjectProposal
  T: IsoDate
  outcome: number
  /** What the baseline is asked to score. */
  name: string
}

/** One case's row from its T's ranking. A miss has no hitlist entry and is never scored. */
function caseRow(c: UsableCase, ranking: Record<Lane, LaneResult> | undefined): CaseRow {
  const base: CaseRow = {
    videoId: c.subject.videoId,
    channel: c.subject.channelHandle,
    title: c.proposal.title,
    T: c.T,
    lane: c.subject.lane,
    qid: c.subject.qid,
    status: 'miss',
    pct: null,
    score: 0,
    legalKillWouldApply: false,
    baseline: null,
    outcome: c.outcome,
    spike: null,
  }
  if (c.subject.verdict === 'miss-not-on-hitlist') return base
  if (ranking === undefined) throw new Error(`No ranking at ${c.T} for ${c.subject.videoId}`)
  const scoredRow = (s: Scored, status: CaseRow['status']): CaseRow => ({
    ...base,
    status,
    pct: s.pct,
    score: s.score,
    legalKillWouldApply: s.gates.kill === KILL_LEGAL,
    spike: s.raw.spike,
  })
  for (const lane of LANES) {
    const result = ranking[lane]
    const ranked = result.shortlist.find((s) => s.qid === c.subject.qid)
    if (ranked) return scoredRow(ranked, 'ranked')
    // The back-test ranks with the legal kill off, so only the paper-trail kill is left here.
    const killed = result.killed.find((s) => s.qid === c.subject.qid)
    if (killed) return scoredRow(killed, 'paper trail none')
    const unranked = result.unranked.find((u) => u.qid === c.subject.qid)
    if (unranked) return { ...base, status: unranked.reason }
  }
  throw new Error(`${c.subject.qid} is not in the ranking at ${c.T}`)
}

export async function runBacktest(
  ctx: CliContext,
  baseline: BaselineScorer | null,
): Promise<number> {
  if (!ctx.mock) {
    const refusal = await liveRefusal(ctx.git)
    if (refusal !== null) {
      ctx.log(refusal)
      return 1
    }
  }
  const runDate = dayOf(ctx.now)
  const now = () => ctx.now
  const dir = snapshotDir(ctx)
  const hitlist = await readHitlist(ctx)
  const channels = await readJson<Record<string, ChannelUploads>>(
    path.join(dir, 'channel-uploads.json'),
    'run subjects first',
  )
  const proposals = await readJson<SubjectProposal[]>(
    path.join(dir, 'subject-proposals.json'),
    'run subjects first',
  )
  const fixture = await readFixture(ctx, proposals)
  const byQid = new Map(hitlist.entries.map((e) => [e.qid, e]))
  const byVideo = new Map(proposals.map((p) => [p.videoId, p]))

  // Each subject's lane at its own T, before selection, which needs lanes and is synchronous.
  const verdicts = new Map(fixture.map((f) => [f.videoId, f]))
  const laneByVideo = new Map<string, Lane | null>()
  for (const p of proposals) {
    const f = verdicts.get(p.videoId)
    if (f?.verdict !== 'subject' || f.qid === null) continue
    const entry = byQid.get(f.qid)
    laneByVideo.set(
      p.videoId,
      entry === undefined
        ? null
        : await laneAt(entry, dayBefore(p.publishedAt), ctx.sources, { now }),
    )
  }
  const { selected, note } = selectTestSet(
    fixture,
    proposals,
    (_qid, videoId) => laneByVideo.get(videoId) ?? null,
  )

  const usable: UsableCase[] = []
  const unusable: ReportMeta['unusable'] = []
  for (const subject of selected) {
    const proposal = byVideo.get(subject.videoId)!
    const channel = channels[subject.channelHandle]
    const video = channel?.uploads.find((v) => v.id === subject.videoId)
    try {
      if (channel === undefined || video === undefined) {
        throw new Error(`Video ${subject.videoId} is not in the saved uploads`)
      }
      const name =
        subject.verdict === 'subject'
          ? (byQid.get(subject.qid!)?.enTitle ?? proposal.title)
          : (missName(subject.note) ?? proposal.title)
      usable.push({
        subject,
        proposal,
        T: dayBefore(proposal.publishedAt),
        outcome: outcomeRatio(video, channel, runDate),
        name,
      })
    } catch (error) {
      unusable.push({
        videoId: subject.videoId,
        title: proposal.title,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const dates = [
    ...new Set(usable.filter((c) => c.subject.verdict === 'subject').map((c) => c.T)),
  ].sort()
  const rankings = new Map<IsoDate, Record<Lane, LaneResult>>()
  try {
    for (const T of dates) {
      const evidence = await gatherAt(hitlist.entries, T, ctx.sources, ctx.log, { now })
      rankings.set(T, rank(evidence, { applyLegalKill: false }))
    }
  } catch (error) {
    if (!(error instanceof QuotaExhaustedError)) throw error
    ctx.log(
      `${error.message}. ${rankings.size} of ${dates.length} test dates complete, ` +
        `${dates.length - rankings.size} remain. Everything fetched is cached; rerun tomorrow to resume.`,
    )
    return 2
  }
  const rows = usable.map((c) => caseRow(c, rankings.get(c.T)))

  if (baseline !== null) {
    const names = [...new Set(usable.map((c) => c.name))]
    const { scores, costUsd } = await baseline.score(names)
    usable.forEach((c, i) => (rows[i]!.baseline = scores.get(c.name) ?? null))
    const cost = costUsd === null ? 'cost unknown' : `cost $${costUsd.toFixed(4)}`
    ctx.log(`baseline: ${baseline.model}, ${scores.size} of ${names.length} names scored, ${cost}`)
  }

  const meta: ReportMeta = {
    mock: ctx.mock,
    configVersion: CONFIG_VERSION,
    commit: await ctx.git.head(),
    baselineModel: baseline?.model ?? null,
    runDate,
    quotaNote: ctx.quotaNote(),
    hitlistByLane: countByLane(hitlist.entries),
    unresolvedSeedNames: Object.values(hitlist.unresolvedBySeed).reduce((a, b) => a + b, 0),
    selectionNote: note,
    unusable,
  }
  const v = verdict(rows)
  const stem = path.join(
    ctx.root,
    'docs',
    'case-finder',
    `backtest-${runDate}${ctx.mock ? '-mock' : ''}`,
  )
  await mkdir(path.dirname(stem), { recursive: true })
  await writeFile(`${stem}.md`, renderReport(rows, v, meta))
  await writeJson(`${stem}-cases.json`, { meta, verdict: v, rows, unusable })
  ctx.log(`report: ${path.relative(ctx.root, `${stem}.md`)}`)
  return 0
}
