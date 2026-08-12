import { createDb } from '../client'
import { requireDatabaseUrl } from './load-env'

/**
 * What states production has actually produced.
 *
 * Every serious bug in this project so far has come from one gap: fixtures
 * built from what a project was *expected* to look like, against a database
 * full of shapes nobody expected. A demo run parked at a real gate. A `running`
 * column with no run behind it. A script stage with no dossier. A chapter with
 * twenty-two warnings. None were in a fixture, so none were in a test, so every
 * one of them was found by a human clicking around instead.
 *
 * This is the antidote, and it is meant to be run: before designing fixtures
 * for a new milestone, and after any live walkthrough that turns something up.
 * Read the output, find a row the fixtures cannot produce, and go and add it —
 * `e2e/global-setup.ts` names each fixture after the shape it came from.
 *
 *   pnpm survey
 *
 * **Read-only, and deliberately pointed at the live database** (`DATABASE_URL`,
 * not `TEST_DATABASE_URL`): looking at real data is the entire point. It runs
 * `select` and nothing else, and prints counts and shapes rather than claim
 * text, so nothing worth keeping out of a shell history lands in one.
 */

interface Section {
  title: string
  /** What to do with the answer, not just what it is. */
  note?: string
  rows: () => Promise<readonly Record<string, unknown>[]>
}

async function main(): Promise<void> {
  const { sql } = createDb(requireDatabaseUrl(), { max: 1 })

  const sections: Section[] = [
    {
      title: 'project shapes',
      note: 'Each row is a state a project has really been in. A row the fixtures cannot produce is a gap.',
      rows: () => sql`
        select p.stage, p.stage_status,
          exists(select 1 from runs r where r.project_id = p.id
                 and r.status in ('running','awaiting_gate')) as live_run,
          (d.id is not null) as has_dossier,
          exists(select 1 from scripts s where s.project_id = p.id) as has_script,
          (p.cancelled_at is not null) as cancelled_stamp,
          count(*)::int as projects
        from projects p left join dossiers d on d.project_id = p.id
        group by 1,2,3,4,5,6 order by 1,2`,
    },
    {
      title: 'run outcomes by function',
      note: 'A function with failures here is one whose failure path needs a fixture.',
      rows: () => sql`
        select function_name, status, count(*)::int as runs
        from runs group by 1,2 order by 1,2`,
    },
    {
      title: 'distinct failures',
      note: 'The catalogue of shapes that broke us. Each deserves a parser or schema test.',
      rows: () => sql`
        select r.function_name, re.step_id, re.kind,
               left(re.message, 110) as message, count(*)::int as times
        from run_events re join runs r on r.id = re.run_id
        where re.kind in ('step.failed','run.failed','step.retry')
        group by 1,2,3,4 order by max(re.occurred_at) desc limit 30`,
    },
    {
      title: 'claim shapes, and their proportions',
      note: 'Match the mix, not just the enum. Most real claims are single-source reporting.',
      rows: () => sql`
        select confidence, source_type, quarantined,
               (source_url is null) as no_source, count(*)::int as claims
        from claims group by 1,2,3,4 order by 5 desc`,
    },
    {
      title: 'warning density per chapter',
      note: 'The busiest chapter is the one the editor gutter has to survive.',
      rows: () => sql`
        select jsonb_array_length(warnings) as warnings, count(*)::int as chapters
        from chapters group by 1 order by 1`,
    },
    {
      title: 'warning kinds produced',
      rows: () => sql`
        select w->>'kind' as kind, count(*)::int as warnings
        from chapters, jsonb_array_elements(warnings) w group by 1 order by 2 desc`,
    },
    {
      title: 'ledger operations',
      note: 'Which calls really happen, and what they really cost.',
      rows: () => sql`
        select provider, operation, count(*)::int as calls,
               round(sum(coalesce(actual_usd, estimated_usd))::numeric, 4) as usd,
               bool_or(actual_usd is null) as any_unsettled
        from cost_ledger group by 1,2 order by 4 desc nulls last`,
    },
    {
      title: 'run event kinds',
      note: 'What the activity drawer actually has to render.',
      rows: () => sql`
        select kind, count(*)::int as events from run_events group by 1 order by 2 desc`,
    },
  ]

  try {
    for (const section of sections) {
      console.log(`\n=== ${section.title} ===`)
      if (section.note) console.log(section.note)
      const rows = await section.rows()
      if (rows.length === 0) console.log('(none)')
      else console.table(rows)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
