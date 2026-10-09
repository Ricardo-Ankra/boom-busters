import {
  countWarnings,
  createScriptVersion,
  getDossier,
  getLatestScript,
  getProject,
  saveChapter,
  saveClaimRefs,
  scriptableClaims,
  setScriptOutline,
  setShortsCandidates,
  setChapterWarnings,
  setProjectStage,
  setScriptStatus,
} from '@boom-busters/db'
import {
  chapterTail,
  mockChapter,
  mockOutline,
  mockSelfCheck,
  mockShortsCandidates,
  mockProvidersEnabled,
  tensionFromOutline,
} from '@boom-busters/providers'
import type { ScriptClaim } from '@boom-busters/providers'
import type { NoticeTarget, Outline, ShortsCandidate } from '@boom-busters/schemas'
import {
  BudgetExceededError,
  estimateRuntimeSec,
  parseEventData,
  serialiseError,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { completeForProject } from '@/lib/answer-call'
import { recordRepairs, recordStop } from '@/lib/notices'
import {
  draftChapterWith,
  draftOutlineWith,
  markShortsWith,
  selfCheckWith,
  SHORTS_UNMARKED,
} from '@/lib/script-answers'
import { inngest } from '../client'
import { events } from '../events'
import {
  autoCloseReviewGate,
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

/** What the mark-shorts step returns since decision 293. */
export type MarkedShorts =
  { ok: true; candidates: ShortsCandidate[] } | { ok: false; gate: Record<string, unknown> }

/**
 * The mark-shorts step's stored result. A run parked at the script gate
 * before decision 293 replays the bare candidate list this step used to
 * return (Inngest memoises step results), so that shape still reads.
 */
export function readMarkedShorts(stored: MarkedShorts | ShortsCandidate[]): MarkedShorts {
  return Array.isArray(stored) ? { ok: true, candidates: stored } : stored
}

/** A stop's bare reason: without `markShortsWith`'s lead-in or a closing full stop. */
function stopReason(message: string): string {
  const lead = `${SHORTS_UNMARKED}: `
  return (message.startsWith(lead) ? message.slice(lead.length) : message).replace(/\.$/, '')
}

/**
 * The mark-shorts step on the answer helper (decision 293). Candidates that
 * land replace the script's notices with what the repair changed. A stop
 * stores none and says why on Script Studio's Shorts strip: the narration is
 * this stage's deliverable, and the Shorts stage marks them again when it
 * finds none. A budget stop is handed back for the run to park, as the outline
 * and chapter steps do. Any other failure, a provider outage included, ends
 * the same way as a stop: the marking is optional here, and a script whose
 * chapters are all paid for must not fail for it (decision 293 ruling).
 */
export async function markShortsStep(
  projectId: string,
  input: Parameters<typeof markShortsWith>[1],
): Promise<MarkedShorts> {
  const target: NoticeTarget = { projectId, subject: 'script', subjectId: null }
  let marked: Awaited<ReturnType<typeof markShortsWith>>
  try {
    marked = await markShortsWith(completeForProject(projectId), input)
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
    console.error('[script-runner] Shorts marking failed', serialiseError(error))
    const reason =
      error instanceof NonRetriableError
        ? stopReason(error.message)
        : error instanceof Error
          ? error.message.replace(/\.$/, '')
          : String(error)
    await recordStop(
      target,
      'stopped',
      `Shorts marking stopped: ${reason}. The Shorts stage will mark them again.`,
    )
    return { ok: true, candidates: [] }
  }
  // Outside the try: a failed notice write must not discard candidates
  // already paid for, nor be reported as the marking stopping.
  await recordRepairs(target, marked.repairs)
  return { ok: true, candidates: marked.candidates }
}

export const scriptRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Script drafting',
    retries: 4,
    /**
     * One live script run per project (decision 233). The trigger event is
     * also what a parked dossier gate resolves on, so a double-fired approve
     * used to start two of these; the second drafted a parallel script and
     * re-opened the gate the human had just closed. Skipped, never stacked.
     */
    singleton: { key: 'event.data.projectId', mode: 'cancel' },
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

    const mocked = mockProvidersEnabled()

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
            outline: await draftOutlineWith(completeForProject(projectId), {
              caseTitle: setup.caseTitle,
              dossierMd: setup.dossierMd,
              claims: setup.claims,
              targetRuntimeMin: setup.targetRuntimeMin,
            }),
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

    // The outline outlives this run on the script row: its tension fields are
    // what the Shorts marking and the teaser script select by, and both can
    // run days later (decision 224).
    await step.run('save-outline', () =>
      setScriptOutline(db, setup.scriptId, outline as unknown as Record<string, unknown>),
    )

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
              // At most two calls (decision 293): a chapter cut off at its
              // budget is asked once more at double it, and a second cut-off
              // stops the stage with the reason. The chapters already saved
              // are kept; half of this one never is.
              contentMd = await draftChapterWith(
                completeForProject(projectId, {
                  estimateOutputTokens: Math.round(chapter.targetWords * 1.6),
                }),
                {
                  caseTitle: setup.caseTitle,
                  outline,
                  chapterIndex: index,
                  previousTail,
                  claims: setup.claims,
                },
              )
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
          : await selfCheckWith(completeForProject(projectId), {
              chapterTitle: chapter.title,
              contentMd: chapter.contentMd,
              claims: setup.claims,
            })

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

    const marking = await step.run('mark-shorts', async (): Promise<MarkedShorts> => {
      if (mocked) {
        // A landed answer retires the strip's old notes, in mock mode too.
        await recordRepairs({ projectId, subject: 'script', subjectId: null })
        return { ok: true, candidates: mockShortsCandidates(written) }
      }
      return markShortsStep(projectId, { chapters: written, tension: tensionFromOutline(outline) })
    })

    // Read with the old shape too: a run parked at the script gate before
    // decision 293 replays the bare list this step used to return.
    const marked = readMarkedShorts(marking)
    if (!marked.ok) {
      await step.run('shorts-over-budget', () => markStageFailed(ctx, marked.gate))
      return { projectId, outcome: 'over-budget' as const, chaptersWritten: written.length }
    }
    const shorts = marked.candidates

    const summary = await step.run('finish-draft', async () => {
      await setShortsCandidates(db, setup.scriptId, shorts)
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

    const gateSummary =
      `Script ready · ${summary.chapters} chapters · ~${summary.runtimeMin} min · ` +
      `${summary.warnings} warnings · ${summary.shorts} Shorts candidates`

    /**
     * Exception-based gating (decision, 2026-08-16): the self-check is the
     * reviewer of record here. A warning means a sentence asserts something
     * the claim list does not support — exactly what a human read of the
     * draft is for — so any warning parks the gate. Zero warnings means every
     * sentence traced back to a verified claim, and the one remaining
     * question ("do I like these words?") is better answered at the voice
     * screen, where the text sits beside its audio and an edit re-reads only
     * the paragraph it touches.
     */
    if (summary.warnings === 0) {
      await step.run('auto-approve', async () => {
        await setScriptStatus(db, setup.scriptId, 'approved')
        await autoCloseReviewGate(ctx, {
          stage: 'script',
          nextStage: 'voice',
          summary: gateSummary,
        })
      })
      await step.sendEvent('advance-to-voice', events.scriptApproved.create({ projectId }))

      return { projectId, outcome: 'auto-approved' as const, ...summary }
    }

    await step.run('open-gate', () =>
      openReviewGate(ctx, {
        stage: 'script',
        projectStage: 'script',
        summary: gateSummary,
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
