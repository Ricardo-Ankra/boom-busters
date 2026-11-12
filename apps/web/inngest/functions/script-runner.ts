import {
  channelForProject,
  createScriptVersion,
  getDossier,
  getLatestScript,
  getProject,
  saveChapter,
  scriptableClaims,
  setScriptOutline,
  setShortsCandidates,
  setChapterWarnings,
  setProjectStage,
  setScriptStatus,
  shortsEnabledForProject,
} from '@boom-busters/db'
import {
  mockChapter,
  mockCraftCheck,
  mockOutline,
  mockSelfCheck,
  mockShortsCandidates,
  mockProvidersEnabled,
  sceneLines,
  tensionFromOutline,
} from '@boom-busters/providers'
import type { Repair, ScriptClaim } from '@boom-busters/providers'
import {
  countBySeverity,
  countWords,
  evidenceLabel,
  hedgeDensity,
  researchProfileOf,
  scriptLint,
  scriptTargetWords,
  withStandingSeverity,
  type GutterWarning,
  type NewNotice,
  type NoticeTarget,
  type Outline,
  type ScriptCraftFinding,
  type ShortsCandidate,
} from '@boom-busters/schemas'
import {
  BudgetExceededError,
  dropFixedParagraphs,
  estimateRuntimeSec,
  findRepeats,
  parseEventData,
  serialiseError,
  withFixedLines,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import type { AnswerRetry } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { recordRepairs, recordStop } from '@/lib/notices'
import { CRAFT_REVISION_FLOOR, settleCraft, type CraftPass } from '@/lib/script-craft-loop'
import {
  craftCheckWith,
  draftChapterWith,
  draftOutlineWith,
  markShortsWith,
  reviseChapterWith,
  selfCheckWith,
  SHORTS_UNMARKED,
} from '@/lib/script-answers'
import { inngest } from '../client'
import { events } from '../events'
import { requireCompleteBible } from '../lib/channel'
import {
  autoCloseReviewGate,
  budgetGateData,
  closeReviewGate,
  markStageFailed,
  openReviewGate,
  type GateContext,
} from '../lib/gates'
import { toScriptClaim } from '@/lib/script-claim'

/**
 * script-runner (build spec section 7.2).
 *
 * `gate/dossier.approved` → outline → chapters drafted **sequentially** → a
 * self-check pass per chapter writing gutter warnings →
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
 * Each drafted chapter then passes a craft check, one revision round against
 * its findings and a recheck before the next chapter is drafted (decision 464).
 * The loop runs only for a run whose `load-dossier` memo carries `craftLoop`.
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
  input: Omit<Parameters<typeof markShortsWith>[1], 'bible'>,
  /** The outline's repairs (decision 296), kept on the strip beside the marking's. */
  priorRepairs: readonly Repair[] = [],
  /** The craft loop's notices (decision 464), written after the repairs. */
  priorNotices: readonly NewNotice[] = [],
): Promise<MarkedShorts> {
  const target: NoticeTarget = { projectId, subject: 'script', subjectId: null }
  let marked: Awaited<ReturnType<typeof markShortsWith>>
  try {
    // The bible is read here, inside the step, as every request-building step does.
    const channel = await channelForProject(db, projectId)
    marked = await markShortsWith(completeForProject(projectId), {
      ...input,
      // A Short is never cut from the format's fixed lines.
      chapters: input.chapters.map((chapter) => ({
        ...chapter,
        contentMd: dropFixedParagraphs(chapter.contentMd, channel.format),
      })),
      bible: requireCompleteBible(channel),
    })
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
    console.error('[script-runner] Shorts marking failed', serialiseError(error))
    const reason =
      error instanceof NonRetriableError
        ? stopReason(error.message)
        : error instanceof Error
          ? error.message.replace(/\.$/, '')
          : String(error)
    // The outline's repairs still reach the strip; the stop is added beside them.
    if (priorRepairs.length > 0 || priorNotices.length > 0) {
      await writeStrip(target, priorRepairs, priorNotices)
    }
    await recordStop(
      target,
      'stopped',
      `Shorts marking stopped: ${reason}. The Shorts stage will mark them again.`,
    )
    return { ok: true, candidates: [] }
  }
  // Outside the try: a failed notice write must not discard candidates
  // already paid for, nor be reported as the marking stopping.
  await writeStrip(target, [...priorRepairs, ...marked.repairs], priorNotices)
  return { ok: true, candidates: marked.candidates }
}

