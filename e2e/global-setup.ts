import { e2eDatabaseUrl } from './database'

/** Named here and asserted on in `project-lifecycle.spec.ts`. */
export const QUEUED_PROJECT_TITLE = 'Just created, nothing mirrored yet (E2E)'
export const STOPPED_PROJECT_TITLE = 'Stopped, needs a way back (E2E)'
export const STALE_PROJECT_TITLE = 'Script written from an older dossier (E2E)'

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
  const url = e2eDatabaseUrl()

  const {
    createDb,
    createProjectFromCase,
    createScriptVersion,
    ensureRun,
    recordRunEvent,
    saveChapter,
    saveDossier,
    seed,
    setProjectStage,
    setRunStatus,
    truncateRunMirror,
    FIXTURE_CASE_ID,
    FIXTURE_PROJECT_ID,
    deleteCasesExcept,
    deleteProjectsExcept,
    updateSettings,
  } = await import('@boom-busters/db')
  const { truncateLedger } = await import('@boom-busters/cost')

  const connection = createDb(url, { max: 2 })
  try {
    await seed(connection.db)
    // Rows the previous run's tests created, before re-seeding leaves them
    // beside the fixture and every exact assertion starts matching twice.
    await deleteCasesExcept(connection.db, [FIXTURE_CASE_ID])
    // Including the projects seeded below, which hang off the fixture case and
    // so survive the line above. Two per run, accumulating silently, until a
    // title that should appear once appears four times.
    await deleteProjectsExcept(connection.db, [FIXTURE_PROJECT_ID])
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

    /**
     * A second project in the state every real project actually starts in:
     * `dossier`/`queued` with no run mirrored yet, because Inngest has been
     * handed `project/created` and has not picked it up in this millisecond.
     *
     * It exists because its absence let a serious bug ship. Every project test
     * drove the fixture above — parked at a gate, with a live run — so no test
     * ever loaded the first screen a human sees after making a project, and
     * nothing noticed that the screen offered them the M2 demo pipeline as its
     * only button.
     */
    await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: QUEUED_PROJECT_TITLE,
    })

    /**
     * And a project that was stopped: cancelled, with no run left behind it.
     *
     * This is where a human lands after pressing Stop, and it used to be a dead
     * end — the screen's only button started the M2 demo pipeline. Seeded
     * rather than produced by driving Stop in a test, because stopping is now
     * refused unless Inngest accepts the event and this suite runs no Inngest.
     */
    const stopped = await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: STOPPED_PROJECT_TITLE,
    })
    await setProjectStage(connection.db, stopped.id, {
      stage: 'dossier',
      stageStatus: 'cancelled',
    })

    /**
     * And a project whose script was written from research that has since been
     * replaced — built the way one really arises: research, script, re-research.
     *
     * `saveDossier` bumps `dossiers.version` on every save and
     * `createScriptVersion` stamps the version it read, so the second save is
     * what makes the script stale. Setting the columns by hand would test the
     * assertion rather than the mechanism.
     */
    const stale = await createProjectFromCase(connection.db, {
      caseId: FIXTURE_CASE_ID,
      title: STALE_PROJECT_TITLE,
    })
    await saveDossier(connection.db, {
      projectId: stale.id,
      contentMd: '# First pass\n\nThe research the script below was written from.',
      claims: [],
    })
    const staleScript = await createScriptVersion(connection.db, stale.id)
    await saveChapter(connection.db, {
      scriptId: staleScript.id,
      index: 0,
      title: 'Chapter written from the first pass',
      contentMd: 'Narration produced before the research was replaced.',
      estRuntimeSec: 60,
    })
    await saveDossier(connection.db, {
      projectId: stale.id,
      contentMd: '# Second pass\n\nThe research was re-run, so the script above is behind.',
      claims: [],
    })
    await setProjectStage(connection.db, stale.id, {
      stage: 'script',
      stageStatus: 'approved',
    })

    await updateSettings(connection.db, {
      budgets: { killSwitch: false, approvedOverages: {} },
    })
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}
