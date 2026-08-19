import {
  approveCurrentTakes,
  claimTake,
  mockVoiceTakeKey,
  getProject,
  getSettings,
  latestScriptParagraphSources,
  listVoiceTakes,
  setProjectStage,
  storeTakeAudio,
} from '@boom-busters/db'
import {
  BudgetExceededError,
  parseEventData,
  serialiseError,
  voiceCoverage,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { putObject, takeStorage, voiceTakeKey } from '@/lib/storage'
import { requireTtsKey, synthesise } from '@/lib/tts'
import { voiceKeyFacts } from '@/lib/voice-identity'
import { inngest } from '../client'
import { events } from '../events'
import {
  budgetGateData,
  closeReviewGate,
  markStageFailed,
  openReviewGate,
  type GateContext,
} from '../lib/gates'
import {
  chunk,
  narrationJobs,
  recordLoudnessDeferred,
  TTS_CONCURRENCY,
  withinFailureTolerance,
} from '../lib/narration'

/**
 * voice-runner (build spec section 7.3).
 *
 * `gate/script.approved` → fan-out TTS per paragraph → gate.
 *
 * Fanned out rather than sequential, which is the opposite of the script
 * runner and for the opposite reason: chapters are drafted in order because
 * each one is written from the tail of the last, whereas a paragraph read aloud
 * depends on nothing but its own words. Sixty independent calls is the one
 * place in this pipeline where parallelism is free.
 *
 * Two rules make the fan-out safe to re-run:
 *
 *  - **Every paragraph is its own step**, with a deterministic id, so a failure
 *    in paragraph forty does not re-buy paragraphs one to thirty-nine.
 *  - **Every synthesis is claimed before it is bought.** A take already holding
 *    audio for the same `(project, chapter, paragraph, text, voice)` is handed
 *    back rather than re-synthesised, so re-running the stage over an unchanged
 *    script costs nothing (spec principle 5).
 *
 * The gate is not merely a wait. Section 7.3: "the main run's gate wait is only
 * satisfied when the UI approve action verifies zero flagged takes
 * server-side" — that verification lives in the approve action, and the retake
 * loop runs as its own function while this one stays parked.
 */

const FUNCTION_ID = 'voice-runner'

export const voiceRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Voice synthesis',
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
    triggers: [events.scriptApproved],
  },
  async ({ event, step, runId }) => {
    const { projectId } = parseEventData('gate/script.approved', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    /**
     * Everything that can be wrong before a single character is paid for.
     *
     * Narration is the first stage that fans out over dozens of paid calls in
     * seconds, so "fail at pre-flight, never mid-pipeline" (spec section 6)
     * stops being a nicety here: discovering on paragraph forty that no voice
     * was ever chosen means thirty-nine paragraphs bought for a chapter that
     * cannot be finished.
     */
    const setup = await step.run('load-script', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      const settings = await getSettings(db)
      const { provider, voiceId } = settings.tts

      if (voiceId.trim() === '') {
        throw new NonRetriableError(
          'No narration voice has been chosen. Pick one in Settings → Voice audition, then run ' +
            'the voice stage again.',
        )
      }

      // Throws a `ValidationError` naming Settings → Connections.
      await requireTtsKey(provider)

      /**
       * A key to buy with is only half of it: there has to be somewhere to put
       * what was bought. A missing bucket will not fix itself between retries,
       * and each retry of this stage is another sixty paid calls, so this is
       * the one place it can be raised — before the first one.
       */
      try {
        takeStorage()
      } catch (error) {
        throw new NonRetriableError(
          error instanceof Error ? error.message : 'Narration has nowhere to be stored.',
        )
      }

      const sources = await latestScriptParagraphSources(db, projectId)
      if (sources.chapters.length === 0) {
        throw new NonRetriableError(
          'There is no script to read. Approve a script before running the voice stage.',
        )
      }

      // Everything settings contribute to a take's identity, from the one
      // helper all four key-computing call sites share: voice, pronunciations
      // and stability.
      const jobs = narrationJobs({
        projectId,
        chapters: sources.chapters,
        ...voiceKeyFacts(settings.tts),
      })
      if (jobs.length === 0) {
        throw new NonRetriableError('The script has no paragraphs to narrate.')
      }

      await setProjectStage(db, projectId, { stage: 'voice', stageStatus: 'running' })

      return { jobs, provider, voiceId, scriptVersion: sources.scriptVersion }
    })

    // -----------------------------------------------------------------------
    // Synthesis, in bounded parallel
    // -----------------------------------------------------------------------

    type ParagraphOutcome =
      | { ok: true; reused: boolean }
      | { ok: false; gate: Record<string, unknown> }
      | { ok: false; error: string }

    const outcomes: ParagraphOutcome[] = []

    for (const batch of chunk(setup.jobs, TTS_CONCURRENCY)) {
      const results = await Promise.all(
        batch.map((job) =>
          step.run(`tts-${job.chapterId}-${job.unitIndex}`, async (): Promise<ParagraphOutcome> => {
            const claimed = await claimTake(db, {
              projectId,
              chapterId: job.chapterId,
              paragraphIndex: job.unitIndex,
              idempotencyKey: job.idempotencyKey,
              provider: setup.provider,
              voiceId: setup.voiceId,
              builtFromScriptVersion: setup.scriptVersion,
            })

            // Already bought, at this text, in this voice. Nothing to do.
            if (claimed.kind === 'existing') return { ok: true, reused: true }

            try {
              const narration = await synthesise({
                text: job.text,
                // The synthesis's own identity, not the paragraph's: a retake
                // is a different purchase of the same paragraph.
                idempotencyKey: `${job.idempotencyKey}#${claimed.take.takeNumber}`,
                projectId,
              })

              const key =
                takeStorage() === 'r2'
                  ? (
                      await putObject(
                        voiceTakeKey({
                          projectId,
                          chapterId: job.chapterId,
                          paragraphIndex: job.unitIndex,
                          takeId: claimed.take.id,
                        }),
                        narration.wav,
                        'audio/wav',
                      )
                    ).key
                  : // The mock made these bytes, so the audio route re-derives
                    // them rather than storing them. See `MOCK_KEY_PREFIX` —
                    // and `takeStorage` for why this is not a fallback for a
                    // missing bucket.
                    mockVoiceTakeKey(claimed.take.id)

              await storeTakeAudio(db, claimed.take.id, {
                r2Key: key,
                durationMs: narration.durationMs,
                costUsd: narration.costUsd,
                waveform: narration.waveform,
                timings: narration.wordTimings ?? null,
              })

              return { ok: true, reused: false }
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                return { ok: false, gate: budgetGateData(error) }
              }
              /**
               * Swallowed on purpose, and only here. The fan-out policy needs
               * per-item outcomes to count against the 15% tolerance, and a
               * thrown step would take the whole batch down with it — including
               * paragraphs that succeeded and were paid for. The take stays
               * `pending`, which is what the coverage bar and the gate blocker
               * read.
               */
              return { ok: false, error: String(serialiseError(error).message ?? 'unknown') }
            }
          }),
        ),
      )

      outcomes.push(...results)

      // A cap hit part-way through is not a per-item failure — every remaining
      // paragraph would hit it too. Park immediately rather than burning
      // through the rest to prove it.
      const overBudget = results.find((result) => !result.ok && 'gate' in result)
      if (overBudget && !overBudget.ok && 'gate' in overBudget) {
        await step.run('tts-over-budget', () => markStageFailed(ctx, overBudget.gate))
        return { projectId, outcome: 'over-budget' as const, synthesised: outcomes.length }
      }
    }

    const failed = outcomes.filter((outcome) => !outcome.ok).length

    if (!withinFailureTolerance(failed, outcomes.length)) {
      await step.run('tts-failed', () =>
        markStageFailed(ctx, {
          message:
            `${failed} of ${outcomes.length} paragraphs could not be synthesised, which is over ` +
            'the 15% tolerance. Nothing that succeeded was discarded — fix the cause and re-run ' +
            'the voice stage; the paragraphs already bought will not be bought again.',
          failed,
          total: outcomes.length,
        }),
      )
      return { projectId, outcome: 'failed' as const, failed, total: outcomes.length }
    }

    // -----------------------------------------------------------------------
    // Loudness — see `recordLoudnessDeferred`
    // -----------------------------------------------------------------------

    await step.run('loudness-normalise', async () => {
      await recordLoudnessDeferred(ctx, outcomes.length)
      return { deferred: true }
    })

    // -----------------------------------------------------------------------
    // Gate
    // -----------------------------------------------------------------------

    const summary = await step.run('finish-narration', async () => {
      const takes = await listVoiceTakes(db, projectId)
      const coverage = voiceCoverage(takes)
      const durationSec = Math.round(
        takes.reduce((total, take) => total + (take.durationMs ?? 0), 0) / 1000,
      )

      return {
        ...coverage,
        reused: outcomes.filter((outcome) => outcome.ok && outcome.reused).length,
        failed,
        // Only the current takes count toward runtime, and only roughly: this
        // is the number on the gate card, not the timeline.
        runtimeMin: Math.round(durationSec / 60),
      }
    })

    await step.run('open-gate', () =>
      openReviewGate(ctx, {
        stage: 'voice',
        projectStage: 'voice',
        summary:
          `Narration ready · ${summary.paragraphs} paragraphs · ~${summary.runtimeMin} min` +
          (summary.reused > 0 ? ` · ${summary.reused} reused` : '') +
          (summary.failed > 0 ? ` · ${summary.failed} failed, flagged for you` : ''),
      }),
    )

    const approval = await step.waitForEvent('await-voice-gate', {
      event: 'gate/voice.approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!approval) {
      await step.run('gate-timed-out', () =>
        markStageFailed(ctx, { message: 'The voice gate went 30 days without a decision.' }),
      )
      return { projectId, outcome: 'gate-timeout' as const }
    }

    await step.run('close-gate', async () => {
      // Approving is a statement about the audio that will be assembled, so the
      // takes that will be assembled are the ones stamped.
      await approveCurrentTakes(db, projectId)
      await closeReviewGate(ctx, { stage: 'voice', nextStage: 'visuals' })
    })

    return { projectId, outcome: 'approved' as const, ...summary }
  },
)
