// @vitest-environment node

import {
  FIXTURE_CASE_ID,
  FIXTURE_PROJECT_ID,
  getProject,
  listRunEvents,
  listRuns,
  requireTestDatabase,
  seed,
  setProjectStage,
  truncateRunMirror,
} from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import type { GroundedClaim } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { forgetRunRows } from '../middleware/run-mirror'
import { dossierRunner } from './dossier-runner'

/**
 * The dossier-runner from the case to the gate, against the test database's
 * run mirror. The gather, the corpus load and the research steps are handed
 * stored results, as Inngest hands a replaying run the results it kept, so no
 * source or model is called; `saveDossier` and `markDossierApproved` are
 * stubbed so the fixture dossier other suites read is never rewritten.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop: vi.fn() }))
const { saveDossier, markDossierApproved } = vi.hoisted(() => ({
  saveDossier: vi.fn(),
  markDossierApproved: vi.fn(),
}))
vi.mock('@boom-busters/db', async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  saveDossier: (...args: unknown[]) => saveDossier(...args),
  markDossierApproved: (...args: unknown[]) => markDossierApproved(...args),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

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
    id: 'doc-ir',
    url: 'https://ir.wirecard.com/results',
    kind: 'press-release',
    title: 'Results',
    publishedAt: '2019-04-25',
    text: 'Revenue for 2018 was EUR 2,016 million.',
    archivedUrl: null,
    httpStatus: 403,
  },
]
const CORPUS = { read: 2, unread: 1, failed: 1 }
const CORPUS_LINE = '2 documents read, 1 gathered not read, 1 could not be fetched'

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
const RESEARCH_CLAIMS = [
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
/** The claims and answers passes each run in two parts: two documents, two questions. */
const ANSWERS_2 = {
  answers: [{ index: 2, question: 'Who signed off on the escrow accounts?', answer: null }],
  claims: [],
}
const RESEARCH = {
  entity: ENTITY,
  brief: {
    summary: BRIEF.summary,
    turningPoint: BRIEF.turningPoint,
    cast: [],
    toldAlready: [],
    openQuestions: BRIEF.openQuestions,
  },
  scenes: [
    {
      when: 'June 2020',
      who: 'Wirecard',
      what: 'Filed for insolvency in Munich.',
      why: 'The end of the company the story follows.',
      quote: SCENES[0]!.quote,
      ref: {
        documentId: 'doc-ft',
        url: DOCUMENTS[0]!.url,
        found: true,
        locatorSeconds: null,
        quote: SCENES[0]!.quote,
      },
    },
  ],
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null, ref: null }],
  corpus: CORPUS,
}

function grounded(documentId: string, over: Partial<GroundedClaim> = {}): GroundedClaim {
  const doc = DOCUMENTS.find((d) => d.id === documentId)!
  return {
    text: 'Wirecard filed for insolvency in June 2020.',
    sourceUrl: doc.url,
    sourceType: 'major_outlet',
    confidence: 'single_source',
    legalStatus: 'none',
    legalStatusDate: null,
    legalStatusDocumentId: null,
    series: null,
    supports: [
      {
        documentId,
        rank: 1,
        quote: RESEARCH_CLAIMS[0]!.supports[0]!.quote,
        found: true,
        offset: 0,
        locatorSeconds: null,
        url: doc.url,
        archivedUrl: doc.archivedUrl,
      },
    ],
    ...over,
  }
}

const DOSSIER = { projectId: FIXTURE_PROJECT_ID, subject: 'dossier', subjectId: null }

function created(): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'project/created',
      data: { projectId: FIXTURE_PROJECT_ID, caseId: FIXTURE_CASE_ID },
    },
  ]
}

/**
 * The case, the mock-mode gather, the corpus and every research step's stored
 * result; a pass carries `repairs` only when given some.
 */