/** The strip's write: the craft notices ride as `extra` only when there are any. */
function writeStrip(
  target: NoticeTarget,
  repairs: readonly Repair[],
  notices: readonly NewNotice[],
): Promise<void> {
  // The third argument is passed only with notices: a run with none calls recordRepairs exactly as before.
  return notices.length > 0
    ? recordRepairs(target, repairs, notices)
    : recordRepairs(target, repairs)
}

/** The dossier's scenes, read inside the step that builds the request. */
async function scenesFor(projectId: string): Promise<string[]> {
  const dossier = await getDossier(db, projectId)
  return dossier ? sceneLines({ research: dossier.research, contentMd: dossier.contentMd }) : []
}

type CraftStepResult =
  | { ok: true; findings: ScriptCraftFinding[]; stopped?: string; retry?: AnswerRetry }
  | { ok: false; gate: Record<string, unknown> }

/**
 * One craft check, on the chapter without the format's fixed lines. Its two
 * calls never share a step (decision 461): the first step hands back the
 * retry a bad answer earned (`firstOnly`), and a step of its own makes it
 * (`resume`), so a slow route cannot pass the function's ceiling.
 */
async function craftCheckStep(
  projectId: string,
  mocked: boolean,
  input: {
    outline: Outline
    chapterIndex: number
    claimCount: number
    previousChapters: { title: string; contentMd: string }[]
    contentMd: string
  },
  second: { firstOnly: true } | { resume: AnswerRetry },
): Promise<CraftStepResult> {
  const channel = await channelForProject(db, projectId)
  const frozen = requireCompleteBible(channel)
  const contentMd = dropFixedParagraphs(input.contentMd, channel.format)
  if (mocked) return { ok: true, findings: mockCraftCheck(contentMd).findings }
  try {
    const answer = await craftCheckWith(
      completeForProject(projectId),
      {
        bible: frozen,
        outline: input.outline,
        chapterIndex: input.chapterIndex,
        claimCount: input.claimCount,
        previousChapters: input.previousChapters,
        contentMd,
        intent: channel.format.intent,
      },
      second,
    )
    if (answer.ok) return { ok: true, findings: answer.value.findings }
    // A retry is still due: no `stopped`, so the caller makes it in its own step.
    if (answer.retry) return { ok: true, findings: [], retry: answer.retry }
    return { ok: true, findings: [], stopped: answer.issue }
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
    throw error
  }
}

/**
 * One chapter's text with the format's fixed lines, as the whole script would
 * hold them: the opening line on chapter 0, the closing line on the last.
 */
function placeFixedLines(
  contentMd: string,
  index: number,
  chapterCount: number,
  format: Parameters<typeof withFixedLines>[1],
): string {
  const slots = Array.from({ length: chapterCount }, (_, at) => (at === index ? contentMd : ''))
  return withFixedLines(slots, format)[index] ?? contentMd
}

/** A calm telling's outline with every tension field blank: nothing planted, held back or left open. */
function withoutTension(outline: Outline): Outline {
  return {
    ...outline,
    chapters: outline.chapters.map((chapter) => ({
      ...chapter,
      question: '',
      withhold: '',
      reveals: '',
    })),
    ...(outline.close ? { close: { ...outline.close, openThread: '' } } : {}),
  }
}

