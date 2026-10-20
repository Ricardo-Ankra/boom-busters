import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChannelUploads, HitlistEntry, IsoDate } from '../types'
import { SubjectFixturesSchema, type SubjectFixture, type SubjectProposal } from './subjects'

/**
 * What the back-test commands hand to each other on disk, and the checks
 * that keep a live run honest: the whole package (config, seeds, scorer and
 * the hand-checked fixture) is committed, every snapshot was built from the
 * committed code, and the fixture says what the run will read. Mock mode
 * skips the checks (R14).
 */

export const PACKAGE_PATH = 'packages/case-finder'
/** The code every snapshot is stamped with: what builds the hitlist, gathers and scores. */
export const CODE_PATH = 'packages/case-finder/src'
export const FIXTURE_PATH = 'packages/case-finder/fixtures/backtest-subjects.json'

export interface GitAdapter {
  /** `git status --porcelain -- <path>`, the path relative to the repo root. */
  porcelain(relPath: string): Promise<string>
  /** Whether `git ls-files --error-unmatch -- <path>` succeeds. */
  isTracked(relPath: string): Promise<boolean>
  /** The full HEAD commit hash (`git rev-parse HEAD`). */
  head(): Promise<string>
  /** `git rev-parse HEAD:<path>`: the committed object id at a path (a tree for a folder). */
  objectAt(relPath: string): Promise<string>
}

/**
 * Each snapshot records the tree id of the committed packages/case-finder/src
 * it was built from (null in mock mode), so a live run can tell a snapshot
 * built before any change to the config, the seeds or the scorer.
 */
export interface HitlistSnapshot {
  builtOn: IsoDate
  codeTree: string | null
  entries: HitlistEntry[]
  unresolvedBySeed: Record<string, number>
}

export interface UploadsSnapshot {
  /** The outcome measure's date: views are as of this fetch. */
  fetchedOn: IsoDate
  codeTree: string | null
  channels: Record<string, ChannelUploads>
}

export interface ProposalsSnapshot {
  codeTree: string | null
  proposals: SubjectProposal[]
}

export const SNAPSHOT_FILES = {
  hitlist: 'hitlist.json',
  uploads: 'channel-uploads.json',
  proposals: 'subject-proposals.json',
} as const

/** Mock snapshots sit apart, so a mock hitlist can never feed a live `subjects` or `run`. */
export const snapshotDir = (root: string, mock: boolean) =>
  path.join(root, '.cache', 'case-finder', ...(mock ? ['mock'] : []))

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

export async function readJson<T>(file: string, missing: string): Promise<T> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new Error(`${path.basename(file)} is missing: ${missing}`)
  }
  return JSON.parse(text) as T
}

/**
 * Why the package stops a live command, or null when it is all committed.
 * Not config.ts alone: the seeds, the tag dating and the scorer decide the
 * result as much as the weights do, and all of it is pre-registered.
 */
export async function packageRefusal(git: GitAdapter): Promise<string | null> {
  const changed = (await git.porcelain(PACKAGE_PATH))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (changed.length === 0) return null
  return (
    `Refusing a live run: ${PACKAGE_PATH} has uncommitted changes (${changed.join('; ')}). ` +
    `Everything it builds, gathers and scores with is pre-registered; commit it first.`
  )
}

/** Why a live `run` must not start, or null. The pre-registration rests on these (spec anti-goals). */
export async function liveRefusal(git: GitAdapter): Promise<string | null> {
  const dirty = await packageRefusal(git)
  if (dirty !== null) return dirty
  if (!(await git.isTracked(FIXTURE_PATH))) {
    return `Refusing a live run: ${FIXTURE_PATH} is not committed. Hand-check the subjects draft and commit it first.`
  }
  return null
}

/** Snapshots built from code other than the committed packages/case-finder/src, named with the command that rebuilds each. */
export function staleRefusal(
  current: string,
  snapshots: { file: string; command: string; codeTree: string | null }[],
): string | null {
  const stale = snapshots.filter((s) => s.codeTree !== current)
  if (stale.length === 0) return null
  const commands = [...new Set(stale.map((s) => `${s.command} --live`))].join(' then ')
  return (
    `Refusing a live run: ${stale.map((s) => s.file).join(', ')} ` +
    `${stale.length === 1 ? 'was' : 'were'} not built from the committed ${CODE_PATH}. ` +
    `Rebuild with ${commands}.`
  )
}

/**
 * The hand-checked fixture, checked against its schema. A mock run without
 * one (ruling R14) takes every proposal with a proposed subject as that
 * subject and skips the rest, so the mock path runs end to end.
 */
export async function readFixture(
  root: string,
  mock: boolean,
  proposals: SubjectProposal[],
): Promise<{ fixture: SubjectFixture[] } | { refusal: string }> {
  let text: string
  try {
    text = await readFile(path.join(root, FIXTURE_PATH), 'utf8')
  } catch (error) {
    if (!mock) throw error
    return {
      fixture: proposals.map((p) =>
        p.proposedQid === null
          ? { videoId: p.videoId, qid: null, verdict: 'skip-not-single' }
          : { videoId: p.videoId, qid: p.proposedQid, verdict: 'subject' },
      ),
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { refusal: `Refusing the run: ${FIXTURE_PATH} is not JSON (${String(error)})` }
  }
  const parsed = SubjectFixturesSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    return { refusal: `Refusing the run: ${FIXTURE_PATH} is malformed: ${issues.join('; ')}` }
  }
  return { fixture: parsed.data }
}

/** A subject verdict must name a hitlist entry; otherwise the case is a miss and must say so. */
export function unlistedRefusal(
  fixture: SubjectFixture[],
  onHitlist: (qid: string) => boolean,
): string | null {
  const bad = fixture.filter(
    (f) => f.verdict === 'subject' && (f.qid === null || !onHitlist(f.qid)),
  )
  if (bad.length === 0) return null
  return (
    `Refusing a live run: these subject verdicts name a QID that is not on hitlist.json: ` +
    `${bad.map((f) => `${f.videoId} (${f.qid ?? 'no QID'})`).join(', ')}. ` +
    `Mark them 'miss-not-on-hitlist' with a "lane: downfall" or "lane: success" note.`
  )
}