function stored(options: { repairs?: Record<string, unknown[]>; claims?: GroundedClaim[] } = {}) {
  const repairs = options.repairs ?? {}
  const pass = (id: string, value: unknown) => ({
    id,
    handler: () => (repairs[id] ? { ok: true, value, repairs: repairs[id] } : { ok: true, value }),
  })
  return [
    { id: 'load-case', handler: () => ({ ...CASE, competitorLinks: [] }) },
    { id: 'gather-entity-0', handler: () => ENTITY },
    { id: 'gather-fetch-0-0', handler: () => DOCUMENTS.map((d) => d.id) },
    { id: 'corpus-load-0', handler: () => ({ documents: DOCUMENTS, corpus: CORPUS }) },
    // `split` marks a brief written since the claims and answers passes run in parts.
    {
      id: 'research-brief-0',
      handler: () => ({ ...pass('research-brief-0', BRIEF).handler(), split: true }),
    },
    pass('research-scenes-0', SCENES),
    pass('research-claims-0-1', RESEARCH_CLAIMS),
    pass('research-claims-0-2', []),
    pass('research-answers-0-1', ANSWERS),
    pass('research-answers-0-2', ANSWERS_2),
    {
      id: 'research-ground-0',
      handler: () => ({
        research: RESEARCH,
        claims: options.claims ?? [grounded('doc-ft')],
        repairs: repairs['research-ground-0'] ?? [],
      }),
    },
  ]
}

/** What `saveDossier` hands back: one row per claim, as counted for the gate. */
function savedRows(confidences: string[]) {
  return { claims: confidences.map((confidence) => ({ confidence, quarantined: false })) }
}

async function gateMessages(): Promise<string[]> {
  const [run] = await listRuns(db)
  const events = await listRunEvents(db, run!.id)
  return events.filter((e) => e.kind === 'gate.opened').map((e) => e.message ?? '')
}