/** The code's own style and length checks for one chapter, as the warnings the gutter stores. */
function lintOf(
  written: Parameters<typeof scriptLint>[0],
  outline: Parameters<typeof scriptLint>[1],
  targetWords: number,
  chapterIndex: number,
) {
  return scriptLint(written, outline, targetWords)
    .filter((found) => found.chapterIndex === chapterIndex)
    .map((found) => found.warning)
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

      // The channel's research profile decides how a claim's evidence standing
      // is worded; a bible stored before profiles reads as the investigation.
      const profile = researchProfileOf(
        requireCompleteBible(await channelForProject(db, projectId)).bible,
      )

      await setProjectStage(db, projectId, { stage: 'script', stageStatus: 'running' })
      const script = await createScriptVersion(db, projectId)

      return {
        scriptId: script.id,
        caseTitle: project.title,
        targetRuntimeMin: project.targetRuntimeMin,
        dossierMd: dossier.contentMd,
        // The craft loop runs only for a run that loaded after this deploy (decision 464).
        craftLoop: true,
        claims: usable.map((claim) => ({
          ...toScriptClaim(claim),
          standing: evidenceLabel(profile, claim.evidenceStatus, 'script') ?? undefined,
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
        | { ok: true; outline: Outline; repairs?: Repair[] }
        | { ok: false; gate: Record<string, unknown> }
      > => {
        // Read here, in the step that builds the request, never from an
        // earlier step's memoised output: a run parked before the bible
        // existed replays those without it. The gate sits before the mock branch.
        const channel = await channelForProject(db, projectId)
        const frozen = requireCompleteBible(channel)
        if (mocked) return { ok: true, outline: mockOutline(setup.targetRuntimeMin), repairs: [] }
        // The brief is read here too: a run parked before it existed replays no brief.
        const searchBrief = (await getProject(db, projectId))?.searchBrief ?? null
        try {
          const drafted = await draftOutlineWith(completeForProject(projectId), {
            bible: frozen,
            caseTitle: setup.caseTitle,
            dossierMd: setup.dossierMd,
            claims: setup.claims,
            targetRuntimeMin: setup.targetRuntimeMin,
            searchBrief,
            wordsPerMinute: channel.format.wordsPerMinute,
            introRule: channel.format.introRule,
            intent: channel.format.intent,
            introLine: channel.format.introLine,
            outroLine: channel.format.outroLine,
          })
          // After parsing, in the step: a model that fills the tension fields of a
          // calm telling anyway must not leak them into the direction, Shorts or teaser prompts.
          return {
            ok: true,
            ...drafted,
            outline:
              channel.format.intent === 'calm' ? withoutTension(drafted.outline) : drafted.outline,
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
    // A run parked before decision 296 replays this step without repairs.
    const outlineRepairs = outlineStep.repairs ?? []

    // The outline outlives this run on the script row: its tension fields are
    // what the Shorts marking and the teaser script select by, and both can
    // run days later (decision 224).
    await step.run('save-outline', () =>
      setScriptOutline(db, setup.scriptId, outline as unknown as Record<string, unknown>),
    )

    // -----------------------------------------------------------------------
    // Chapters, in order, each seamed onto the last
    // -----------------------------------------------------------------------

    const written: {
      index: number
      title: string
      contentMd: string
      chapterId: string
      craft: GutterWarning[]
    }[] = []
    /** The craft loop's notice lines, written to the strip by mark-shorts. */
    const craftNotices: NewNotice[] = []

    for (const [index, chapter] of outline.chapters.entries()) {
      const drafted = await step.run(
        `draft-chapter-${index}`,
        async (): Promise<
          | { ok: true; chapterId: string; contentMd: string }
          | { ok: false; gate: Record<string, unknown> }
        > => {
          const channel = await channelForProject(db, projectId)
          const frozen = requireCompleteBible(channel)
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
                  bible: frozen,
                  caseTitle: setup.caseTitle,
                  outline,
                  chapterIndex: index,
                  previousChapters: written.map(({ title, contentMd }) => ({ title, contentMd })),
                  claims: setup.claims,
                  intent: channel.format.intent,
                  scenes: await scenesFor(projectId),
                },
              )
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                return { ok: false, gate: budgetGateData(error) }
              }
              throw error
            }
          }

          // The format's fixed lines are placed here, in the step that stores the
          // chapter, so a run parked before the format had any replays without them.
          contentMd = placeFixedLines(contentMd, index, outline.chapters.length, channel.format)

          const row = await saveChapter(db, {
            scriptId: setup.scriptId,
            index,
            title: chapter.title,
            contentMd,
            estRuntimeSec: estimateRuntimeSec(contentMd, channel.format.wordsPerMinute),
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

      let contentMd = drafted.contentMd
      let craft: GutterWarning[] = []

      // Only a run whose `load-dossier` memo says so: a memo from before this
      // deploy has no field, and an unmemoised step id would be executed, so
      // such a run must make no craft step call at all (decision 464).
      if (setup.craftLoop === true) {
        const previousChapters = written.map(({ title, contentMd }) => ({ title, contentMd }))
        // A check and its retry, each in a step of its own with a fresh deadline.
        const craftPass = async (name: string, text: string): Promise<CraftStepResult> => {
          const request = {
            outline,
            chapterIndex: index,
            claimCount: setup.claims.length,
            previousChapters,
            contentMd: text,
          }
          const firstCall: CraftStepResult = await step.run(name, () =>
            craftCheckStep(projectId, mocked, request, { firstOnly: true }),
          )
          if (!firstCall.ok || firstCall.retry === undefined) return firstCall
          const due = firstCall.retry
          return step.run(`${name}-retry`, () =>
            craftCheckStep(projectId, mocked, request, { resume: due }),
          )
        }
        const check = await craftPass(`craft-check-${index}`, drafted.contentMd)
        if (!check.ok) {
          await step.run(`craft-${index}-over-budget`, () => markStageFailed(ctx, check.gate))
          return { projectId, outcome: 'over-budget' as const, chaptersWritten: written.length }
        }
        const first: CraftPass = {
          findings: check.findings,
          ...(check.stopped !== undefined ? { stopped: check.stopped } : {}),
        }

        let revisedMd: string | null = null
        let reviseStopped: string | undefined
        let recheck: CraftPass | null = null
        if (first.stopped === undefined && first.findings.length > 0) {
          const revision = await step.run(
            `craft-revise-${index}`,
            async (): Promise<
              | { ok: true; contentMd?: string; stopped?: string }
              | { ok: false; gate: Record<string, unknown> }
            > => {
              const channel = await channelForProject(db, projectId)
              const frozen = requireCompleteBible(channel)
              const draft = dropFixedParagraphs(drafted.contentMd, channel.format)
              try {
                const answer = await reviseChapterWith(
                  completeForProject(projectId, {
                    estimateOutputTokens: Math.round(chapter.targetWords * 1.6),
                  }),
                  {
                    bible: frozen,
                    caseTitle: setup.caseTitle,
                    outline,
                    chapterIndex: index,
                    previousChapters,
                    claims: setup.claims,
                    intent: channel.format.intent,
                    scenes: await scenesFor(projectId),
                    draft,
                    findings: first.findings,
                  },
                )
                if (!answer.ok) return { ok: true, stopped: answer.issue }
                // Each fixed line appears once: a revision that echoes one is
                // stripped of it first, then the lines are placed as the draft's were.
                const revised = dropFixedParagraphs(answer.value, channel.format)
                // A preamble, a list of changes or a fragment must never be voiced:
                // a revision far shorter than the draft is refused and the draft kept.
                if (countWords(revised) < countWords(draft) * CRAFT_REVISION_FLOOR) {
                  return { ok: true, stopped: 'the revision came back much shorter than the draft' }
                }
                const stored = placeFixedLines(
                  revised,
                  index,
                  outline.chapters.length,
                  channel.format,
                )
                await saveChapter(db, {
                  scriptId: setup.scriptId,
                  index,
                  title: chapter.title,
                  contentMd: stored,
                  estRuntimeSec: estimateRuntimeSec(stored, channel.format.wordsPerMinute),
                })
                return { ok: true, contentMd: stored }
              } catch (error) {
                if (error instanceof BudgetExceededError) {
                  return { ok: false, gate: budgetGateData(error) }
                }
                throw error
              }
            },
          )
          if (!revision.ok) {
            await step.run(`craft-${index}-over-budget`, () => markStageFailed(ctx, revision.gate))
            return { projectId, outcome: 'over-budget' as const, chaptersWritten: written.length }
          }
          if (revision.contentMd !== undefined) {
            revisedMd = revision.contentMd
            const landed = revisedMd
            const again = await craftPass(`craft-recheck-${index}`, landed)
            if (!again.ok) {
              await step.run(`craft-${index}-over-budget`, () => markStageFailed(ctx, again.gate))
              return { projectId, outcome: 'over-budget' as const, chaptersWritten: written.length }
            }
            recheck = {
              findings: again.findings,
              ...(again.stopped !== undefined ? { stopped: again.stopped } : {}),
            }
          } else {
            reviseStopped = revision.stopped ?? 'no revision came back'
          }
        }

        // Deterministic over the memoised results, so outside any step. The
        // fixed lines stay in both texts: a finding's sentence is the model's
        // own wording from text that never carried them.
        const settled = settleCraft({
          chapterNumber: index + 1,
          draftMd: drafted.contentMd,
          first,
          revisedMd,
          ...(reviseStopped !== undefined ? { reviseStopped } : {}),
          recheck,
        })
        craft = settled.warnings
        craftNotices.push(...settled.notices)
        if (revisedMd !== null) contentMd = revisedMd
      }

      written.push({
        index,
        title: chapter.title,
        contentMd,
        chapterId: drafted.chapterId,
        craft,
      })
    }

    // -----------------------------------------------------------------------
    // Self-check, per chapter
    // -----------------------------------------------------------------------

    // The whole-script repetition check (decision 296): deterministic, so it
    // is computed from the replayed chapters rather than inside a step, and
    // stored with each chapter's self-check warnings so a repeat parks the
    // gate like any other warning.
    const repeats = findRepeats(written)

    for (const chapter of written) {
      await step.run(`self-check-${chapter.index}`, async () => {
        const channel = await channelForProject(db, projectId)
        const frozen = requireCompleteBible(channel)
        // The fixed lines are the owner's words, not claims: the check never sees them.
        const checked = dropFixedParagraphs(chapter.contentMd, channel.format)
        // Read inside the step, so a run parked before this deploy replays safely.
        const scenes = await scenesFor(projectId)
        const check = mocked
          ? mockSelfCheck(checked)
          : await selfCheckWith(completeForProject(projectId), {
              bible: frozen,
              chapterTitle: chapter.title,
              contentMd: checked,
              claims: setup.claims,
              intent: channel.format.intent,
              scenes,
            })

        const own = repeats
          .filter((repeat) => repeat.chapterIndex === chapter.index)
          .map((repeat) => repeat.warning)
        // The channel's research profile decides how blocking an overstated standing is.
        const modelWarnings = withStandingSeverity(researchProfileOf(frozen.bible), check.warnings)
        // The fixed lines are the owner's words too: the code checks never see them,
        // so a question or a number in the intro never warns and the word counts hold only drafted text.
        const coded = lintOf(
          written.map((c) => ({
            ...c,
            contentMd: dropFixedParagraphs(c.contentMd, channel.format),
          })),
          outline,
          scriptTargetWords(setup.targetRuntimeMin, channel.format),
          chapter.index,
        )
        const all = [...modelWarnings, ...own, ...(chapter.craft ?? []), ...coded]
        await setChapterWarnings(db, chapter.chapterId, all)

        return { warnings: all.length }
      })
    }

    // -----------------------------------------------------------------------
    // Shorts candidates
    // -----------------------------------------------------------------------

    const marking = await step.run('mark-shorts', async (): Promise<MarkedShorts> => {
      // A format with Shorts off pays for no marking, mock or live (ruling 18).
      // The outline's repairs and the craft notices still reach the strip (decision 464).
      const target: NoticeTarget = { projectId, subject: 'script', subjectId: null }
      if (!(await shortsEnabledForProject(db, projectId))) {
        await writeStrip(target, outlineRepairs, craftNotices)
        return { ok: true, candidates: [] }
      }
      if (mocked) {
        // A landed answer retires the strip's old notes, in mock mode too.
        await writeStrip(target, [], craftNotices)
        return { ok: true, candidates: mockShortsCandidates(written) }
      }
      return markShortsStep(
        projectId,
        { chapters: written, tension: tensionFromOutline(outline) },
        outlineRepairs,
        craftNotices,
      )
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
      const { blocking, advisory } = countBySeverity(latest?.chapters ?? [])

      return {
        chapters: written.length,
        warnings: blocking + advisory,
        blocking,
        advisory,
        hedges: hedgeDensity(latest?.chapters ?? []),
        runtimeMin: Math.round(
          (latest?.chapters.reduce((total, c) => total + c.estRuntimeSec, 0) ?? 0) / 60,
        ),
        shorts: shorts.length,
        // Read here, inside the step; a result stored before the switch has none.
        shortsOff: !(await shortsEnabledForProject(db, projectId)),
      }
    })

    // A summary stored before decision 458 has only `warnings`, all read as blocking.
    const blocking = summary.blocking ?? summary.warnings
    const advisory = summary.advisory ?? 0
    const hedges = summary.hedges ?? 0
    const gateSummary =
      `Script ready · ${summary.chapters} chapters · ~${summary.runtimeMin} min · ` +
      `${blocking} blocking · ${advisory} advisory · hedges ${hedges}/100w · ` +
      (summary.shortsOff ? 'Shorts off for this format' : `${summary.shorts} Shorts candidates`)

    // Blocking warnings are the reviewer's yes-or-no findings: grounding, liability,
    // standing per research profile and repeats. Advisory ones are craft, style and length.
    // Zero blocking goes on to voice without a human, whatever the advisory count (decision 458).
    if (blocking === 0) {
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
