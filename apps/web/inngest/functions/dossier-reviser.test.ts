// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  bumpDossierRevisions,
  createCase,
  createProjectFromCase,
  createScriptVersion,
  deleteCase,
  deleteProject,
  getProject,
  listRunEvents,
  listRuns,
  markDossierApproved,
  requireTestDatabase,
  seed,
  setProjectStage,
  truncateRunMirror,
} from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import type { LLMTaskRequest } from '@boom-busters/providers'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { stageViewsForProject } from '@/lib/stage-view'
import { forgetRunRows } from '../middleware/run-mirror'
import { dossierReviser } from './dossier-reviser'

/**
 * The dossier-reviser up to its save: a revision reads the corpus the first
 * run linked, gathers only for a project that has none, hears the note in
 * every pass, and its repairs replace the dossier's notice. Research results
 * are handed in, or answered by a stubbed model; `saveDossier` is stubbed so
 * the fixture dossier is never rewritten.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
const saveDossier = vi.hoisted(() => vi.fn())
const real = vi.hoisted(() => ({ saveDossier: null as typeof Db.saveDossier | null }))
vi.mock('@boom-busters/db', async (importOriginal) => {
  const original = await importOriginal<typeof Db>()
  real.saveDossier = original.saveDossier
  return { ...original, saveDossier: (...args: unknown[]) => saveDossier(...args) }
})
const realSaveDossier: typeof Db.saveDossier = (...args) => real.saveDossier!(...args)

const describeDb = requireTestDatabase() ? describe : describe.skip

const NOTE = 'More on the auditors, please.'
const CASE = { title: 'Wirecard', category: 'con', angle: null, demandNotes: null }
const ENTITY = { qid: 'Q1', titles: ['Wirecard'], cik: null, ticker: null, website: null }
const DOCUMENTS = [
  {
    id: 'doc-ft',
    url: 'https://www.ft.com/content/wirecard',
    kind: 'reporting',
    title: 'Wirecard files for insolvency',
    publishedAt: '2020-06-25',
    text: 'Wirecard filed for insolvency in Munich on 25 June 2020.',
    archivedUrl: null,
    httpStatus: 200,
  },
  {
    id: 'doc-reuters',
    url: 'https://www.reuters.com/wirecard',
    kind: 'reporting',
    title: 'Wirecard applies for insolvency',
    publishedAt: '2020-06-25',
    text: 'The payments company applied for insolvency proceedings at the Munich district court.',
    archivedUrl: null,
    httpStatus: 200,
  },
]
// Two documents and two questions, so the claims and answers passes each run in two parts.
const CORPUS = { read: 2, unread: 0, failed: 0 }

const BRIEF = {
  summary:
    'Wirecard was a German payments company. It collapsed in June 2020 after EY refused to sign.',
  turningPoint: 'EY refused to sign the 2019 accounts.',
  cast: [],
  toldAlready: [],
  openQuestions: ['Where did the 1.9 billion euros go?', 'Who signed off on the escrow accounts?'],
}
const SCENES = [
  {
    when: 'June 2020',
    who: 'Wirecard',
    what: 'Filed for insolvency in Munich.',
    why: 'The end of the company the story follows.',
    doc: 1,
    quote: 'Wirecard filed for insolvency in Munich on 25 June 2020',
  },
]
const CLAIMS = [
  {
    text: 'Wirecard filed for insolvency in June 2020.',
    supports: [{ doc: 1, quote: 'Wirecard filed for insolvency in Munich on 25 June 2020' }],
    legal: null,
    series: null,
  },
]
const ANSWERS = {
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null }],
  claims: [],
}
const ANSWERS_2 = {
  answers: [{ index: 2, question: 'Who signed off on the escrow accounts?', answer: null }],
  claims: [],
}

const changesRequested = (): [{ name: string; data: Record<string, unknown> }] => [
  {
    name: 'gate/dossier.changes_requested',
    data: { projectId: FIXTURE_PROJECT_ID, note: NOTE },
  },
]

const loadCase = (linkedDocuments: number) => ({
  id: 'load-case',
  handler: () => ({
    round: 1,
    caseContext: CASE,
    competitorLinks: [],
    entity: ENTITY,
    linkedDocuments,
  }),
})
const corpusLoad = {
  id: 'corpus-load-1',
  handler: () => ({ documents: DOCUMENTS, corpus: CORPUS }),
}

const CORPUS_LINE = '2 documents read, 0 gathered not read, 0 could not be fetched'

/** Every research pass's stored result, so no model is called. */
const researchSteps = [
  {
    id: 'research-brief-1',
    handler: () => ({ ok: true, value: BRIEF, split: true }),
  },
  { id: 'research-scenes-1', handler: () => ({ ok: true, value: SCENES }) },
  { id: 'research-claims-1-1', handler: () => ({ ok: true, value: CLAIMS }) },
  { id: 'research-claims-1-2', handler: () => ({ ok: true, value: [] }) },
  { id: 'research-answers-1-1', handler: () => ({ ok: true, value: ANSWERS }) },
  { id: 'research-answers-1-2', handler: () => ({ ok: true, value: ANSWERS_2 }) },
]

