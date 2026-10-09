// @vitest-environment node

import { FIXTURE_PROJECT_ID, requireTestDatabase, seed, truncateRunMirror } from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { dossierReviser } from './dossier-reviser'

/**
 * The dossier-reviser's save step (decision 293): a revision's repairs
 * replace the dossier's notice, and a pass replayed without `repairs` adds
 * none. Research results are handed in; `saveDossier` is stubbed so the
 * fixture dossier is never rewritten.
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

describeDb('dossier-reviser: the dossier notice (decision 293)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: dossierReviser })
    recordRepairs.mockReset()
    saveDossier.mockReset()
    saveDossier.mockResolvedValue({ claims: [] })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
  })

  it("records the revision's repairs, reading a pass replayed without them as none", async () => {
    await engine.executeStep('save-revision', {
      events: [
        {
          name: 'gate/dossier.changes_requested',
          data: { projectId: FIXTURE_PROJECT_ID, note: 'More on the auditors, please.' },
        },
      ],
      steps: [
        { id: 'load-case', handler: () => ({ round: 1, caseContext: CASE }) },
        {
          id: 'research-brief-1',
          handler: () => ({
            ok: true,
            value: BRIEF,
            repairs: [{ action: 'trimmed', field: "the brief's turning point" }],
          }),
        },
        { id: 'research-timeline-1', handler: () => ({ ok: true, value: EVENTS }) },
        {
          id: 'research-claims-1',
          handler: () => ({
            ok: true,
            value: CLAIMS,
            repairs: [{ action: 'capped', field: 'claims', kept: 120 }],
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
        { action: 'capped', field: 'claims', kept: 120 },
      ],
    )
  })
})
