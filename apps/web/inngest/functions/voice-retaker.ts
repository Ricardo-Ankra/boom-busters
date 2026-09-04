import {
  claimTake,
  mockVoiceTakeKey,
  getSettings,
  getVoiceTake,
  latestScriptParagraphSources,
  setTakeStatus,
  storeTakeAudio,
} from '@boom-busters/db'
import {
  BudgetExceededError,
  parseEventData,
  serialiseError,
  takeIdempotencyKey,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { putObject, takeStorage, voiceTakeKey } from '@/lib/storage'
import { takeUnit } from '@/lib/take-unit'
import { synthesise } from '@/lib/tts'
import { voiceKeyFacts } from '@/lib/voice-identity'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markRetakeFailed, markStageFailed, type GateContext } from '../lib/gates'

/**
 * voice-retaker (build spec section 7.3).
 *
 * "Retake loop: UI flag emits `voice/retake.requested {takeId, note}` handled by
 * a small dedicated function; the main run's gate wait is only satisfied when
 * the UI approve action verifies zero flagged takes server-side."
 *
 * A separate function rather than a second `waitForEvent` in the runner, for
 * the reason `dossier-reviser` is separate (decision 27): racing two waits
 * leaves the loser of every round outstanding in the run plan, and there may be
 * a dozen retakes across a listen-through. The main run stays parked on the
 * gate throughout and never learns that any of this happened — it only ever
 * sees the approval, which the action refuses to send while anything is
 * flagged.
 *
 * The flagged take is kept. Its replacement gets the next take number, the
 * review row A/Bs between them, and a retake you like less than the original
 * has a way back.
 */

const FUNCTION_ID = 'voice-retaker'

export const voiceRetaker = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Voice retake',
    retries: 4,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      const takeId = event.data.event.data['takeId']
      if (typeof projectId !== 'string') return
      // Not markStageFailed: the runner is parked at the open gate the whole
      // time, so a failed retake flags its row instead of tearing the review
      // room down (decision 219).
      await markRetakeFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        typeof takeId === 'string' ? takeId : undefined,
        serialiseError(event.data.error),
      )
    },
    triggers: [events.voiceRetakeRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, takeId, note } = parseEventData('voice/retake.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const retake = await step.run('synthesise-retake', async () => {
      const take = await getVoiceTake(db, takeId)
      if (!take) throw new NonRetriableError(`Voice take ${takeId} no longer exists`)

      // Re-derived from the current script and provider, exactly as the
      // runner would — the unit's text is what the fingerprint hashes.
      const unit = await takeUnit(db, take)
      if (!unit) {
        throw new NonRetriableError(
          'The section this take was read from is gone — the chapter has been edited since. ' +
            'Re-run the voice stage to narrate the script as it stands.',
        )
      }
      const text = unit.text

      const settings = await getSettings(db)

      // Before the claim, so a retake with nowhere to go does not burn a take
      // number. See `takeStorage`.
      try {
        takeStorage()
      } catch (error) {
        throw new NonRetriableError(
          error instanceof Error ? error.message : 'Narration has nowhere to be stored.',
        )
      }

      const { scriptVersion } = await latestScriptParagraphSources(db, projectId)

      /**
       * The key is computed from the text *as it stands now*, not copied off
       * the take being replaced.
       *
       * Those are the same string for a plain retake and different ones after a
       * re-read, and the difference matters: copying the old key would file
       * audio of the new words under a hash of the old ones, and the next stage
       * re-run would compute the real key, find nothing, and buy the paragraph
       * again. `claimTake` recognises a paragraph by its current take's key, so
       * getting this right is what makes a re-read free to re-run over.
       */
      const idempotencyKey = takeIdempotencyKey({
        projectId,
        chapterId: take.chapterId,
        paragraphIndex: take.paragraphIndex,
        text,
        ...voiceKeyFacts(settings.tts),
      })

      const claimed = await claimTake(db, {
        projectId,
        chapterId: take.chapterId,
        paragraphIndex: take.paragraphIndex,
        idempotencyKey,
        provider: settings.tts.provider,
        voiceId: settings.tts.voiceId,
        builtFromScriptVersion: scriptVersion,
        // Named on purpose: an unchanged key would otherwise be handed back its
        // own audio, and a deliberate second attempt is the one case where
        // buying the same input again is the point.
        ...(idempotencyKey === take.idempotencyKey ? { takeNumber: take.takeNumber + 1 } : {}),
        note,
      })

      if (claimed.kind === 'existing') {
        // This retake has already been made — a replayed event, or a step
        // retried after the audio landed. Nothing to buy.
        return { takeNumber: claimed.take.takeNumber, reused: true }
      }

      try {
        const narration = await synthesise({
          text,
          idempotencyKey: `${idempotencyKey}#${claimed.take.takeNumber}`,
          projectId,
        })

        const key =
          takeStorage() === 'r2'
            ? (
                await putObject(
                  voiceTakeKey({
                    projectId,
                    chapterId: take.chapterId,
                    paragraphIndex: take.paragraphIndex,
                    takeId: claimed.take.id,
                  }),
                  narration.wav,
                  'audio/wav',
                )
              ).key
            : mockVoiceTakeKey(claimed.take.id)

        await storeTakeAudio(db, claimed.take.id, {
          r2Key: key,
          durationMs: narration.durationMs,
          costUsd: narration.costUsd,
          timings: narration.wordTimings ?? null,
          waveform: narration.waveform,
        })

        /**
         * The take that was flagged stays flagged in its own right — it is
         * still the take that was wrong — but it is no longer the current one,
         * so `latestTakes` stops counting it and the gate unblocks. Nothing
         * about the flag is rewritten, because the note on it is the record of
         * why this retake exists.
         */
        return { takeNumber: claimed.take.takeNumber, reused: false }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { overBudget: budgetGateData(error) }
        }
        // The claimed row would otherwise sit `pending` forever and block the
        // gate with no way for a human to clear it.
        await setTakeStatus(db, claimed.take.id, 'flagged')
        throw error
      }
    })

    if ('overBudget' in retake && retake.overBudget) {
      await step.run('retake-over-budget', () => markStageFailed(ctx, retake.overBudget))
      return { projectId, takeId, outcome: 'over-budget' as const }
    }

    return { projectId, takeId, outcome: 'retaken' as const, ...retake }
  },
)
