// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getProject,
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
vi.mock('@boom-busters/db', async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  saveDossier: (...args: unknown[]) => saveDossier(...args),
}))

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
]
const CORPUS = { read: 1, unread: 0, failed: 0 }

const BRIEF = {
  summary:
    'Wirecard was a German payments company. It collapsed in June 2020 after EY refused to sign.',
  turningPoint: 'EY refused to sign the 2019 accounts.',
  cast: [],
  toldAlready: [],
  openQuestions: ['Where did the 1.9 billion euros go?'],
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

const stepIds = (ctx: { step: { run: unknown } }) =>
  vi.mocked(ctx.step.run as (id: string) => unknown).mock.calls.map(([id]) => id)

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
          }),
        },
        { id: 'research-scenes-1', handler: () => ({ ok: true, value: SCENES }) },
        {
          id: 'research-claims-1',
          handler: () => ({
            ok: true,
            value: CLAIMS,
            repairs: [{ action: 'capped', field: 'claims', kept: 60 }],
          }),
        },
        { id: 'research-answers-1', handler: () => ({ ok: true, value: ANSWERS }) },
      ],
    })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'dossier', subjectId: null },
      [
        { action: 'trimmed', field: "the brief's turning point" },
        { action: 'capped', field: 'claims', kept: 60 },
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
    expect(callLlm).toHaveBeenCalledTimes(4)
    for (const [request] of callLlm.mock.calls as [LLMTaskRequest][]) {
      expect(request.messages.at(-1)!.content).toContain(`The human asks for changes: ${NOTE}`)
    }
    const saved = saveDossier.mock.calls[0]![1]
    expect(saved.research.entity).toEqual(ENTITY)
    expect(saved.claims[0].supports[0]).toMatchObject({ documentId: 'doc-ft', found: true })
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