const stepIds = (ctx: { step: { run: unknown } }) =>
  vi.mocked(ctx.step.run as (id: string) => unknown).mock.calls.map(([id]) => id)

/** Every run's, because the test engine gives each re-invocation a run id of its own. */
async function gateMessages(): Promise<string[]> {
  const messages: string[] = []
  for (const run of await listRuns(db)) {
    for (const event of await listRunEvents(db, run.id)) {
      if (event.kind === 'gate.opened') messages.push(event.message ?? '')
    }
  }
  return messages
}

describeDb('dossier-reviser', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: dossierReviser })
    recordRepairs.mockReset()
    callLlm.mockReset()
    saveDossier.mockReset()
    saveDossier.mockResolvedValue({ claims: [] })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    // The fixture's own stage, for the suites after this one.
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'queued' })
  })

  it("records the revision's repairs, reading a pass replayed without them as none", async () => {
    await engine.executeStep('save-revision', {
      events: changesRequested(),
      steps: [
        loadCase(1),
        corpusLoad,
        {
          id: 'research-brief-1',
          handler: () => ({
            ok: true,
            value: BRIEF,
            repairs: [{ action: 'trimmed', field: "the brief's turning point" }],
            split: true,
          }),
        },
        { id: 'research-scenes-1', handler: () => ({ ok: true, value: SCENES }) },
        {
          id: 'research-claims-1-1',
          handler: () => ({
            ok: true,
            value: CLAIMS,
            repairs: [{ action: 'capped', field: 'claims', kept: 20 }],
          }),
        },
        { id: 'research-claims-1-2', handler: () => ({ ok: true, value: [] }) },
        { id: 'research-answers-1-1', handler: () => ({ ok: true, value: ANSWERS }) },
        {
          id: 'research-answers-1-2',
          handler: () => ({
            ok: true,
            value: ANSWERS_2,
            repairs: [{ action: 'trimmed', field: 'the answer to question 2' }],
          }),
        },
      ],
    })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'dossier', subjectId: null },
      [
        { action: 'trimmed', field: "the brief's turning point" },
        { action: 'capped', field: 'claims', kept: 20 },
        { action: 'trimmed', field: 'the answer to question 2' },
      ],
    )
  })

  it('reuses the linked corpus and does not gather again, and the note reaches every pass', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    const replies: Record<string, unknown> = {
      'Read the documents': BRIEF,
      'Now find the scenes': { scenes: SCENES },
      'Now extract the facts': { claims: CLAIMS },
      'Your brief raised': ANSWERS,
    }
    callLlm.mockImplementation(async (request: LLMTaskRequest) => {
      const last = request.messages.at(-1)!.content
      const reply = Object.entries(replies).find(([opening]) => last.startsWith(opening))
      return { text: JSON.stringify(reply?.[1] ?? {}) }
    })

    const { ctx } = await engine.executeStep('save-revision', {
      events: changesRequested(),
      steps: [loadCase(1), corpusLoad],
    })

    expect(stepIds(ctx).filter((id) => id.startsWith('gather-'))).toEqual([])
    // Brief, scenes, then two claims parts and two answers parts.
    expect(callLlm).toHaveBeenCalledTimes(6)
    for (const [request] of callLlm.mock.calls as [LLMTaskRequest][]) {
      expect(request.messages.at(-1)!.content).toContain(`The human asks for changes: ${NOTE}`)
    }
    const saved = saveDossier.mock.calls[0]![1]
    expect(saved.research.entity).toEqual(ENTITY)
    expect(saved.claims[0].supports[0]).toMatchObject({ documentId: 'doc-ft', found: true })
    // A load-case stored before cases had a subject: the case title stands in.
    for (const [request] of callLlm.mock.calls as [LLMTaskRequest][]) {
      expect(request.messages[0]!.content).toMatch(
        /^Subject: Wirecard \(company\)\nWorking title: Wirecard\n/,
      )
    }
  })

  it('opens every pass on the subject and people load-case read from the case', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    const replies: Record<string, unknown> = {
      'Read the documents': BRIEF,
      'Now find the scenes': { scenes: SCENES },
      'Now extract the facts': { claims: CLAIMS },
      'Your brief raised': ANSWERS,
    }
    callLlm.mockImplementation(async (request: LLMTaskRequest) => {
      const last = request.messages.at(-1)!.content
      const reply = Object.entries(replies).find(([opening]) => last.startsWith(opening))
      return { text: JSON.stringify(reply?.[1] ?? {}) }
    })
    const named = {
      id: 'load-case',
      handler: () => ({
        ...loadCase(1).handler(),
        subject: 'Wirecard AG',
        people: ['Markus Braun', 'Jan Marsalek'],
        sourceLinks: [],
      }),
    }

    await engine.executeStep('save-revision', {
      events: changesRequested(),
      steps: [named, corpusLoad],
    })

    expect(callLlm).toHaveBeenCalledTimes(6)
    for (const [request] of callLlm.mock.calls as [LLMTaskRequest][]) {
      expect(request.messages[0]!.content).toMatch(
        /^Subject: Wirecard AG \(company\)\nPeople: Markus Braun, Jan Marsalek\nWorking title: Wirecard\n/,
      )
    }
  })

  it('stops a revision in flight from before the corpus rather than run new passes over it', async () => {
    const { ctx } = await engine.executeStep('revision-predates-corpus', {
      events: changesRequested(),
      steps: [{ id: 'load-case', handler: () => ({ round: 1, caseContext: CASE }) }],
    })

    expect(stepIds(ctx)).toEqual(['load-case', 'revision-predates-corpus'])
    expect(saveDossier).not.toHaveBeenCalled()
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
  })

  it('re-opens the gate naming the case title as subject for a load-case stored before subjects, and leaves the wait to the parked runner', async () => {
    const { ctx, result } = await engine.execute({
      events: changesRequested(),
      steps: [loadCase(1), corpusLoad, ...researchSteps],
    })

    expect(result).toEqual({ projectId: FIXTURE_PROJECT_ID, outcome: 'revised', round: 1 })
    // The dossier was never approved, so the runner is parked on its own wait.
    expect(ctx.step.waitForEvent).not.toHaveBeenCalled()
    expect(await gateMessages()).toEqual([
      `Subject: Wirecard (company) · Dossier ready · 0 claims · ${CORPUS_LINE} · revision 1`,
    ])
  })

  it('gathers first for a project researched before it had a corpus', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    const gathered = { ...ENTITY, qid: 'Q2' }

    const { ctx } = await engine.executeStep('save-revision', {
      events: changesRequested(),
      steps: [
        loadCase(0),
        { id: 'gather-entity-1', handler: () => gathered },
        { id: 'gather-fetch-1-0', handler: () => ['doc-ft'] },
        corpusLoad,
      ],
    })

    expect(stepIds(ctx).slice(0, 4)).toEqual([
      'load-case',
      'gather-entity-1',
      'gather-fetch-1-0',
      'corpus-load-1',
    ])
    expect(saveDossier.mock.calls[0]![1].research.entity).toEqual(gathered)
  })
})

