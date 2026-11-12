// @vitest-environment node

import { eq } from 'drizzle-orm'
import {
  createCase,
  createChannel,
  createProjectFromCase,
  createScriptVersion,
  dossiers,
  FIXTURE_PROJECT_ID,
  getChapter,
  getProject,
  latestShortsCandidates,
  projects,
  requireTestDatabase,
  runs,
  saveChapter,
  scripts,
  seed,
  setChapterWarnings,
  setProjectStage,
  truncateRunMirror,
} from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import type { ClaimRow } from '@boom-busters/db'
import {
  BudgetExceededError,
  countBySeverity,
  DEFAULT_SETTINGS,
  estimateRuntimeSec,
  EMPTY_BIBLE,
  TransientProviderError,
} from '@boom-busters/schemas'
import { mockChapter, mockOutline } from '@boom-busters/providers'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FROZEN_BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'
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

const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notify }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
const { recordRepairs, recordStop } = vi.hoisted(() => ({
  recordRepairs: vi.fn(),
  recordStop: vi.fn(),
}))
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop }))
// The real query unless a test hands in its own claims.
const scriptableClaims = vi.hoisted(() => vi.fn())
const channelForProject = vi.hoisted(() => vi.fn())
const shortsEnabledForProject = vi.hoisted(() => vi.fn())
vi.mock('@boom-busters/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>()
  scriptableClaims.mockImplementation(actual.scriptableClaims)
  channelForProject.mockImplementation(actual.channelForProject)
  shortsEnabledForProject.mockImplementation(actual.shortsEnabledForProject)
  return {
    ...actual,
    scriptableClaims: (...args: unknown[]) => scriptableClaims(...args),
    channelForProject: (...args: unknown[]) => channelForProject(...args),
    shortsEnabledForProject: (...args: unknown[]) => shortsEnabledForProject(...args),
  }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

// A real project: the call resolves its channel from the project, as every runner does.
const PROJECT = FIXTURE_PROJECT_ID
const SCRIPT_NOTICES = { projectId: PROJECT, subject: 'script', subjectId: null }

const FIXED_LINES = ['Settle in.', 'Sleep well.'] as const
const chapters = [
  {
    index: 0,
    title: 'The audit',
    contentMd: 'EY refused to sign the accounts. The shares collapsed in nine days.',
  },
]

// The first chapter as the script stores it under a format with both fixed lines.
const fixedChapter = [FIXED_LINES[0], chapters[0]!.contentMd, FIXED_LINES[1]].join(
  String.fromCharCode(10, 10),
)

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

  it('writes the craft notices after the repairs, and keeps them when the marking stops (decision 463)', async () => {
    const craft = [
      { kind: 'trimmed' as const, message: 'Chapter 1 revised for craft: a limp close.' },
    ]
    const outlineRepair = { action: 'trimmed' as const, field: "chapter 1's beat" }
    callLlm.mockResolvedValueOnce({ text: JSON.stringify({ candidates: [candidate] }) })
    await markShortsStep(PROJECT, { chapters }, [outlineRepair], craft)
    expect(recordRepairs).toHaveBeenCalledWith(SCRIPT_NOTICES, [outlineRepair], craft)

    recordRepairs.mockReset()
    recordStop.mockReset()
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: 'not json at all' })
    await markShortsStep(PROJECT, { chapters }, [], craft)
    expect(recordRepairs).toHaveBeenCalledWith(SCRIPT_NOTICES, [], craft)
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

  it("never offers a Short the format's fixed lines", async () => {
    const actual = await vi.importActual<typeof Db>('@boom-busters/db')
    channelForProject.mockImplementation(async (...args: unknown[]) => {
      const channel = await actual.channelForProject(args[0] as never, args[1] as string)
      return {
        ...channel,
        format: { ...channel.format, introLine: 'Settle in.', outroLine: 'Sleep well.' },
      }
    })
    try {
      callLlm.mockResolvedValueOnce({ text: JSON.stringify({ candidates: [candidate] }) })
      await markShortsStep(PROJECT, {
        chapters: [
          {
            index: 0,
            title: 'The audit',
            contentMd: fixedChapter,
          },
        ],
      })
      const sent = JSON.stringify(callLlm.mock.calls[0]![0])
      expect(sent).toContain('EY refused to sign the accounts.')
      expect(sent).not.toContain('Settle in.')
      expect(sent).not.toContain('Sleep well.')
    } finally {
      channelForProject.mockImplementation(actual.channelForProject)
    }
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
    { id: 'self-check-0', handler: () => ({ warnings: 0 }) },
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

  it("carries each claim's legal status to the claim list", async () => {
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
      evidenceStatus: null,
      evidenceDocumentId: null,
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
        legal: 'ruled',
      },
      expect.objectContaining({ id: 'alleged', sourceType: 'major_outlet', legal: 'alleged' }),
      expect.objectContaining({ id: 'none', legal: 'none' }),
    ])
  })

  describe("a claim's evidence standing", () => {
    const stored = (): ClaimRow => ({
      id: 'c-standing',
      dossierId: 'dossier-1',
      text: 'The drug halves the risk.',
      sourceUrl: 'https://journal.example/paper',
      sourceType: 'other',
      confidence: 'sourced',
      quarantined: false,
      legalStatus: 'none',
      legalStatusDate: null,
      legalStatusDocumentId: null,
      evidenceStatus: 'contested',
      evidenceDocumentId: null,
      series: null,
      createdAt: new Date('2026-10-01'),
      updatedAt: new Date('2026-10-01'),
    })

    it('reaches the outline request under a science bible', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
      const actual = await vi.importActual<typeof Db>('@boom-busters/db')
      channelForProject.mockImplementation(async (...args: unknown[]) => {
        const channel = await actual.channelForProject(args[0] as never, args[1] as string)
        return { ...channel, bible: { ...channel.bible, researchProfile: 'science' } }
      })
      try {
        scriptableClaims.mockResolvedValueOnce([stored()])
        const { result } = await engine.executeStep('load-dossier', { events: approved() })
        expect((result as { claims: { standing?: string }[] }).claims[0]!.standing).toBe(
          'CONTESTED',
        )

        await engine
          .executeStep('outline', {
            events: approved(),
            steps: [{ id: 'load-dossier', handler: () => result }],
          })
          .catch(() => undefined)
        const sent = callLlm.mock.calls[0]![0] as { messages: { content: string }[] }
        expect(sent.messages.map((message) => message.content).join(' ')).toContain('— CONTESTED')
      } finally {
        channelForProject.mockImplementation(actual.channelForProject)
      }
    })

    it("carries none under the first channel's bible", async () => {
      scriptableClaims.mockResolvedValueOnce([stored()])
      const { result } = await engine.executeStep('load-dossier', { events: approved() })
      const claims = (result as { claims: { standing?: string }[] }).claims
      expect(claims).toHaveLength(1)
      expect(claims[0]!.standing).toBeUndefined()
    })
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

  it("stores each chapter's estRuntimeSec at the project format's pace", async () => {
    const actual = await vi.importActual<typeof Db>('@boom-busters/db')
    const real = await actual.channelForProject(db, FIXTURE_PROJECT_ID)
    channelForProject.mockImplementation(async (...args: unknown[]) => {
      const channel = await actual.channelForProject(args[0] as never, args[1] as string)
      return { ...channel, format: { ...channel.format, wordsPerMinute: 120 } }
    })
    try {
      const { result } = await engine.executeStep('draft-chapter-0', {
        events: approved(),
        steps: throughSelfCheck().slice(0, 3),
      })
      const { chapterId } = result as { chapterId: string }
      const row = await getChapter(db, chapterId)
      const text = mockChapter('The audit')
      expect(row?.estRuntimeSec).toBe(estimateRuntimeSec(text, 120))
      expect(row?.estRuntimeSec).not.toBe(estimateRuntimeSec(text, real.format.wordsPerMinute))
    } finally {
      channelForProject.mockImplementation(actual.channelForProject)
    }
  })

  describe("a format's intro rule and fixed lines", () => {
    const withFormat = async (patch: Record<string, string>) => {
      const actual = await vi.importActual<typeof Db>('@boom-busters/db')
      channelForProject.mockImplementation(async (...args: unknown[]) => {
        const channel = await actual.channelForProject(args[0] as never, args[1] as string)
        return { ...channel, format: { ...channel.format, ...patch } }
      })
      return () => channelForProject.mockImplementation(actual.channelForProject)
    }

    it('stores the opening and closing lines in the chapter step, once', async () => {
      const restore = await withFormat({ introLine: 'Settle in.', outroLine: 'Sleep well.' })
      try {
        const { result } = await engine.executeStep('draft-chapter-0', {
          events: approved(),
          steps: throughSelfCheck().slice(0, 3),
        })
        const { chapterId, contentMd } = result as { chapterId: string; contentMd: string }
        const paragraphs = contentMd.split(/\n{2,}/)
        expect(paragraphs[0]).toBe('Settle in.')
        expect(paragraphs.at(-1)).toBe('Sleep well.')
        expect((await getChapter(db, chapterId))?.contentMd).toBe(contentMd)
      } finally {
        restore()
      }
    })

    it('puts the intro rule in the outline request', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
      const restore = await withFormat({ introRule: 'The opening names tonight and settles in.' })
      try {
        await engine
          .executeStep('outline', { events: approved(), steps: throughSelfCheck().slice(0, 1) })
          .catch(() => undefined)
        const sent = callLlm.mock.calls[0]![0] as { system: string }
        expect(sent.system).toContain('The opening names tonight and settles in.')
        expect(sent.system).not.toContain('glimpse of the consequence')
      } finally {
        restore()
      }
    })

    it("sends the calm playbook when the format's intent is calm, read inside the step", async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
      const restore = await withFormat({ intent: 'calm' })
      try {
        await engine
          .executeStep('outline', { events: approved(), steps: throughSelfCheck().slice(0, 1) })
          .catch(() => undefined)
        const sent = callLlm.mock.calls[0]![0] as { system: string }
        expect(sent.system).toContain('# Script craft: how a calm telling settles')
        expect(sent.system).toContain('The calm contract, per chapter')
        expect(sent.system).not.toContain('The tension contract')
      } finally {
        restore()
      }
    })

    it('sends the documentary playbook when the intent is tension', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
      const restore = await withFormat({ intent: 'tension' })
      try {
        await engine
          .executeStep('outline', { events: approved(), steps: throughSelfCheck().slice(0, 1) })
          .catch(() => undefined)
        const sent = callLlm.mock.calls[0]![0] as { system: string }
        expect(sent.system).toContain('The tension contract, per chapter')
        expect(sent.system).not.toContain('how a calm telling settles')
      } finally {
        restore()
      }
    })

    it("sends the calm playbook in the chapter step when the format's intent is calm", async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: 'A whole chapter.' })
      const restore = await withFormat({ intent: 'calm' })
      try {
        await engine.executeStep('draft-chapter-0', {
          events: approved(),
          steps: throughSelfCheck().slice(0, 3),
        })
        const sent = callLlm.mock.calls[0]![0] as { system: string }
        expect(sent.system).toContain('# Script craft: how a calm telling settles')
        // The chapter's own contract rides in a later message, not the system prompt.
        expect(JSON.stringify(sent)).toContain('The calm contract for this chapter')
      } finally {
        restore()
      }
    })

    it("sends the calm playbook in the self-check step when the format's intent is calm", async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: JSON.stringify({ warnings: [] }) })
      const restore = await withFormat({ intent: 'calm' })
      try {
        await engine.executeStep('self-check-0', {
          events: approved(),
          steps: throughSelfCheck().slice(0, 4),
        })
        const sent = callLlm.mock.calls[0]![0] as { system: string }
        expect(sent.system).toContain('chapter of a calm telling')
      } finally {
        restore()
      }
    })

    describe('the outline of a calm format holds no tension', () => {
      const tensionOutline = () => {
        const outline = mockOutline(10)
        outline.chapters[0]!.reveals = 'A leaked reveal'
        return outline
      }
      const outlineOf = async () => {
        const { result } = await engine.executeStep('outline', {
          events: approved(),
          steps: throughSelfCheck().slice(0, 1),
        })
        return (
          result as {
            outline: {
              chapters: { question?: string; withhold?: string; reveals?: string }[]
              close: { openThread?: string }
            }
          }
        ).outline
      }

      it('blanks question, withhold, reveals and the open thread when the model fills them', async () => {
        vi.stubEnv('MOCK_PROVIDERS', '')
        callLlm.mockReset()
        callLlm.mockResolvedValue({ text: JSON.stringify(tensionOutline()) })
        const restore = await withFormat({ intent: 'calm' })
        try {
          const outline = await outlineOf()
          expect(outline.chapters.length).toBeGreaterThan(1)
          for (const chapter of outline.chapters) {
            expect(chapter.question ?? '').toBe('')
            expect(chapter.withhold ?? '').toBe('')
            expect(chapter.reveals ?? '').toBe('')
          }
          expect(outline.close.openThread ?? '').toBe('')
        } finally {
          restore()
        }
      })

      it('leaves a tension outline as the model wrote it', async () => {
        vi.stubEnv('MOCK_PROVIDERS', '')
        callLlm.mockReset()
        callLlm.mockResolvedValue({ text: JSON.stringify(tensionOutline()) })
        const restore = await withFormat({ intent: 'tension' })
        try {
          const outline = await outlineOf()
          expect(outline.chapters[0]!.question).toBe('Mock open question 1')
          expect(outline.chapters[0]!.withhold).toBe('Mock withheld fact 1')
          expect(outline.chapters[0]!.reveals).toBe('A leaked reveal')
          expect(outline.close.openThread).toBe('Mock open thread.')
        } finally {
          restore()
        }
      })
    })

    it('asks the outline for the words the fixed lines leave', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      const askedWords = async (patch: Record<string, string>): Promise<number> => {
        callLlm.mockReset()
        callLlm.mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
        const restore = await withFormat(patch)
        try {
          await engine.executeStep('outline', {
            events: approved(),
            steps: throughSelfCheck().slice(0, 1),
          })
          const sent = callLlm.mock.calls[0]![0] as { system: string }
          return Number(/totalling about (\d+) words/.exec(sent.system)?.[1])
        } finally {
          restore()
        }
      }
      const bare = await askedWords({ introLine: '', outroLine: '' })
      const fixed = await askedWords({
        introLine: 'one two three four five six seven eight nine ten',
        outroLine: 'one two three four five',
      })
      expect(bare - fixed).toBe(15)
    })

    it('leaves the fixed lines out of the self-check', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: JSON.stringify({ warnings: [] }) })
      const restore = await withFormat({ introLine: 'Settle in.', outroLine: 'Sleep well.' })
      try {
        await engine.executeStep('self-check-0', {
          events: approved(),
          steps: [
            ...throughSelfCheck().slice(0, 3),
            {
              id: 'draft-chapter-0',
              handler: () => ({
                ok: true,
                chapterId: 'chapter-0',
                contentMd: fixedChapter,
              }),
            },
          ],
        })
        const sent = JSON.stringify(callLlm.mock.calls[0]![0])
        expect(sent).toContain('EY refused to sign the accounts.')
        expect(sent).not.toContain('Settle in.')
        expect(sent).not.toContain('Sleep well.')
      } finally {
        restore()
      }
    })
  })

  it("reads the project's search brief inside the outline step, never from an earlier step", async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
    const brief = {
      subject: 'Wirecard',
      measuredAt: '2026-11-02T12:00:00.000Z',
      targetKeyword: {
        keyword: 'wirecard scandal',
        volume: 60,
        competition: 40,
        overall: 58,
        estimatedMonthlySearch: 12000,
        growthPct: 4,
      },
      secondaryKeywords: [],
      searchedQuestions: ['Where did the missing billion go?'],
      outliers: [],
      titlePatterns: [],
      toldAlready: [],
      angleOptions: [],
      chosenAngle: null,
      formatKey: null,
      fit: null,
      searchedTitles: [],
      otherLanguages: [],
      recommendedAngle: null,
      recommendationReason: null,
      ownAngle: false,
    }
    const steps = [
      {
        id: 'load-dossier',
        // A run parked before the brief existed: no brief field in the replayed result.
        handler: () => ({
          scriptId,
          caseTitle: 'Wirecard',
          targetRuntimeMin: 10,
          dossierMd: 'The dossier.',
          claims: [],
        }),
      },
    ]
    const setBrief = (value: typeof brief | null) =>
      // Every project row: the test database holds only the seeded fixture project.
      db.update(projects).set({ searchBrief: value })
    try {
      await setBrief(brief)
      await engine.executeStep('outline', { events: approved(), steps }).catch(() => undefined)
      const sent = callLlm.mock.calls[0]![0] as {
        system: string
        messages: { content: string }[]
      }
      expect(sent.system).toContain('searching "wirecard scandal" would recognise')
      expect(sent.messages[0]!.content).toContain('- "Where did the missing billion go?"')

      callLlm.mockClear()
      await setBrief(null)
      await engine.executeStep('outline', { events: approved(), steps }).catch(() => undefined)
      const plain = callLlm.mock.calls[0]![0] as { system: string; messages: { content: string }[] }
      expect(plain.system).not.toContain('a person searching')
      expect(plain.messages[0]!.content).not.toContain('Searched questions')
    } finally {
      await setBrief(null)
    }
  })

  it('refuses a project frozen to an incomplete bible before any prompt is sent', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    const channel = await createChannel(db, {
      name: 'Blank channel',
      handle: null,
      slug: `blank-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
    const kase = await createCase(db, { channelId: channel.id, title: 'T', category: 'collapse' })
    const blank = await createProjectFromCase(db, { caseId: kase.id, title: 'T' })

    const refused = await engine.executeStep('draft-chapter-0', {
      events: [{ name: 'gate/dossier.approved', data: { projectId: blank.id } }],
      steps: throughSelfCheck().slice(0, 3),
    })
    expect(refused.error).toMatchObject({
      message: FROZEN_BIBLE_INCOMPLETE_MESSAGE,
    })
    expect(callLlm).not.toHaveBeenCalled()

    // The optional marking stops with the same reason and sends nothing either.
    await markShortsStep(blank.id, { chapters })
    expect(callLlm).not.toHaveBeenCalled()
    expect(recordStop).toHaveBeenCalledWith(
      { projectId: blank.id, subject: 'script', subjectId: null },
      'stopped',
      expect.stringContaining(FROZEN_BIBLE_INCOMPLETE_MESSAGE),
    )
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

  describe('a format with Shorts off (ruling 18)', () => {
    const off = () => shortsEnabledForProject.mockResolvedValue(false)
    afterEach(() => {
      shortsEnabledForProject.mockImplementation(async (...args: unknown[]) => {
        const actual = await vi.importActual<typeof Db>('@boom-busters/db')
        return actual.shortsEnabledForProject(args[0] as never, args[1] as string)
      })
    })

    it('makes no marking call and stores no candidates, live', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      off()

      const { result } = await engine.executeStep('mark-shorts', {
        events: approved(),
        steps: throughSelfCheck(),
      })

      expect(result).toEqual({ ok: true, candidates: [] })
      expect(callLlm).not.toHaveBeenCalled()
    })

    it('marks nothing in mock mode either, and the run summary says so', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '1')
      off()

      const { result } = await engine.execute({
        events: approved(),
        steps: [...throughSelfCheck(), { id: 'advance-to-voice', handler: () => undefined }],
      })

      expect(result).toMatchObject({ outcome: 'auto-approved', shorts: 0, shortsOff: true })
      expect(await latestShortsCandidates(db, FIXTURE_PROJECT_ID)).toEqual([])
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('Shorts off for this format') }),
      )
      expect(notify).not.toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('Shorts candidates') }),
      )
    })

    it('still counts candidates when the format makes Shorts', async () => {
      const { result } = await engine.execute({
        events: approved(),
        steps: [
          ...throughSelfCheck(),
          { id: 'mark-shorts', handler: () => ({ ok: true, candidates: [candidate] }) },
          { id: 'advance-to-voice', handler: () => undefined },
        ],
      })

      expect(result).toMatchObject({ outcome: 'auto-approved', shorts: 1, shortsOff: false })
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('1 Shorts candidates') }),
      )
    })
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

  describe('the self-check step reads scenes, standing and the code checks (decision 458)', () => {
    const text = chapters[0]!.contentMd
    const savedChapter = async (contentMd = text): Promise<string> =>
      (
        await saveChapter(db, {
          scriptId,
          index: 0,
          title: 'The audit',
          contentMd,
          estRuntimeSec: 60,
        })
      ).id
    const upTo = (chapterId: string, contentMd = text) => [
      ...throughSelfCheck().slice(0, 3),
      { id: 'draft-chapter-0', handler: () => ({ ok: true, chapterId, contentMd }) },
    ]
    const live = (answer: unknown) => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: JSON.stringify(answer) })
    }
    const warning = (kind: 'style' | 'unsourced-claim') => ({
      kind,
      sentence: 'EY refused to sign the accounts.',
      message: 'A stored warning.',
    })

    it('sends the scene list beside the claims, from the dossier row', async () => {
      live({ warnings: [] })
      const [original] = await db
        .select({ contentMd: dossiers.contentMd })
        .from(dossiers)
        .where(eq(dossiers.projectId, FIXTURE_PROJECT_ID))
      try {
        await db
          .update(dossiers)
          .set({ contentMd: '## Timeline\n- 2020-06 — EY refuses to sign the accounts.\n' })
          .where(eq(dossiers.projectId, FIXTURE_PROJECT_ID))
        await engine.executeStep('self-check-0', {
          events: approved(),
          steps: upTo(await savedChapter()),
        })
      } finally {
        await db
          .update(dossiers)
          .set({ contentMd: original!.contentMd })
          .where(eq(dossiers.projectId, FIXTURE_PROJECT_ID))
      }
      const sent = callLlm.mock.calls[0]![0] as { messages: { content: string }[] }
      expect(sent.messages[0]!.content).toContain('Scenes:\n[S1]')
    })

    it("stamps the profile's severity on an overstated-standing warning", async () => {
      live({
        warnings: [
          {
            kind: 'overstated-standing',
            sentence: 'EY refused to sign the accounts.',
            message: 'ONE STUDY narrated as settled',
          },
        ],
      })
      const actual = await vi.importActual<typeof Db>('@boom-busters/db')
      channelForProject.mockImplementation(async (...args: unknown[]) => {
        const channel = await actual.channelForProject(args[0] as never, args[1] as string)
        return { ...channel, bible: { ...channel.bible, researchProfile: 'science' } }
      })
      try {
        const chapterId = await savedChapter()
        await engine.executeStep('self-check-0', { events: approved(), steps: upTo(chapterId) })
        const stored = (await getChapter(db, chapterId))!.warnings
        expect(stored.find((w) => w.kind === 'overstated-standing')?.severity).toBe('advisory')
      } finally {
        channelForProject.mockImplementation(actual.channelForProject)
      }
    })

    it("stores the style and length checks as advisory beside the model's warnings", async () => {
      live({ warnings: [] })
      const asking = `${text} Who knew?`
      const chapterId = await savedChapter(asking)
      await engine.executeStep('self-check-0', {
        events: approved(),
        steps: upTo(chapterId, asking),
      })
      const stored = (await getChapter(db, chapterId))!.warnings
      expect(stored).toContainEqual(expect.objectContaining({ kind: 'style' }))
      const counts = countBySeverity([{ warnings: stored }])
      expect(counts.blocking).toBe(0)
      expect(counts.advisory).toBeGreaterThanOrEqual(1)
    })

    it('ignores a severity the model sets: an advisory-marked grounding warning still blocks', async () => {
      live({ warnings: [{ ...warning('unsourced-claim'), severity: 'advisory' }] })
      const chapterId = await savedChapter()
      await engine.executeStep('self-check-0', { events: approved(), steps: upTo(chapterId) })
      const stored = (await getChapter(db, chapterId))!.warnings
      expect(countBySeverity([{ warnings: stored }]).blocking).toBe(1)
      expect(stored.find((w) => w.kind === 'unsourced-claim')).not.toHaveProperty('severity')

      const { ctx } = await engine.executeStep('open-gate', {
        events: approved(),
        steps: [
          ...upTo(chapterId),
          { id: 'self-check-0', handler: () => ({ warnings: 1 }) },
          { id: 'mark-shorts', handler: () => ({ ok: true, candidates: [] }) },
        ],
      })
      expect(ctx.step.run).toHaveBeenCalledWith('open-gate', expect.any(Function))
      expect(ctx.step.run).not.toHaveBeenCalledWith('auto-approve', expect.any(Function))
    })

    it("never lints the format's fixed lines", async () => {
      live({ warnings: [] })
      const introLine = 'Ready for 101 stories?'
      const actual = await vi.importActual<typeof Db>('@boom-busters/db')
      channelForProject.mockImplementation(async (...args: unknown[]) => {
        const channel = await actual.channelForProject(args[0] as never, args[1] as string)
        return { ...channel, format: { ...channel.format, introLine, outroLine: '' } }
      })
      try {
        const withIntro = `${introLine}

${text}`
        const chapterId = await savedChapter(withIntro)
        await engine.executeStep('self-check-0', {
          events: approved(),
          steps: upTo(chapterId, withIntro),
        })
        const stored = (await getChapter(db, chapterId))!.warnings
        expect(stored.filter((w) => w.sentence.includes('101'))).toEqual([])
        expect(stored.filter((w) => w.kind === 'off-target-length')).toEqual(
          (
            await (async () => {
              // The same chapter without the intro line: the length verdict must not change.
              const bareId = await savedChapter()
              await engine.executeStep('self-check-0', { events: approved(), steps: upTo(bareId) })
              return (await getChapter(db, bareId))!.warnings
            })()
          ).filter((w) => w.kind === 'off-target-length'),
        )
      } finally {
        channelForProject.mockImplementation(actual.channelForProject)
      }
    })

    it('auto-approves on zero blocking whatever the advisory count', async () => {
      const chapterId = await savedChapter()
      await setChapterWarnings(db, chapterId, [
        warning('style'),
        warning('style'),
        warning('style'),
      ])
      const { result } = await engine.execute({
        events: approved(),
        steps: [
          ...upTo(chapterId),
          { id: 'self-check-0', handler: () => ({ warnings: 3 }) },
          { id: 'mark-shorts', handler: () => ({ ok: true, candidates: [] }) },
          { id: 'advance-to-voice', handler: () => undefined },
        ],
      })

      expect(result).toMatchObject({ outcome: 'auto-approved', blocking: 0, advisory: 3 })
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('0 blocking · 3 advisory') }),
      )
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('hedges ') }),
      )
    })

    it('parks the gate on one blocking warning', async () => {
      const chapterId = await savedChapter()
      await setChapterWarnings(db, chapterId, [warning('unsourced-claim')])
      const { ctx } = await engine.executeStep('open-gate', {
        events: approved(),
        steps: [
          ...upTo(chapterId),
          { id: 'self-check-0', handler: () => ({ warnings: 1 }) },
          { id: 'mark-shorts', handler: () => ({ ok: true, candidates: [] }) },
        ],
      })

      expect(ctx.step.run).toHaveBeenCalledWith('open-gate', expect.any(Function))
      expect(ctx.step.run).not.toHaveBeenCalledWith('auto-approve', expect.any(Function))
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'gate-open',
          body: expect.stringContaining('1 blocking'),
        }),
      )
    })

    it('reads a summary replayed without blocking as its warnings count', async () => {
      const { ctx } = await engine.executeStep('open-gate', {
        events: approved(),
        steps: [
          ...throughSelfCheck(),
          { id: 'mark-shorts', handler: () => ({ ok: true, candidates: [] }) },
          {
            id: 'finish-draft',
            handler: () => ({
              chapters: 1,
              warnings: 2,
              runtimeMin: 1,
              shorts: 0,
              shortsOff: true,
            }),
          },
        ],
      })

      expect(ctx.step.run).toHaveBeenCalledWith('open-gate', expect.any(Function))
      expect(ctx.step.run).not.toHaveBeenCalledWith('auto-approve', expect.any(Function))
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('2 blocking · 0 advisory') }),
      )
    })
  })
})

/**
 * The craft loop's steps (decision 463). A suite of its own: it never seeds,
 * never truncates and never deletes other suites' scripts, so the files that
 * share the test database in parallel are not disturbed. It owns one script
 * row and removes it after each test.
 */
describeDb('the craft loop (decision 463)', () => {
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
    { id: 'self-check-0', handler: () => ({ warnings: 0 }) },
  ]

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: scriptRunner })
    forgetRunRows()
    callLlm.mockReset()
    recordRepairs.mockReset()
    scriptId = (await createScriptVersion(db, FIXTURE_PROJECT_ID)).id
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(scripts).where(eq(scripts.id, scriptId))
    // Only this function's mirror rows, never the whole mirror: the suites that
    // share the database count runs, and a truncate would cut theirs short.
    await db.delete(runs).where(eq(runs.functionName, 'script-runner'))
  })

  const text = chapters[0]!.contentMd
  const finding = {
    sentence: 'EY refused to sign the accounts.',
    problem: 'A flat statement',
    fix: 'Show the refusal',
  }
  const withCraft = () =>
    throughSelfCheck().map((step) =>
      step.id === 'load-dossier'
        ? { ...step, handler: () => ({ ...(step.handler() as object), craftLoop: true }) }
        : step,
    )
  const savedChapter = async (contentMd = text): Promise<string> =>
    (
      await saveChapter(db, {
        scriptId,
        index: 0,
        title: 'The audit',
        contentMd,
        estRuntimeSec: 60,
      })
    ).id
  const live = (answer: unknown) => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm.mockResolvedValue({
      text: typeof answer === 'string' ? answer : JSON.stringify(answer),
    })
  }
  const withFormat = async (patch: Record<string, string>) => {
    const actual = await vi.importActual<typeof Db>('@boom-busters/db')
    channelForProject.mockImplementation(async (...args: unknown[]) => {
      const channel = await actual.channelForProject(args[0] as never, args[1] as string)
      return { ...channel, format: { ...channel.format, ...patch } }
    })
    return () => channelForProject.mockImplementation(actual.channelForProject)
  }
  /** Steps up to the draft, with a saved chapter row behind it. */
  const upTo = (chapterId: string, contentMd = text) => [
    ...withCraft().slice(0, 3),
    { id: 'draft-chapter-0', handler: () => ({ ok: true, chapterId, contentMd }) },
  ]

  it('sends the scene list in the chapter request', async () => {
    live('A whole chapter.')
    const [original] = await db
      .select({ contentMd: dossiers.contentMd })
      .from(dossiers)
      .where(eq(dossiers.projectId, FIXTURE_PROJECT_ID))
    try {
      await db
        .update(dossiers)
        .set({ contentMd: '## Timeline\n- 2020-06 — EY refuses to sign the accounts.\n' })
        .where(eq(dossiers.projectId, FIXTURE_PROJECT_ID))
      await engine.executeStep('draft-chapter-0', {
        events: approved(),
        steps: withCraft().slice(0, 3),
      })
    } finally {
      await db
        .update(dossiers)
        .set({ contentMd: original!.contentMd })
        .where(eq(dossiers.projectId, FIXTURE_PROJECT_ID))
    }
    const sent = callLlm.mock.calls[0]![0] as { messages: { content: string }[] }
    expect(sent.messages[0]!.content).toContain('Scenes:\n[S1]')
  })

  it('checks the chapter without its fixed lines', async () => {
    live({ findings: [] })
    const restore = await withFormat({ introLine: FIXED_LINES[0], outroLine: FIXED_LINES[1] })
    try {
      await engine.executeStep('craft-check-0', {
        events: approved(),
        steps: upTo('c0', fixedChapter),
      })
      const sent = callLlm.mock.calls[0]![0] as { messages: { content: string }[] }
      const last = sent.messages.at(-1)!.content
      expect(last).toContain(text)
      expect(last).not.toContain(FIXED_LINES[0])
      expect(last).not.toContain(FIXED_LINES[1])
    } finally {
      restore()
    }
  })

  it('hands back the retry after an unreadable first answer, making no second call', async () => {
    live('not json')
    const { result } = await engine.executeStep('craft-check-0', {
      events: approved(),
      steps: upTo('c0'),
    })
    expect(result).toEqual({
      ok: true,
      findings: [],
      retry: { call: 'retry: refused', issue: expect.any(String) },
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('returns a stop for an unreadable retry, never failing the step', async () => {
    live('not json')
    const { result } = await engine.executeStep('craft-check-0-retry', {
      events: approved(),
      steps: [
        ...upTo('c0'),
        {
          id: 'craft-check-0',
          handler: () => ({
            ok: true,
            findings: [],
            retry: { call: 'retry: refused', issue: 'it was not JSON' },
          }),
        },
      ],
    })
    expect(result).toEqual({ ok: true, findings: [], stopped: expect.any(String) })
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it("runs the check's retry in a step of its own, and its findings drive the revision", async () => {
    const chapterId = await savedChapter()
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm
      .mockResolvedValueOnce({ text: JSON.stringify({ findings: [finding] }) })
      .mockResolvedValueOnce({ text: text.replace(finding.sentence, 'EY did not sign.') })
    const { result, ctx } = await engine.executeStep('craft-revise-0', {
      events: approved(),
      steps: [
        ...upTo(chapterId),
        {
          id: 'craft-check-0',
          handler: () => ({
            ok: true,
            findings: [],
            retry: { call: 'retry: refused', issue: 'it was not JSON' },
          }),
        },
      ],
    })
    expect(ctx.step.run).toHaveBeenCalledWith('craft-check-0-retry', expect.any(Function))
    expect(callLlm).toHaveBeenCalledTimes(2)
    const sent = callLlm.mock.calls[1]![0] as { messages: { content: string }[] }
    expect(sent.messages.at(-1)!.content).toContain(finding.fix)
    expect(result).toMatchObject({
      ok: true,
      contentMd: expect.stringContaining('EY did not sign.'),
    })
  })

  it('refuses a revision far shorter than the draft, keeps the draft and stores the first findings', async () => {
    const chapterId = await savedChapter()
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm
      .mockResolvedValueOnce({ text: 'Here is the fix.' })
      .mockResolvedValueOnce({ text: JSON.stringify({ warnings: [] }) })
    const steps = [
      ...upTo(chapterId),
      { id: 'craft-check-0', handler: () => ({ ok: true, findings: [finding] }) },
    ]
    const { ctx } = await engine.executeStep('self-check-0', { events: approved(), steps })
    expect(ctx.step.run).not.toHaveBeenCalledWith('craft-recheck-0', expect.any(Function))
    expect((await getChapter(db, chapterId))!.contentMd).toBe(text)
    const craft = (await getChapter(db, chapterId))!.warnings.find((w) => w.kind === 'craft')
    expect(craft).toMatchObject({ kind: 'craft', sentence: finding.sentence })
    // The self-check read the draft, not the fragment.
    const sent = callLlm.mock.calls[1]![0] as { messages: { content: string }[] }
    expect(sent.messages.map((m) => m.content).join(' ')).not.toContain('Here is the fix.')
  })

  it('returns stopped from the revise step for a fragment', async () => {
    const chapterId = await savedChapter()
    live('Here is the fix.')
    const { result } = await engine.executeStep('craft-revise-0', {
      events: approved(),
      steps: [
        ...upTo(chapterId),
        { id: 'craft-check-0', handler: () => ({ ok: true, findings: [finding] }) },
      ],
    })
    expect(result).toEqual({
      ok: true,
      stopped: 'the revision came back much shorter than the draft',
    })
    expect((await getChapter(db, chapterId))!.contentMd).toBe(text)
  })

  it('saves the revision with each fixed line once', async () => {
    const restore = await withFormat({ introLine: FIXED_LINES[0], outroLine: FIXED_LINES[1] })
    try {
      const chapterId = await savedChapter(fixedChapter)
      live(`${FIXED_LINES[0]}\n\nEY did not sign the accounts. The shares collapsed in nine days.`)
      const { result } = await engine.executeStep('craft-revise-0', {
        events: approved(),
        steps: [
          ...upTo(chapterId, fixedChapter),
          { id: 'craft-check-0', handler: () => ({ ok: true, findings: [finding] }) },
        ],
      })
      const stored = (await getChapter(db, chapterId))!.contentMd
      for (const line of FIXED_LINES) expect(stored.split(line)).toHaveLength(2)
      expect(stored).toContain('EY did not sign the accounts.')
      expect(result).toEqual({ ok: true, contentMd: stored })
    } finally {
      restore()
    }
  })

  it("hands the revision to the self-check and stores the recheck's findings as advisory craft warnings", async () => {
    live({ warnings: [] })
    const chapterId = await savedChapter()
    await engine.executeStep('self-check-0', {
      events: approved(),
      steps: [
        ...upTo(chapterId),
        { id: 'craft-check-0', handler: () => ({ ok: true, findings: [finding] }) },
        { id: 'craft-revise-0', handler: () => ({ ok: true, contentMd: 'REVISED. Text.' }) },
        {
          id: 'craft-recheck-0',
          handler: () => ({ ok: true, findings: [{ ...finding, sentence: 'REVISED.' }] }),
        },
      ],
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
    const sent = callLlm.mock.calls[0]![0] as { messages: { content: string }[] }
    expect(sent.messages.map((m) => m.content).join(' ')).toContain('REVISED.')
    const stored = (await getChapter(db, chapterId))!.warnings
    const craft = stored.find((w) => w.kind === 'craft')
    expect(craft).toMatchObject({ kind: 'craft', sentence: 'REVISED.' })
    expect(craft).not.toHaveProperty('severity')
  })

  it('skips the revision and the recheck when the first check finds nothing', async () => {
    live({ warnings: [] })
    const chapterId = await savedChapter()
    await engine.executeStep('self-check-0', {
      events: approved(),
      steps: [
        ...upTo(chapterId),
        { id: 'craft-check-0', handler: () => ({ ok: true, findings: [] }) },
      ],
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('runs no craft step for a run that loaded before the deploy', async () => {
    live({ warnings: [] })
    const chapterId = await savedChapter()
    await engine.executeStep('self-check-0', {
      events: approved(),
      steps: [
        ...throughSelfCheck().slice(0, 3),
        { id: 'draft-chapter-0', handler: () => ({ ok: true, chapterId, contentMd: text }) },
      ],
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
    for (const call of callLlm.mock.calls) {
      expect((call[0] as { task?: string }).task).not.toBe('scripting')
    }
  })

  it('parks the stage when a craft call is over budget', async () => {
    const { result, ctx } = await engine.execute({
      events: approved(),
      steps: [
        ...withCraft().slice(0, 4),
        { id: 'craft-check-0', handler: () => ({ ok: false, gate: { message: 'Over budget' } }) },
        { id: 'craft-0-over-budget', handler: () => undefined },
      ],
    })
    expect(result).toMatchObject({ outcome: 'over-budget' })
    expect(ctx.step.run).toHaveBeenCalledWith('craft-0-over-budget', expect.any(Function))
  })

  const trimmedLoop = () => [
    ...withCraft().slice(0, 4),
    { id: 'craft-check-0', handler: () => ({ ok: true, findings: [finding] }) },
    { id: 'craft-revise-0', handler: () => ({ ok: true, contentMd: 'EY did not sign.' }) },
    { id: 'craft-recheck-0', handler: () => ({ ok: true, findings: [] }) },
    { id: 'self-check-0', handler: () => ({ warnings: 0 }) },
  ]

  it('puts the craft notices on the strip in mock mode', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    recordRepairs.mockReset()
    await engine.executeStep('mark-shorts', { events: approved(), steps: trimmedLoop() })
    expect(recordRepairs).toHaveBeenCalledWith(
      SCRIPT_NOTICES,
      [],
      [expect.objectContaining({ kind: 'trimmed' })],
    )
  })

  it('puts the craft notices and the outline repairs on the strip with Shorts off', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    recordRepairs.mockReset()
    shortsEnabledForProject.mockResolvedValue(false)
    const repair = { action: 'trimmed' as const, field: "chapter 1's beat" }
    try {
      await engine.executeStep('mark-shorts', {
        events: approved(),
        steps: trimmedLoop().map((step) =>
          step.id === 'outline'
            ? {
                ...step,
                handler: () => ({
                  ok: true,
                  outline: {
                    chapters: [{ title: 'The audit', beat: 'x'.repeat(30), targetWords: 300 }],
                  },
                  repairs: [repair],
                }),
              }
            : step,
        ),
      })
      expect(recordRepairs).toHaveBeenCalledWith(
        SCRIPT_NOTICES,
        [repair],
        [expect.objectContaining({ kind: 'trimmed' })],
      )
    } finally {
      const actual = await vi.importActual<typeof Db>('@boom-busters/db')
      shortsEnabledForProject.mockImplementation(async (...args: unknown[]) =>
        actual.shortsEnabledForProject(args[0] as never, args[1] as string),
      )
    }
  })
})
