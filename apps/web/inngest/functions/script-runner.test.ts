// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  latestShortsCandidates,
  requireTestDatabase,
  scripts,
  seed,
  setProjectStage,
  truncateRunMirror,
} from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import type { ClaimRow } from '@boom-busters/db'
import { BudgetExceededError, TransientProviderError } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { markShortsStep, readMarkedShorts, scriptRunner } from './script-runner'

/**
 * The script stage's Shorts marking on the answer helper (decision 293).
 * Candidates that land carry their repairs to Script Studio's Shorts strip; a
 * stop stores none and says why there; a budget stop parks the run as the
 * outline and chapter steps do. The step's body is tested on its own with the
 * model mocked; the run around it, every earlier step stubbed, against the
 * test database, since the run mirror writes there.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
const { recordRepairs, recordStop } = vi.hoisted(() => ({
  recordRepairs: vi.fn(),
  recordStop: vi.fn(),
}))
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop }))
// The real query unless a test hands in its own claims.
const scriptableClaims = vi.hoisted(() => vi.fn())
vi.mock('@boom-busters/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>()
  scriptableClaims.mockImplementation(actual.scriptableClaims)
  return { ...actual, scriptableClaims: (...args: unknown[]) => scriptableClaims(...args) }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

// A real project: the call resolves its channel from the project, as every runner does.
const PROJECT = FIXTURE_PROJECT_ID
const SCRIPT_NOTICES = { projectId: PROJECT, subject: 'script', subjectId: null }

const chapters = [
  {
    index: 0,
    title: 'The audit',
    contentMd: 'EY refused to sign the accounts. The shares collapsed in nine days.',
  },
]

const candidate = {
  chapterIndex: 0,
  startSentence: 'EY refused to sign the accounts.',
  endSentence: 'The shares collapsed in nine days.',
  hookRationale: 'The auditor said no.',
}

describeDb('markShortsStep (decision 293)', () => {
  beforeEach(async () => {
    await seed(db)
    callLlm.mockReset()
    recordRepairs.mockReset()
    recordStop.mockReset()
  })

  it('returns the candidates that land and puts what the repair changed on the strip', async () => {
    const long = 'The auditor said no. ' + 'That is the whole scandal in one line. '.repeat(40)
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({ candidates: [{ ...candidate, hookRationale: long }] }),
    })

    const marked = await markShortsStep(PROJECT, { chapters })

    expect(marked).toMatchObject({
      ok: true,
      candidates: [{ startSentence: candidate.startSentence, endSentence: candidate.endSentence }],
    })
    expect(recordRepairs).toHaveBeenCalledWith(SCRIPT_NOTICES, [
      { action: 'trimmed', field: "candidate 1's hook" },
    ])
    expect(recordStop).not.toHaveBeenCalled()
  })

  it("records the outline's repairs beside the marking's, so the strip keeps both (decision 296)", async () => {
    callLlm.mockResolvedValueOnce({ text: JSON.stringify({ candidates: [candidate] }) })
    const outlineRepair = {
      action: 'dropped' as const,
      field: "chapter 2's claim 1",
      reason: 'already owned by chapter 1',
    }
    await markShortsStep(PROJECT, { chapters }, [outlineRepair])
    expect(recordRepairs).toHaveBeenCalledWith(SCRIPT_NOTICES, [outlineRepair])
  })

  it("keeps the outline's repairs on the strip when the marking stops (review of 296)", async () => {
    callLlm.mockResolvedValue({ text: 'not json at all' })
    const outlineRepair = {
      action: 'trimmed' as const,
      field: "chapter 1's beat",
    }
    expect(await markShortsStep(PROJECT, { chapters }, [outlineRepair])).toEqual({
      ok: true,
      candidates: [],
    })
    expect(recordRepairs).toHaveBeenCalledWith(SCRIPT_NOTICES, [outlineRepair])
    expect(recordStop).toHaveBeenCalledTimes(1)
    // The repairs land first, so the stop is added beside them, not replaced.
    expect(recordRepairs.mock.invocationCallOrder[0]!).toBeLessThan(
      recordStop.mock.invocationCallOrder[0]!,
    )
  })

  it('stores none after a refusal and its retry, and says on the strip that the Shorts stage will mark them', async () => {
    callLlm.mockResolvedValue({ text: 'not json at all' })

    expect(await markShortsStep(PROJECT, { chapters })).toEqual({ ok: true, candidates: [] })

    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(recordStop).toHaveBeenCalledWith(
      SCRIPT_NOTICES,
      'stopped',
      'Shorts marking stopped: The model returned no JSON for Shorts candidates. It answered: not json at all. The Shorts stage will mark them again.',
    )
    expect(recordRepairs).not.toHaveBeenCalled()
  })

  it('hands a budget stop back for the run to park, with no notice', async () => {
    callLlm.mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.metadata',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.01,
      }),
    )

    expect(await markShortsStep(PROJECT, { chapters })).toMatchObject({
      ok: false,
      gate: { gate: 'budget', provider: 'anthropic' },
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(recordStop).not.toHaveBeenCalled()
    expect(recordRepairs).not.toHaveBeenCalled()
  })

  it('stores none after a provider error and says so on the strip, never failing the script', async () => {
    callLlm.mockRejectedValueOnce(
      new TransientProviderError('anthropic', 'overloaded', { status: 529 }),
    )
    expect(await markShortsStep(PROJECT, { chapters })).toEqual({ ok: true, candidates: [] })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(recordStop).toHaveBeenCalledWith(
      SCRIPT_NOTICES,
      'stopped',
      expect.stringMatching(
        /^Shorts marking stopped: .*overloaded.*\. The Shorts stage will mark them again\.$/,
      ),
    )
  })
})

describe('readMarkedShorts (decision 293)', () => {
  it('reads the bare list a run parked before decision 293 stored', () => {
    expect(readMarkedShorts([candidate])).toEqual({ ok: true, candidates: [candidate] })
  })

  it('reads the new result as it is', () => {
    const parked = { ok: false as const, gate: { gate: 'budget' } }
    expect(readMarkedShorts(parked)).toEqual(parked)
    expect(readMarkedShorts({ ok: true, candidates: [] })).toEqual({ ok: true, candidates: [] })
  })
})

describeDb('script-runner around the Shorts marking (decision 293)', () => {
  let engine: InngestTestEngine
  let scriptId = ''

  const approved = (): [{ name: string; data: Record<string, unknown> }] => [
    { name: 'gate/dossier.approved', data: { projectId: FIXTURE_PROJECT_ID } },
  ]

  /** Every step before the marking, as a run that reached it would replay them. */
  const throughSelfCheck = () => [
    {
      id: 'load-dossier',
      handler: () => ({
        scriptId,
        caseTitle: 'Wirecard',
        targetRuntimeMin: 10,
        dossierMd: 'The dossier.',
        claims: [],
      }),
    },
    {
      id: 'outline',
      handler: () => ({
        ok: true,
        outline: { chapters: [{ title: 'The audit', beat: 'x'.repeat(30), targetWords: 300 }] },
      }),
    },
    { id: 'save-outline', handler: () => undefined },
    {
      id: 'draft-chapter-0',
      handler: () => ({ ok: true, chapterId: 'chapter-0', contentMd: chapters[0]!.contentMd }),
    },
    { id: 'self-check-0', handler: () => ({ warnings: 0, refs: 0 }) },
  ]

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: scriptRunner })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(scripts)
    scriptId = (await createScriptVersion(db, FIXTURE_PROJECT_ID)).id
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    // The fixture's own stage, for the suites after this one.
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'queued' })
  })

  it('marks a ruled claim adjudicated and every other claim not', async () => {
    const row = (id: string, patch: Partial<ClaimRow>): ClaimRow => ({
      id,
      dossierId: 'dossier-1',
      text: `Claim ${id}.`,
      sourceUrl: 'https://www.bafin.de/ruling',
      sourceType: 'regulator',
      confidence: 'sourced',
      quarantined: false,
      legalStatus: 'none',
      legalStatusDate: null,
      legalStatusDocumentId: null,
      series: null,
      createdAt: new Date('2026-10-01'),
      updatedAt: new Date('2026-10-01'),
      ...patch,
    })
    scriptableClaims.mockResolvedValueOnce([
      row('ruled', { legalStatus: 'ruled', legalStatusDate: '2020-06' }),
      row('alleged', { legalStatus: 'alleged', sourceType: 'major_outlet' }),
      row('none', {}),
    ])

    const { result } = await engine.executeStep('load-dossier', { events: approved() })

    expect((result as { claims: unknown[] }).claims).toEqual([
      {
        id: 'ruled',
        text: 'Claim ruled.',
        sourceUrl: 'https://www.bafin.de/ruling',
        confidence: 'sourced',
        sourceType: 'regulator',
        adjudicated: true,
      },
      expect.objectContaining({ id: 'alleged', sourceType: 'major_outlet', adjudicated: false }),
      expect.objectContaining({ id: 'none', adjudicated: false }),
    ])
  })

  it("builds a chapter request from the project's bible although no earlier step carried one", async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: 'A whole chapter.' })

    // The steps a run parked before the bible existed would replay: none has a bible field.
    const { result } = await engine.executeStep('draft-chapter-0', {
      events: approved(),
      steps: throughSelfCheck().slice(0, 3),
    })

    expect(result).toMatchObject({ ok: true, contentMd: 'A whole chapter.' })
    const sent = callLlm.mock.calls[0]![0] as { system: string }
    expect(sent.system).toContain('a documentary channel about\ncorporate collapses, frauds')
  })

  it('parks the run when the marking is over budget, as the other steps do', async () => {
    const { result, ctx } = await engine.execute({
      events: approved(),
      steps: [
        ...throughSelfCheck(),
        {
          id: 'mark-shorts',
          handler: () => ({
            ok: false,
            gate: { gate: 'budget', message: 'The monthly spend ceiling would be crossed.' },
          }),
        },
      ],
    })

    expect(result).toMatchObject({ outcome: 'over-budget' })
    expect(ctx.step.run).toHaveBeenCalledWith('shorts-over-budget', expect.any(Function))
    expect(ctx.step.run).not.toHaveBeenCalledWith('finish-draft', expect.any(Function))
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
  })

  it('stores the bare list a run parked before decision 293 replays', async () => {
    const { result, ctx } = await engine.execute({
      events: approved(),
      steps: [
        ...throughSelfCheck(),
        { id: 'mark-shorts', handler: () => [candidate] },
        { id: 'auto-approve', handler: () => undefined },
        { id: 'advance-to-voice', handler: () => undefined },
      ],
    })

    expect(result).toMatchObject({ outcome: 'auto-approved', shorts: 1 })
    expect(ctx.step.run).not.toHaveBeenCalledWith('shorts-over-budget', expect.any(Function))
    expect(await latestShortsCandidates(db, FIXTURE_PROJECT_ID)).toEqual([candidate])
  })
})
