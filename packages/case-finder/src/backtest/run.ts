import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseNamedCaseScores } from '@boom-busters/providers'
import { CONFIG_VERSION } from '../config'
import { gatherAt, laneAt } from '../evidence'
import { laneOf } from '../hitlist/build'
import { KILL_LEGAL } from '../score/gates'
import { rank, type LaneResult, type Scored } from '../score/rank'
import { QuotaExhaustedError } from '../sources/quota'
import type { IsoDate, Lane } from '../types'
import { countByLane, dayBefore, dayOf, dirOf, readHitlist, type CliContext } from './context'
import { outcomeRatio } from './outcome'
import { renderReport, verdict, type CaseRow, type ReportMeta } from './report'
import {
  CODE_PATH,
  SNAPSHOT_FILES,
  liveRefusal,
  readFixture,
  readJson,
  staleRefusal,
  unlistedRefusal,
  writeJson,
  type ProposalsSnapshot,
  type UploadsSnapshot,
} from './snapshots'
import {
  selectTestSet,
  type SelectedSubject,
  type SubjectLanes,
  type SubjectProposal,
} from './subjects'

export type { CliContext } from './context'
export { runHitlist, runSubjects } from './prepare'
export { FIXTURE_PATH, type GitAdapter } from './snapshots'

/**
 * The back-test commands, with every outside dependency injected (sources,
 * git, the file-system root, the clock) so the CLI test runs them end to end
 * on mocks in a temp folder. `scripts/backtest.ts` only parses the arguments,
 * wires live or mock sources and calls these. This file is the `run` command;
 * prepare.ts builds its inputs.
 */

/** The paid baseline call, wired by the script to a provider adapter. */
export interface BaselineScorer {
  model: string
  /** One call; the reply's raw text, which the run saves before it parses anything. */
  ask(names: string[]): Promise<{ text: string; costUsd: number | null; answeredBy: string }>
}

const LANES: readonly Lane[] = ['downfall', 'success']

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

/**
 * The one paid call. Its raw reply is written to disk before it is parsed, so
 * an answer that fails to parse is kept rather than paid for twice.
 */
async function scoreBaseline(
  ctx: CliContext,
  baseline: BaselineScorer,
  usable: UsableCase[],
  rows: CaseRow[],
): Promise<void> {
  const names = [...new Set(usable.map((c) => c.name))]
  const reply = await baseline.ask(names)
  const saved = path.join(dirOf(ctx), `baseline-${dayOf(ctx.now)}.txt`)
  await mkdir(path.dirname(saved), { recursive: true })
  await writeFile(saved, reply.text)
  const cost = reply.costUsd === null ? 'cost unknown' : `cost $${reply.costUsd.toFixed(4)}`
  ctx.log(`baseline: ${baseline.model} (answered by ${reply.answeredBy}), ${cost}`)
  let scores: Map<string, number>
  try {
    scores = parseNamedCaseScores(reply.text, names)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    throw new Error(`The baseline reply did not parse (${why}). It is saved in ${saved}.`)
  }
  usable.forEach((c, i) => (rows[i]!.baseline = scores.get(c.name) ?? null))
  ctx.log(`baseline: ${scores.size} of ${names.length} names scored`)
}

/** Read every snapshot and the fixture; a live run checks each against the committed state. */
async function loadInputs(ctx: CliContext) {
  const dir = dirOf(ctx)
  const hitlist = await readHitlist(ctx)
  const uploads = await readJson<UploadsSnapshot>(
    path.join(dir, SNAPSHOT_FILES.uploads),
    'run subjects first',
  )
  const proposals = await readJson<ProposalsSnapshot>(
    path.join(dir, SNAPSHOT_FILES.proposals),
    'run subjects first',
  )
  if (!ctx.mock) {
    const stale = staleRefusal(await ctx.git.objectAt(CODE_PATH), [
      { file: SNAPSHOT_FILES.hitlist, command: 'hitlist', codeTree: hitlist.codeTree },
      { file: SNAPSHOT_FILES.uploads, command: 'subjects', codeTree: uploads.codeTree },
      { file: SNAPSHOT_FILES.proposals, command: 'subjects', codeTree: proposals.codeTree },
    ])
    if (stale !== null) return { refusal: stale }
  }
  const read = await readFixture(ctx.root, ctx.mock, proposals.proposals)
  if ('refusal' in read) return read
  const byQid = new Map(hitlist.entries.map((e) => [e.qid, e]))
  if (!ctx.mock) {
    const unlisted = unlistedRefusal(read.fixture, (qid) => byQid.has(qid))
    if (unlisted !== null) return { refusal: unlisted }
  }
  return { hitlist, uploads, proposals: proposals.proposals, fixture: read.fixture, byQid }
}

export async function runBacktest(
  ctx: CliContext,
  baseline: BaselineScorer | null,
): Promise<number> {
  const refusal = ctx.mock ? null : await liveRefusal(ctx.git)
  const inputs = refusal === null ? await loadInputs(ctx) : { refusal }
  if ('refusal' in inputs) {
    ctx.log(inputs.refusal)
    return 1
  }
  const { hitlist, uploads, proposals, fixture, byQid } = inputs
  const runDate = dayOf(ctx.now)
  // Every request is asked as of the hitlist's build day, so a rerun on any day hits the cache.
  const anchor = { anchorDay: hitlist.builtOn }
  const byVideo = new Map(proposals.map((p) => [p.videoId, p]))

  // Each subject's lanes at its own T and today, before selection, which needs them and is synchronous.
  const verdicts = new Map(fixture.map((f) => [f.videoId, f]))
  const lanesByVideo = new Map<string, SubjectLanes>()
  for (const p of proposals) {
    const f = verdicts.get(p.videoId)
    if (f?.verdict !== 'subject' || f.qid === null) continue
    const entry = byQid.get(f.qid)
    if (entry === undefined) continue
    lanesByVideo.set(p.videoId, {
      atT: await laneAt(entry, dayBefore(p.publishedAt), ctx.sources, anchor),
      today: laneOf(entry.tags),
    })
  }
  const { selected, note } = selectTestSet(
    fixture,
    proposals,
    (_qid, videoId) => lanesByVideo.get(videoId) ?? { atT: null, today: null },
  )

  const usable: UsableCase[] = []
  const unusable: ReportMeta['unusable'] = []
  for (const subject of selected) {
    const proposal = byVideo.get(subject.videoId)!
    const channel = uploads.channels[subject.channelHandle]
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
        // Views are as of the uploads fetch, so peers are settled relative to that day.
        outcome: outcomeRatio(video, channel, uploads.fetchedOn),
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
      const evidence = await gatherAt(hitlist.entries, T, ctx.sources, ctx.log, anchor)
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
  if (baseline !== null) await scoreBaseline(ctx, baseline, usable, rows)

  const meta: ReportMeta = {
    mock: ctx.mock,
    configVersion: CONFIG_VERSION,
    commit: await ctx.git.head(),
    baselineModel: baseline?.model ?? null,
    baselineAsked: baseline === null ? null : rows.length,
    baselineScored: baseline === null ? null : rows.filter((r) => r.baseline !== null).length,
    runDate,
    outcomeMeasuredOn: uploads.fetchedOn,
    quotaNote: ctx.quotaNote(),
    hitlistByLane: countByLane(hitlist.entries),
    unresolvedSeedNames: Object.values(hitlist.unresolvedBySeed).reduce((a, b) => a + b, 0),
    selectionNote: note,
    noLaneAtT: usable.filter((c) => c.subject.noLaneAtT).length,
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