/**
 * Changes asked for after the dossier was approved (design decision 7). The
 * runner finished at the approval, so the revision holds the gate itself; the
 * script stays, written from an older dossier. A project of its own, so the
 * fixture's dossier is never rewritten.
 */
describeDb('dossier-reviser after approval', () => {
  let caseId = ''
  let projectId = ''

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    saveDossier.mockReset()
    saveDossier.mockImplementation(realSaveDossier)
    await truncateRunMirror(db)
    forgetRunRows()

    const source = await createCase(db, {
      title: `Revisetest ${Date.now()} ${Math.random().toString(36).slice(2)}`,
      category: 'collapse',
      subject: 'Wirecard',
      people: ['Markus Braun'],
    })
    caseId = source.id
    projectId = (await createProjectFromCase(db, { caseId, title: source.title })).id
    await realSaveDossier(db, { projectId, contentMd: '# First pass', claims: [] })
    await createScriptVersion(db, projectId)
    await markDossierApproved(db, projectId)
    await setProjectStage(db, projectId, { stage: 'script', stageStatus: 'awaiting_review' })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await deleteProject(db, projectId)
    await deleteCase(db, caseId)
  })

  it('puts the project back on the dossier, running, while the revision researches', async () => {
    await new InngestTestEngine({ function: dossierReviser }).executeStep('load-case', {
      events: [{ name: 'gate/dossier.changes_requested', data: { projectId, note: NOTE } }],
    })

    // So a second request is refused rather than cancelling these passes, and
    // the script gate stops offering Approve until the dossier is back.
    expect(await getProject(db, projectId)).toMatchObject({
      stage: 'dossier',
      stageStatus: 'running',
    })
  })

  it('fails the dossier stage, not the parked script review, when the revision stops', async () => {
    for (let i = 0; i < 3; i += 1) await bumpDossierRevisions(db, projectId)

    const { ctx, result } = await new InngestTestEngine({ function: dossierReviser }).execute({
      events: [{ name: 'gate/dossier.changes_requested', data: { projectId, note: NOTE } }],
    })

    expect(stepIds(ctx)).toEqual(['load-case', 'revision-limit'])
    expect(result).toEqual({ projectId, outcome: 'revision-limit' })
    expect(await getProject(db, projectId)).toMatchObject({
      stage: 'dossier',
      stageStatus: 'failed',
    })
  })

  it('re-opens the dossier gate, marks the script as written from an older dossier, and waits for the Approve', async () => {
    const before = await getProject(db, projectId)
    expect(stageViewsForProject(before!).find((v) => v.stage === 'script')?.availability).toBe(
      'ready',
    )

    const { ctx } = await new InngestTestEngine({ function: dossierReviser }).executeStep(
      'await-dossier-gate',
      {
        events: [{ name: 'gate/dossier.changes_requested', data: { projectId, note: NOTE } }],
      },
    )

    expect(stepIds(ctx)).toContain('reopen-gate')
    const after = await getProject(db, projectId)
    expect(after).toMatchObject({ stage: 'dossier', stageStatus: 'awaiting_review' })
    // What the rail reads: the dossier's version moved past the script's.
    expect(stageViewsForProject(after!).find((v) => v.stage === 'script')?.availability).toBe(
      'stale',
    )
    // No runner is parked any more, so the revision waits on the Approve,
    // which is what lets the gate bar and the approve action find a run.
    expect(ctx.step.waitForEvent).toHaveBeenCalledWith(
      'await-dossier-gate',
      expect.objectContaining({ event: 'gate/dossier.approved', timeout: '30d' }),
    )
    expect(await gateMessages()).toEqual([
      expect.stringMatching(/^Subject: Wirecard \(company\), Markus Braun · Dossier ready · /),
    ])
  })
})
