#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  createCase,
  createProjectFromCase,
  deleteCase,
  deleteProject,
  listDossierDocuments,
  projectLedgerSummary,
} from '@boom-busters/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import type { AnswerComplete } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import {
  BACKTEST_CASES,
  renderReport,
  scoreRuns,
  timedSteps,
  type CaseRun,
} from '@/lib/dossier-backtest'
import { db } from '@/lib/db'
import { optionalText, readRawFlags } from '@/lib/live-set-args'
import { liveResearchSources } from '@/lib/research-sources'
import { gatherCorpus } from '@/inngest/lib/dossier-gather'
import { loadCorpus, researchDossier } from '@/inngest/lib/dossier-research'
import { inlineSteps } from '@/inngest/lib/steps'

/**
 * The dossier back-test (spec section 9): the real gather and the four
 * research passes on closed cases, scored mechanically and written to
 * `docs/cases/dossier-backtest-<date>.md`.
 *
 * It spends real money and writes to the database `.env.local` names, so each
 * case gets a throwaway case and project row, removed in a `finally`. The
 * cost ledger rows stay (the spend was real) but lose their project link, so
 * cost and model are read before the delete.
 *
 * The cap is checked before every model call, not inside one: a single call
 * can overshoot it, which is why the default is $1 and a higher cap is the
 * owner's word. The ledger's own monthly guard still applies on top.
 */

const MAX_CAP_USD = 30

function parseArgs(argv: readonly string[]): { cap: number; titles: string[] } {
  const raw = readRawFlags(argv)
  const capText = raw.cap
  const cap = capText === undefined || capText.trim() === '' ? 1 : Number(capText)
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(`--cap "${capText}" is not a valid dollar amount; give a number above 0.`)
  }
  if (cap > MAX_CAP_USD) throw new Error(`--cap may not pass $${MAX_CAP_USD}.`)

  const known = BACKTEST_CASES.map((c) => c.title)
  const chosen = optionalText(raw, 'cases')
  const titles = chosen ? chosen.split(',').map((title) => title.trim()) : [...known]
  const unknown = titles.filter((title) => !known.some((name) => name === title))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown case ${unknown.join(', ')}; the back-test cases are ${known.join(', ')}.`,
    )
  }
  return { cap, titles }
}

/** Refuses a call once the run's spend has reached the cap. */
function capped(
  inner: AnswerComplete,
  spentSoFar: () => Promise<number>,
  cap: number,
): AnswerComplete {
  return async (request, call) => {
    const spent = await spentSoFar()
    if (spent >= cap) {
      throw new Error(
        `The run has spent $${spent.toFixed(2)}, at its $${cap.toFixed(2)} cap. Ask the owner before spending more.`,
      )
    }
    return inner(request, call)
  }
}

async function main(): Promise<void> {
  // The back-test measures real documents and real model answers; a mock run
  // would score fixtures and report a pass that means nothing.
  if (mockProvidersEnabled()) {
    throw new Error(
      "MOCK_PROVIDERS=1 is set. The back-test measures the real gather and the real passes, so a mock run would score fixtures. Unset it and run again with the owner's go-ahead. Nothing was spent.",
    )
  }
  const { cap, titles } = parseArgs(process.argv.slice(2))
  const sources = liveResearchSources()
  const runs: CaseRun[] = []
  const skipped: { title: string; reason: string }[] = []
  let spent = 0

  for (const title of titles) {
    if (spent >= cap) {
      skipped.push({
        title,
        reason: `not started: the run had spent $${spent.toFixed(2)} of its cap`,
      })
      continue
    }
    const category = BACKTEST_CASES.find((c) => c.title === title)!.category
    const row = await createCase(db, { title, category })
    const project = await createProjectFromCase(db, { caseId: row.id, title })
    const before = spent
    try {
      console.log(`${title}: gathering`)
      const gathered = await gatherCorpus(
        inlineSteps,
        { projectId: project.id, caseTitle: title, competitorLinks: [], round: 0 },
        { db, sources: () => sources, mocked: false },
      )
      const loaded = await loadCorpus(db, project.id)
      const complete = capped(
        completeForProject(project.id),
        async () => before + (await projectLedgerSummary(db, project.id)).costUsd,
        cap,
      )
      console.log(`${title}: researching ${loaded.documents.length} documents`)
      // Each pass is one step in production, so its time here is the time
      // that step would take against the 300 s limit.
      const timed = timedSteps(inlineSteps)
      const result = await researchDossier(
        timed.steps,
        {
          projectId: project.id,
          caseContext: { title, category, angle: null, demandNotes: null },
          round: 0,
          entity: gathered.entity,
          documents: loaded.documents,
          corpus: loaded.corpus,
        },
        { complete, mocked: false },
      )
      if (result.budgetGate)
        throw new Error('A budget guard parked the passes before they finished.')

      const rows = await listDossierDocuments(db, project.id)
      let xbrl: unknown | null = null
      if (gathered.entity.cik !== null) {
        // The stored document holds the rendered fact lines, not the JSON the check reads.
        xbrl = await sources.xbrl.companyFacts(gathered.entity.cik).catch(() => null)
      }
      const ledger = await projectLedgerSummary(db, project.id)
      spent = before + ledger.costUsd
      runs.push({
        title,
        claims: result.claims,
        research: result.research,
        documents: rows.map((doc) => ({
          id: doc.id,
          url: doc.url,
          httpStatus: doc.httpStatus,
          archivedUrl: doc.archivedUrl,
          kind: doc.kind,
          failure: doc.failure,
          transcript: doc.kind === 'video' && doc.meta?.transcript === true,
        })),
        xbrl,
        // Grounding notes each beat it drops for lacking a transcript quote;
        // they are the only trace of the beats the model wrote but lost.
        beatsDropped: result.repairs.filter(
          (repair) =>
            repair.action === 'dropped' &&
            repair.field.startsWith('told-already beat') &&
            repair.reason.includes('video transcript'),
        ).length,
        costUsd: ledger.costUsd,
        model: ledger.models.join(', ') || 'none recorded',
        passDurationsMs: timed.durations,
      })
      console.log(`${title}: done, $${ledger.costUsd.toFixed(2)}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      // What a failed case cost is still spent: it counts against the cap.
      // A failing ledger read must not stop the report being written.
      spent =
        before +
        (await projectLedgerSummary(db, project.id).then(
          (l) => l.costUsd,
          () => spent - before,
        ))
      skipped.push({ title, reason })
      console.error(`${title}: failed, ${reason}`)
    } finally {
      await deleteProject(db, project.id).catch((e) => console.error(`${title}: cleanup failed`, e))
      await deleteCase(db, row.id).catch(() => undefined)
    }
  }

  const date = new Date().toISOString().slice(0, 10)
  let markdown = renderReport(
    scoreRuns(
      runs,
      skipped.map((item) => item.title),
    ),
    date,
  )
  if (skipped.length > 0) {
    markdown += [
      '## Cases not scored',
      '',
      ...skipped.map((item) => `- ${item.title}: ${item.reason}`),
      '',
    ].join('\n')
  }
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  const outDir = path.join(repoRoot, 'docs', 'cases')
  mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `dossier-backtest-${date}.md`)
  writeFileSync(file, markdown)
  console.log(file)
  console.log(`Total spent: $${spent.toFixed(2)}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