describeDb('dossier-runner', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    // Mock mode keeps the gather to its two stored steps.
    vi.stubEnv('MOCK_PROVIDERS', '1')
    engine = new InngestTestEngine({ function: dossierRunner })
    recordRepairs.mockReset()
    saveDossier.mockReset()
    saveDossier.mockResolvedValue({ claims: [] })
    markDossierApproved.mockReset()
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    // The fixture's own stage, for the suites after this one.
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'queued' })
  })

  it("records the passes' and the grounding's repairs as the dossier's notice when it is saved", async () => {
    await engine.executeStep('save-dossier', {
      events: created(),
      steps: stored({
        repairs: {
          'research-brief-0': [{ action: 'trimmed', field: "the brief's summary" }],
          'research-scenes-0': [
            { action: 'dropped', field: 'scene 4', reason: 'its date ran over 100 characters' },
          ],
          'research-claims-0-1': [
            { action: 'dropped', field: 'claim 17', reason: 'its text ran over 1,000 characters' },
          ],
          'research-claims-0-2': [{ action: 'capped', field: 'claims', kept: 20 }],
          'research-answers-0-1': [{ action: 'trimmed', field: 'the answer to question 1' }],
          'research-answers-0-2': [{ action: 'trimmed', field: 'the answer to question 2' }],
          'research-ground-0': [
            {
              action: 'dropped',
              field: 'claim 2 support 1',
              reason: 'cites a document that was not given',
            },
          ],
        },
      }),
    })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledWith(DOSSIER, [
      { action: 'trimmed', field: "the brief's summary" },
      { action: 'dropped', field: 'scene 4', reason: 'its date ran over 100 characters' },
      { action: 'dropped', field: 'claim 17', reason: 'its text ran over 1,000 characters' },
      { action: 'capped', field: 'claims', kept: 20 },
      { action: 'trimmed', field: 'the answer to question 1' },
      { action: 'trimmed', field: 'the answer to question 2' },
      {
        action: 'dropped',
        field: 'claim 2 support 1',
        reason: 'cites a document that was not given',
      },
    ])
  })

  it('saves research replayed from before the notices, with no notice and no crash', async () => {
    await engine.executeStep('save-dossier', { events: created(), steps: stored() })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(saveDossier.mock.calls[0]![1]).toMatchObject({
      projectId: FIXTURE_PROJECT_ID,
      claims: [expect.objectContaining({ text: 'Wirecard filed for insolvency in June 2020.' })],
    })
    expect(recordRepairs).toHaveBeenCalledWith(DOSSIER, [])
  })

  it('saves supports and research, then opens the gate and waits even when every claim is grounded on a fetched document', async () => {
    saveDossier.mockResolvedValue(savedRows(['single_source']))

    // `@inngest/test` cannot drive a run past a wait, so this stops at it.
    const { ctx } = await engine.executeStep('await-dossier-gate', {
      events: created(),
      steps: stored({ claims: [grounded('doc-ft', { legalStatus: 'alleged' })] }),
    })

    const ids = vi.mocked(ctx.step.run).mock.calls.map(([id]) => id)
    expect(ids).toEqual([
      'load-case',
      'gather-entity-0',
      'gather-fetch-0-0',
      'corpus-load-0',
      'research-brief-0',
      'research-scenes-0',
      'research-claims-0-1',
      'research-claims-0-2',
      'research-answers-0-1',
      'research-answers-0-2',
      'research-ground-0',
      'save-dossier',
      'open-gate',
    ])

    const saved = saveDossier.mock.calls[0]![1]
    expect(saved).toMatchObject({ projectId: FIXTURE_PROJECT_ID, research: RESEARCH })
    expect(saved.contentMd).toMatch(/^# Wirecard/)
    expect(saved.claims).toEqual([
      {
        text: 'Wirecard filed for insolvency in June 2020.',
        sourceUrl: DOCUMENTS[0]!.url,
        sourceType: 'major_outlet',
        confidence: 'single_source',
        legalStatus: 'alleged',
        legalStatusDate: null,
        legalStatusDocumentId: null,
        series: null,
        // The URLs are the document's; the row keeps only the reference.
        supports: [
          {
            documentId: 'doc-ft',
            rank: 1,
            quote: RESEARCH_CLAIMS[0]!.supports[0]!.quote,
            found: true,
            offset: 0,
            locatorSeconds: null,
          },
        ],
      },
    ])
    // Nothing approves itself: the script starts only on the owner's Approve.
    expect(markDossierApproved).not.toHaveBeenCalled()
    expect(ctx.step.sendEvent).not.toHaveBeenCalled()
    expect(ctx.step.waitForEvent).toHaveBeenCalledWith(
      'await-dossier-gate',
      expect.objectContaining({ event: 'gate/dossier.approved', timeout: '30d' }),
    )
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
    // A load-case stored before cases had a subject: the case title stands in.
    expect(await gateMessages()).toEqual([
      `Subject: Wirecard (company) · Dossier ready · 1 claims · ${CORPUS_LINE}`,
    ])

    // The same dossier with its claim resting on a page that answered 403 says so.
    const parked = new InngestTestEngine({ function: dossierRunner })
    await truncateRunMirror(db)
    forgetRunRows()

    await parked.executeStep('open-gate', {
      events: created(),
      steps: stored({ claims: [grounded('doc-ir')] }),
    })

    expect(markDossierApproved).not.toHaveBeenCalled()
    expect(await gateMessages()).toEqual([
      `Subject: Wirecard (company) · Dossier ready · 1 claims · ` +
        `1 resting on a document that was not fetched · ${CORPUS_LINE}`,
    ])
  })

  it('counts a claim whose page failed but whose Wayback copy was read as fetched', async () => {
    saveDossier.mockResolvedValue(savedRows(['single_source']))
    const archived = grounded('doc-ir')
    archived.supports[0]!.archivedUrl = 'https://web.archive.org/web/2019/https://ir.wirecard.com'

    await engine.executeStep('open-gate', {
      events: created(),
      steps: stored({ claims: [archived] }),
    })

    expect(markDossierApproved).not.toHaveBeenCalled()
    expect(await gateMessages()).toEqual([
      `Subject: Wirecard (company) · Dossier ready · 1 claims · ${CORPUS_LINE}`,
    ])
  })

  it("names the case's subject and people at the gate, from the case it loaded", async () => {
    saveDossier.mockResolvedValue(savedRows(['single_source']))
    const steps = stored().map((s) =>
      s.id === 'load-case'
        ? {
            id: s.id,
            handler: () => ({
              ...CASE,
              subject: 'Wirecard',
              people: ['Markus Braun', 'Jan Marsalek'],
              sourceLinks: [],
              competitorLinks: [],
            }),
          }
        : s.id === 'gather-entity-0'
          ? {
              id: s.id,
              handler: () => ({
                ...ENTITY,
                subject: 'Wirecard',
                unresolved: false,
                people: [
                  { name: 'Markus Braun', qid: 'Q2', title: 'Markus Braun' },
                  { name: 'Jan Marsalek', qid: 'Q3', title: 'Jan Marsalek' },
                ],
              }),
            }
          : s,
    )

    await engine.executeStep('open-gate', { events: created(), steps })

    expect(await gateMessages()).toEqual([
      `Subject: Wirecard (company), Markus Braun, Jan Marsalek · Dossier ready · 1 claims · ${CORPUS_LINE}`,
    ])
  })

  it('says at the gate when the subject was not found on Wikipedia', async () => {
    saveDossier.mockResolvedValue(savedRows(['single_source']))
    const steps = stored().map((s) =>
      s.id === 'gather-entity-0'
        ? {
            id: s.id,
            handler: () => ({
              ...ENTITY,
              qid: null,
              titles: [],
              subject: 'Wirecard',
              unresolved: true,
              people: [],
            }),
          }
        : s,
    )

    await engine.executeStep('open-gate', { events: created(), steps })

    expect(await gateMessages()).toEqual([
      `Subject not found on Wikipedia: check the case's Subject · Dossier ready · 1 claims · ${CORPUS_LINE}`,
    ])
  })

  it('lets a run parked at the gate before the corpus existed go straight back to its wait', async () => {
    // What a run parked before this deploy has stored: no competitor links in
    // the case, the old passes, the old save, and the gate already open.
    // `@inngest/test` cannot drive a run past a wait (see demo-pipeline.test.ts),
    // so this stops at it; the close after it is the normal path's own helper.
    const { ctx } = await engine.executeStep('await-dossier-gate', {
      events: created(),
      steps: [
        { id: 'load-case', handler: () => CASE },
        { id: 'research-brief-0', handler: () => ({ ok: true, value: { summary: 'Old.' } }) },
        { id: 'research-timeline-0', handler: () => ({ ok: true, value: [] }) },
        { id: 'research-claims-0', handler: () => ({ ok: true, value: [{ text: 'Old.' }] }) },
        { id: 'research-answers-0', handler: () => ({ ok: true, value: ANSWERS }) },
        {
          id: 'save-dossier',
          handler: () => ({ total: 1, unverified: 1, quarantined: 0, blocking: 1 }),
        },
        { id: 'open-gate', handler: () => undefined },
      ],
    })

    // No gather, corpus load, new pass, grounding or save: only the wait.
    const ids = vi.mocked(ctx.step.run).mock.calls.map(([id]) => id)
    expect(ids).toEqual(['load-case'])
    expect(ctx.step.waitForEvent).toHaveBeenCalledWith(
      'await-dossier-gate',
      expect.objectContaining({ event: 'gate/dossier.approved', timeout: '30d' }),
    )
    expect(saveDossier).not.toHaveBeenCalled()
    expect(recordRepairs).not.toHaveBeenCalled()
  })

  it('stops the stage before the passes when no document could be read', async () => {
    vi.mocked(notify).mockClear()
    const steps = stored().map((s) =>
      s.id === 'corpus-load-0'
        ? {
            id: s.id,
            handler: () => ({ documents: [], corpus: { read: 0, unread: 0, failed: 3 } }),
          }
        : s,
    )

    const { ctx, result } = await engine.execute({ events: created(), steps })

    const ids = vi.mocked(ctx.step.run).mock.calls.map(([id]) => id)
    expect(ids).toEqual([
      'load-case',
      'gather-entity-0',
      'gather-fetch-0-0',
      'corpus-load-0',
      'corpus-empty-0',
    ])
    expect(result).toEqual({ projectId: FIXTURE_PROJECT_ID, outcome: 'no-corpus' })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'run-failed',
        body: 'No documents could be gathered for this case. Add competitor links or check the case title.',
      }),
    )
    expect(saveDossier).not.toHaveBeenCalled()
  })

  it('opens the gate with the corpus line when a claim is unverified', async () => {
    saveDossier.mockResolvedValue(savedRows(['unverified', 'sourced', 'sourced']))

    await engine.executeStep('open-gate', { events: created(), steps: stored() })

    expect(markDossierApproved).not.toHaveBeenCalled()
    expect(await gateMessages()).toEqual([
      `Subject: Wirecard (company) · Dossier ready · 3 claims · 1 unsourced · ${CORPUS_LINE}`,
    ])
  })
})
