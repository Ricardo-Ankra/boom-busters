// @vitest-environment node

import {
  FIXTURE_CASE_ID,
  FIXTURE_PROJECT_ID,
  requireTestDatabase,
  seed,
  truncateRunMirror,
} from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { dossierRunner } from './dossier-runner'

/**
 * The dossier-runner's save step (decision 293), against the test database's
 * run mirror. The research steps are handed stored results, as Inngest hands
 * a replaying run the results it kept, so no model is called; `saveDossier`
 * is stubbed so the fixture dossier other suites read is never rewritten.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop: vi.fn() }))
const saveDossier = vi.hoisted(() => vi.fn())
vi.mock('@boom-busters/db', async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  saveDossier: (...args: unknown[]) => saveDossier(...args),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CASE = { title: 'Wirecard', category: 'con', angle: null, demandNotes: null }
const BRIEF = {
  summary:
    'Wirecard was a German payments company. It collapsed in June 2020 after EY refused to sign.',
  turningPoint: 'EY refused to sign the 2019 accounts.',
  principals: [{ name: 'Markus Braun', role: 'Chief executive' }],
  openQuestions: ['Where did the 1.9 billion euros go?'],
}
const EVENTS = [{ when: 'June 2020', what: 'Wirecard filed for insolvency in Munich.' }]
const CLAIMS = [
  {
    text: 'Wirecard filed for insolvency in June 2020.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'sourced',
    adjudicated: false,
  },
]
const ANSWERS = {
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null }],
  claims: [],
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

/** The case and the four passes' stored results; a pass carries `repairs` only when given some. */
function stored(repairs: Record<string, unknown[]> = {}) {
  const pass = (id: string, value: unknown) => ({
    id,
    handler: () => (repairs[id] ? { ok: true, value, repairs: repairs[id] } : { ok: true, value }),
  })
  return [
    { id: 'load-case', handler: () => CASE },
    pass('research-brief-0', BRIEF),
    pass('research-timeline-0', EVENTS),
    pass('research-claims-0', CLAIMS),
    pass('research-answers-0', ANSWERS),
  ]
}

describeDb('dossier-runner: the dossier notice (decision 293)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: dossierRunner })
    recordRepairs.mockReset()
    saveDossier.mockReset()
    saveDossier.mockResolvedValue({ claims: [] })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
  })

  it("records the four passes' repairs as the dossier's notice when it is saved", async () => {
    await engine.executeStep('save-dossier', {
      events: created(),
      steps: stored({
        'research-brief-0': [{ action: 'trimmed', field: "the brief's summary" }],
        'research-timeline-0': [
          {
            action: 'dropped',
            field: 'timeline event 4',
            reason: 'its date ran over 100 characters',
          },
        ],
        'research-claims-0': [
          { action: 'dropped', field: 'claim 37', reason: 'its text ran over 1,000 characters' },
        ],
        'research-answers-0': [{ action: 'trimmed', field: 'the answer to question 3' }],
      }),
    })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledWith(DOSSIER, [
      { action: 'trimmed', field: "the brief's summary" },
      { action: 'dropped', field: 'timeline event 4', reason: 'its date ran over 100 characters' },
      { action: 'dropped', field: 'claim 37', reason: 'its text ran over 1,000 characters' },
      { action: 'trimmed', field: 'the answer to question 3' },
    ])
  })

  it('saves research replayed from before the notices, with no notice and no crash', async () => {
    // A run parked before decision 293 replays step results stored without `repairs`.
    await engine.executeStep('save-dossier', { events: created(), steps: stored() })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(saveDossier.mock.calls[0]![1]).toMatchObject({
      projectId: FIXTURE_PROJECT_ID,
      claims: [expect.objectContaining({ text: CLAIMS[0]!.text })],
    })
    expect(recordRepairs).toHaveBeenCalledWith(DOSSIER, [])
  })
})
