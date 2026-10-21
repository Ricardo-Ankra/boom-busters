import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gatherPassOneAt } from '../evidence'
import { measure } from '../score/measure'
import { classify } from '../score/rank'
import type { EntryEvidence, IsoDate, Lane } from '../types'
import { codeStamp, dirOf, passOneWarning, readHitlist, type CliContext } from './context'
import { SNAPSHOT_FILES, staleRefusal } from './snapshots'

/**
 * The population check: what the ranked population looks like at a spread of
 * fixed dates, from pass 1 alone (pageviews and tags at T; no YouTube, no
 * pass 2). The floor may be adjusted once and the excluded Wikidata kinds
 * reviewed before the live run, and both must be judged from this, never
 * from the verdict, so the command knows nothing of the test set and writes
 * nothing under docs.
 */

/** Fixed, not the test dates: two years apart across the back-test's span. */
export const POPULATION_DATES: readonly IsoDate[] = [
  '2018-01-01',
  '2020-01-01',
  '2022-01-01',
  '2024-01-01',
  '2026-01-01',
]

const TOP_PER_LANE = 30
const LANES: readonly Lane[] = ['downfall', 'success']

const count = (n: number) => n.toLocaleString('en-US')

/** One date's block: population per lane, the unranked by reason, and each lane's top by demand. */
function dateLines(asOf: IsoDate, evidence: EntryEvidence[]): string[] {
  const { population, unranked } = classify(evidence)
  const reasons = (reason: string) => unranked.filter((u) => u.reason === reason).length
  const lines = [
    `## ${asOf}`,
    '',
    'Population after the floor and top 250: ' +
      LANES.map((lane) => `${lane} ${count(population.get(lane)!.length)}`).join(', '),
    `Below the floor: ${count(reasons('below floor'))}; no lane: ${count(reasons('no lane'))}; ` +
      `outside the top 250: ${count(reasons('outside top 250'))}`,
  ]
  for (const lane of LANES) {
    // classify orders each lane by demand, highest first.
    const top = population.get(lane)!.slice(0, TOP_PER_LANE)
    lines.push('', `${lane}, top ${TOP_PER_LANE} by demand:`)
    if (top.length === 0) lines.push('  (none)')
    top.forEach((e, i) => {
      const tags = e.tagsAtT.map((t) => t.tag).join(', ') || 'none'
      lines.push(
        `  ${i + 1}. ${e.entry.enTitle ?? '(no English title)'} (${e.entry.qid}): ` +
          `median ${count(Math.round(measure(e).enMedianMonthly))}; tags at T: ${tags}`,
      )
    })
  }
  return [...lines, '']
}

export async function runPopulation(ctx: CliContext): Promise<number> {
  const stamp = await codeStamp(ctx)
  if ('refusal' in stamp) {
    ctx.log(stamp.refusal)
    return 1
  }
  const hitlist = await readHitlist(ctx)
  if (!ctx.mock) {
    const stale = staleRefusal(stamp.codeTree!, [
      { file: SNAPSHOT_FILES.hitlist, command: 'hitlist', codeTree: hitlist.codeTree },
    ])
    if (stale !== null) {
      ctx.log(stale)
      return 1
    }
    ctx.log(passOneWarning(hitlist.entries.length, POPULATION_DATES.length))
  }
  const out = [
    `# ${ctx.mock ? 'MOCK: ' : ''}case-finder population check, hitlist built ${hitlist.builtOn}`,
    '',
  ]
  for (const asOf of POPULATION_DATES) {
    const evidence = await gatherPassOneAt(hitlist.entries, asOf, ctx.sources, ctx.log, {
      anchorDay: hitlist.builtOn,
    })
    const lines = dateLines(asOf, evidence)
    for (const line of lines) ctx.log(line)
    out.push(...lines)
  }
  const file = path.join(dirOf(ctx), 'population.txt')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, out.join('\n'))
  ctx.log(`population: ${path.relative(ctx.root, file)}`)
  return 0
}
