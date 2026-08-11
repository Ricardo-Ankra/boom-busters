import {
  countWarnings,
  createScriptVersion,
  getDossier,
  getLatestScript,
  getProject,
  saveChapter,
  saveClaimRefs,
  scriptableClaims,
  setChapterWarnings,
  setProjectStage,
  setScriptStatus,
} from '@boom-busters/db'
import {
  buildChapterRequest,
  buildOutlineRequest,
  buildSelfCheckRequest,
  buildShortsRequest,
  chapterTail,
  mockChapter,
  mockOutline,
  mockSelfCheck,
  mockShortsCandidates,
  parseOutline,
  parseSelfCheck,
  parseShortsCandidates,
  useMockProviders,
} from '@boom-busters/providers'
import type { ScriptClaim } from '@boom-busters/providers'
import type { Outline, ShortsCandidate } from '@boom-busters/schemas'
import {
  BudgetExceededError,
  estimateRuntimeSec,
  parseEventData,
  serialiseError,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { inngest } from '../client'
import { events } from '../events'
import {
  budgetGateData,
  closeReviewGate,
  markStageFailed,
  openReviewGate,
  type GateContext,
} from '../lib/gates'

/**
 * script-runner (build spec section 7.2).
 *
 * `gate/dossier.approved` → outline → chapters drafted **sequentially** → a
 * self-check pass per chapter writing `claim_refs` and gutter warnings →
 * Shorts-candidate marking → gate.
 *
 * Chapters are sequential rather than fanned out because each one is fed the
 * tail of the previous chapter: a script whose chapters were written in
 * parallel reads like eight essays about the same company, with every one of
 * them re-introducing the CEO.
 *
 * Every chapter is its own step, so a failure in chapter six does not re-draft
 * and re-charge chapters one to five.
 *
 * Like the dossier-runner, this waits on approval only; `gate/script.
 * changes_requested` is a Script Studio concern, where a human edits the text
 * directly and regenerates individual sections.
 */

const FUNCTION_ID = 'script-runner'

export const scriptRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Script drafting',
    retries: 4,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await markStageFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        serialiseError(event.data.error),
      )
    },
    triggers: [events.dossierApproved],
  },
  async ({ event, step, runId }) => {
    const { projectId } = parseEventData('gate/dossier.approved', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const setup = await step.run('load-dossier', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      const dossier = await getDossier(db, projectId)
      if (!dossier) {
        throw new NonRetriableError('The dossier is gone, so there is nothing to script from.')
      }

      // The quarantine rule, read from the one query that enforces it.
      const usable = await scriptableClaims(db, projectId)

      await setProjectStage(db, projectId, { stage: 'script', stageStatus: 'running' })
      const script = await createScriptVersion(db, projectId)

      return {
        scriptId: script.id,
        caseTitle: project.title,
        targetRuntimeMin: project.targetRuntimeMin,
        dossierMd: dossier.contentMd,
        claims: usable.map((claim) => ({
          id: claim.id,
          text: claim.text,
          sourceUrl: claim.sourceUrl,
          confidence: claim.confidence,
        })) satisfies ScriptClaim[],
      }
    })

    const mocked = useMockProviders()

    // -----------------------------------------------------------------------
    // Outline
    // -----------------------------------------------------------------------

    const outlineStep = await step.run(
      'outline',
      async (): Promise<
        { ok: true; outline: Outline } | { ok: false; gate: Record<string, unknown> }
      > => {
        if (mocked) return { ok: true, outline: mockOutline(setup.targetRuntimeMin) }
        try {
          return {
            ok: true,
            outline: parseOutline(
              (
                await callLlm(
                  buildOutlineRequest({
                    caseTitle: setup.caseTitle,
                    dossierMd: setup.dossierMd,
                    claims: setup.claims,
                    targetRuntimeMin: setup.targetRuntimeMin,
                  }),
                  { projectId },
                )
              ).text,
            ),
          }
        } catch (error) {
          if (error instanceof BudgetExceededError)
            return { ok: false, gate: budgetGateData(error) }
          throw error
        }
      },
    )

    if (!outlineStep.ok) {
      await step.run('outline-over-budget', () => markStageFailed(ctx, outlineStep.gate))
      return { projectId, outcome: 'over-budget' as const }
    }

    const outline = outlineStep.outline

    // -----------------------------------------------------------------------
    // Chapters, in order, each seamed onto the last
    // -----------------------------------------------------------------------

    let previousTail = ''
    const written: { index: number; title: string; contentMd: string; chapterId: string }[] = []

    for (const [index, chapter] of outline.chapters.entries()) {
      const drafted = await step.run(
        `draft-chapter-${index}`,
        async (): Promise<
          | { ok: true; chapterId: string; contentMd: string }
          | { ok: false; gate: Record<string, unknown> }
        > => {
          let contentMd: string
          if (mocked) {
            contentMd = mockChapter(chapter.title)
          } else {
            try {
              contentMd = (
                await callLlm(
                  buildChapterRequest({
                    caseTitle: setup.caseTitle,
                    outline,
                    chapterIndex: index,
                    previousTail,
                    claims: setup.claims,
                  }),
                  { projectId, estimateOutputTokens: Math.round(chapter.targetWords * 1.6) },
                )
              ).text
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                return { ok: false, gate: budgetGateData(error) }
              }
              throw error
            }
          }

          const row = await saveChapter(db, {
            scriptId: setup.scriptId,
            index,
            title: chapter.title,
            contentMd,
            estRuntimeSec: estimateRuntimeSec(contentMd),
          })

          return { ok: true, chapterId: row.id, contentMd }
        },
      )

      if (!drafted.ok) {
        // Chapters already written are kept: they cost money and a human can
        // still work with a partial script.
        await step.run(`chapter-${index}-over-budget`, () => markStageFailed(ctx, drafted.gate))
        return { projectId, outcome: 'over-budget' as const, chaptersWritten: written.length }
      }

      previousTail = chapterTail(drafted.contentMd)
      written.push({
        index,
        title: chapter.title,
        contentMd: drafted.contentMd,
        chapterId: drafted.chapterId,
      })
    }

    // -----------------------------------------------------------------------
    // Self-check, per chapter
    // -----------------------------------------------------------------------

    for (const chapter of written) {
      await step.run(`self-check-${chapter.index}`, async () => {
        const check = mocked
          ? mockSelfCheck(chapter.contentMd)
          : parseSelfCheck(
              (
                await callLlm(
                  buildSelfCheckRequest({
                    chapterTitle: chapter.title,
                    contentMd: chapter.contentMd,
                    claims: setup.claims,
                  }),
                  { projectId },
                )
              ).text,
            )

        await setChapterWarnings(db, chapter.chapterId, check.warnings)
        const refs = await saveClaimRefs(db, {
          chapterId: chapter.chapterId,
          projectId,
          refs: check.refs,
        })

        return { warnings: check.warnings.length, refs }
      })
    }

    // -----------------------------------------------------------------------
    // Shorts candidates
    // -----------------------------------------------------------------------

    const shorts = await step.run('mark-shorts', async (): Promise<ShortsCandidate[]> => {
      if (mocked) return mockShortsCandidates(written)
      // A failure here must not fail the script. The candidates are a
      // convenience for M7; the narration is the deliverable.
      try {
        return parseShortsCandidates(
          (await callLlm(buildShortsRequest({ chapters: written }), { projectId })).text,
        )
      } catch (error) {
        console.error('[script-runner] Shorts marking failed', serialiseError(error))
        return []
      }
    })

    const summary = await step.run('finish-draft', async () => {
      await setScriptStatus(db, setup.scriptId, 'self_checked')
      const latest = await getLatestScript(db, projectId)
      const warnings = latest ? countWarnings(latest.chapters) : 0

      return {
        chapters: written.length,
        warnings,
        runtimeMin: Math.round(
          (latest?.chapters.reduce((total, c) => total + c.estRuntimeSec, 0) ?? 0) / 60,
        ),
        shorts: shorts.length,
      }
    })

    await step.run('open-gate', () =>
      openReviewGate(ctx, {
        stage: 'script',
        projectStage: 'script',
        summary:
          `Script ready · ${summary.chapters} chapters · ~${summary.runtimeMin} min · ` +
          `${summary.warnings} warnings · ${summary.shorts} Shorts candidates`,
      }),
    )

    const approval = await step.waitForEvent('await-script-gate', {
      event: 'gate/script.approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!approval) {
      await step.run('gate-timed-out', () =>
        markStageFailed(ctx, {
          message: 'The script gate went 30 days without a decision.',
        }),
      )
      return { projectId, outcome: 'gate-timeout' as const }
    }

    await step.run('close-gate', async () => {
      await setScriptStatus(db, setup.scriptId, 'approved')
      await closeReviewGate(ctx, { stage: 'script', nextStage: 'voice' })
    })

    return { projectId, outcome: 'approved' as const, ...summary }
  },
)
