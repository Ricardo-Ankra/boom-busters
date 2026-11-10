import {
  chapterEndings,
  classifyEdit,
  countBySeverity,
  countWords,
  hedgeDensity,
  scriptTargetWords,
  tagDensity,
  warningsByKind,
  type GutterWarning,
} from '@boom-busters/schemas'
import type postgres from 'postgres'
import { createDb } from '../client'
import { testDatabaseUrl } from '../test-database'
import { loadEnvFiles } from './load-env'

/**
 * What each script version measures, as numbers rather than impressions
 * (decision 458).
 *
 *   pnpm script:score [--project <id>] [--prod]
 *
 * One table row per script version: words against the target, estimated
 * minutes, warnings by kind and by severity, hedge and tag density, how the
 * chapters end, and what the owner changed afterwards.
 *
 * **Read-only always.** By default it reads `TEST_DATABASE_URL` and refuses to
 * start without it. `--prod` reads `DATABASE_URL_UNPOOLED ?? DATABASE_URL`
 * through a session that cannot write, checks that with `show
 * default_transaction_read_only` before anything else, and runs every query in
 * a `read only` transaction. It prints counts and rates only: no claim text and
 * no chapter text reaches the terminal.
 */

interface Args {
  project?: string
  prod: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { prod: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--prod') args.prod = true
    else if (arg === '--project') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--project needs a project id')
      args.project = value
      i += 1
    } else throw new Error(`Unknown argument ${arg ?? ''}. Usage: [--project <id>] [--prod]`)
  }
  return args
}

function connectionUrl(prod: boolean): string {
  if (!prod) {
    const url = testDatabaseUrl()
    if (!url) {
      throw new Error(
        'TEST_DATABASE_URL is not set, so there is nothing to score. Start the local test ' +
          'database (see packages/db/src/test-database.ts), or pass --prod to read production.',
      )
    }
    return url
  }
  loadEnvFiles()
  const url = process.env['DATABASE_URL_UNPOOLED'] || process.env['DATABASE_URL']
  if (!url) throw new Error('--prod needs DATABASE_URL_UNPOOLED or DATABASE_URL.')
  return url
}

interface ScriptRow {
  scriptId: string
  title: string
  version: number
  status: string
  targetRuntimeMin: number
  format: { wordsPerMinute?: number; introLine?: string; outroLine?: string } | null
}

interface ChapterRow {
  scriptId: string
  chapterId: string
  contentMd: string
  estRuntimeSec: number
  warnings: GutterWarning[]
}

interface EditRow {
  chapterId: string
  beforeText: string
  afterText: string
  editType: string
}

interface Rows {
  scripts: ScriptRow[]
  chapters: ChapterRow[]
  edits: EditRow[]
}

/** Every query, inside one read-only transaction. */
async function fetchRows(sql: postgres.Sql, project: string | undefined): Promise<Rows> {
  return (await sql.begin('read only', async (tx) => {
    const scripts = await tx<ScriptRow[]>`
      select s.id as "scriptId", p.title, s.version, s.status,
             p.target_runtime_min as "targetRuntimeMin",
             (select f from jsonb_array_elements(cb.bible->'formats') f
              where f->>'key' = p.format_key limit 1) as format
      from scripts s
      join projects p on p.id = s.project_id
      left join channel_bibles cb on cb.id = p.bible_id
      where ${project ? tx`p.id = ${project}` : tx`true`}
      order by p.title, s.version`
    const chapters = await tx<ChapterRow[]>`
      select c.script_id as "scriptId", c.id as "chapterId", c.content_md as "contentMd",
             c.est_runtime_sec as "estRuntimeSec", c.warnings
      from chapters c
      join scripts s on s.id = c.script_id
      join projects p on p.id = s.project_id
      where ${project ? tx`p.id = ${project}` : tx`true`}
      order by c.script_id, c.index`
    const edits = await tx<EditRow[]>`
      select e.chapter_id as "chapterId", e.before_text as "beforeText",
             e.after_text as "afterText", e.edit_type as "editType"
      from script_edits e
      join chapters c on c.id = e.chapter_id
      join scripts s on s.id = c.script_id
      join projects p on p.id = s.project_id
      where ${project ? tx`p.id = ${project}` : tx`true`}`
    return { scripts, chapters, edits }
  })) as Rows
}

function tally(values: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts.size === 0
    ? '-'
    : [...counts]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, count]) => `${key}:${count}`)
        .join(' ')
}

/** One printable row per script version. */
function scoreRows(rows: Rows): Record<string, string | number>[] {
  return rows.scripts.map((script) => {
    const chapters = rows.chapters.filter((c) => c.scriptId === script.scriptId)
    const chapterIds = new Set(chapters.map((c) => c.chapterId))
    const edits = rows.edits.filter((e) => chapterIds.has(e.chapterId))
    const words = chapters.reduce((sum, c) => sum + countWords(c.contentMd), 0)
    const seconds = chapters.reduce((sum, c) => sum + c.estRuntimeSec, 0)
    const parsed = chapters.map((c) => ({ contentMd: c.contentMd, warnings: c.warnings ?? [] }))
    const severity = countBySeverity(parsed)
    const endings = chapterEndings(parsed)
    const target = script.format
      ? scriptTargetWords(script.targetRuntimeMin, script.format)
      : undefined
    const byKind = warningsByKind(parsed)

    return {
      project: script.title,
      version: script.version,
      status: script.status,
      words,
      'vs target': target === undefined ? 'n/a' : `${words}/${target}`,
      'est min': Math.round((seconds / 60) * 10) / 10,
      'warnings by kind': tally(Object.entries(byKind).flatMap(([k, n]) => Array(n).fill(k))),
      blocking: severity.blocking,
      advisory: severity.advisory,
      'hedge/100w': hedgeDensity(parsed),
      'tags/100w': tagDensity(parsed),
      'end on ?': endings.questions,
      'same ending': endings.sameShape,
      'edits by kind': tally(edits.map((e) => classifyEdit(e.beforeText, e.afterText))),
      'edits by type': tally(edits.map((e) => e.editType)),
    }
  })
}

function printScores(rows: readonly Record<string, string | number>[]): void {
  if (rows.length === 0) console.log('(no script versions)')
  else console.table(rows)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const { sql } = createDb(connectionUrl(args.prod), { max: 1, readOnly: args.prod })

  try {
    if (args.prod) {
      const [row] = await sql<{ default_transaction_read_only: string }[]>`
        show default_transaction_read_only`
      console.log(`default_transaction_read_only = ${row?.default_transaction_read_only}`)
      if (row?.default_transaction_read_only !== 'on') {
        throw new Error('The session is not read-only, so nothing was queried.')
      }
    }
    printScores(scoreRows(await fetchRows(sql, args.project)))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
