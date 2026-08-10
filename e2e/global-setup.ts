import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Put the database into a known state before the suite runs.
 *
 * Without this the E2E suite inherits whatever the Inngest integration tests
 * left behind — a fixture project that is `done`, a ledger full of demo rows,
 * a run mirror with old events. Assertions written against "the fixture
 * project awaits review" would then pass or fail depending on test order,
 * which is the worst kind of flake.
 */
export default async function globalSetup(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '..')
  for (const file of ['.env.local', '.env']) {
    const path = resolve(repoRoot, file)
    if (existsSync(path)) config({ path, override: false, quiet: true })
  }

  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('E2E needs DATABASE_URL — the app reads a real database.')

  const {
    createDb,
    ensureRun,
    recordRunEvent,
    seed,
    setProjectStage,
    setRunStatus,
    truncateRunMirror,
    FIXTURE_PROJECT_ID,
    updateSettings,
  } = await import('@boom-busters/db')
  const { truncateLedger } = await import('@boom-busters/cost')

  const connection = createDb(url, { max: 2 })
  try {
    await seed(connection.db)
    await truncateRunMirror(connection.db)
    await truncateLedger(connection.db)
    // A project parked at a gate, as the runner would leave it: the project
    // row *and* a mirrored run waiting on it. Setting only the project row
    // would produce the stranded state the project screen deliberately
    // refuses to offer gate buttons for.
    await setProjectStage(connection.db, FIXTURE_PROJECT_ID, {
      stage: 'dossier',
      stageStatus: 'awaiting_review',
      inngestRunId: null,
    })
    const runId = await ensureRun(connection.db, {
      inngestRunId: '01E2ESETUP0000000000000001',
      functionName: 'demo-runner',
      projectId: FIXTURE_PROJECT_ID,
      stage: 'dossier',
    })
    await recordRunEvent(connection.db, {
      runId,
      kind: 'gate.opened',
      message: 'Demo dossier ready · 0 claims · nothing was actually researched',
      data: { gate: 'dossier' },
    })
    await setRunStatus(connection.db, runId, 'awaiting_gate')
    await updateSettings(connection.db, {
      budgets: { killSwitch: false, approvedOverages: {} },
    })
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}
