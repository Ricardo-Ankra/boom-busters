import { recordRunEvent } from '@boom-busters/db'
import { narrationUnits } from '@boom-busters/providers'
import type { NarrationUnit } from '@boom-busters/providers'
import { takeIdempotencyKey } from '@boom-busters/schemas'
import type { PhonemeHint, StabilityTier } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { storageConfigured } from '@/lib/storage'
import { resolveRunRowId } from '../middleware/run-mirror'
import type { GateContext } from './gates'

/**
 * The parts of narration that the runner and the retaker both need, and that
 * are worth testing without an Inngest harness around them.
 */

export interface NarrationJob extends NarrationUnit {
  idempotencyKey: string
}

/**
 * Every narration unit of a script, in the order it will be spoken.
 *
 * The unit is the paragraph (spec section 7). Takes, retakes, alignment merge
 * and Shorts segment refs address `(chapterId, unitIndex)` — stored in the
 * `paragraph_index` column — and the indexes are stable across re-runs
 * because they come from one deterministic `narrationUnits` over the approved
 * `contentMd` and nothing else.
 */
export function narrationJobs(input: {
  projectId: string
  voiceId: string
  chapters: readonly { id: string; title: string; contentMd: string }[]
  /**
   * The channel's pronunciation list. Part of a take's identity, so correcting
   * how a name is said re-reads the units that say it — and only those.
   */
  pronunciations?: readonly PhonemeHint[]
  /** `settings.tts.stability`. Part of the identity too — a delivery change re-reads. */
  stability?: StabilityTier
}): NarrationJob[] {
  return narrationUnits({ chapters: input.chapters }).map((unit) => ({
    ...unit,
    idempotencyKey: takeIdempotencyKey({
      projectId: input.projectId,
      chapterId: unit.chapterId,
      paragraphIndex: unit.unitIndex,
      text: unit.text,
      voiceId: input.voiceId,
      ...(input.pronunciations ? { pronunciations: input.pronunciations } : {}),
      ...(input.stability === undefined ? {} : { stability: input.stability }),
    }),
  }))
}

/**
 * The fan-out partial-failure policy (spec section 7): up to 15% of items may
 * fail and still succeed the step, with the failures marked for a human at the
 * next gate. Above that the step fails, because a script missing a fifth of its
 * narration is not something to review — it is something that went wrong.
 */
export const FAILURE_TOLERANCE = 0.15

export function withinFailureTolerance(failed: number, total: number): boolean {
  return total > 0 && failed / total <= FAILURE_TOLERANCE
}

/**
 * How many paragraphs are synthesised at once.
 *
 * Inngest will happily run a `Promise.all` of sixty steps, and sixty concurrent
 * requests to one TTS endpoint is how a rate limit is discovered. Chunking
 * keeps the fan-out real without turning every run into a retry storm — and the
 * step ids stay deterministic either way, which is what makes the memoisation
 * work (spec section 7).
 */
export const TTS_CONCURRENCY = 5

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/**
 * Loudness normalisation, which M4 cannot do.
 *
 * Spec section 7.3 has the voice runner "loudness-normalise each chunk in
 * media-utils (-16 LUFS mono reference)". media-utils is an FFmpeg Lambda
 * deployed by CDK in M6; this is M4. Rather than pretend, the step records what
 * it did not do, so the gap shows up in the activity drawer of every voice run
 * instead of living only in a document.
 *
 * When the broker exists this becomes the call, and nothing else about the
 * stage changes: takes are stored as WAV precisely because that is what FFmpeg
 * and Whisper want as input.
 *
 * Takes a `GateContext` rather than a run id, because `run_events.run_id` is
 * the *mirror row's* id and not Inngest's — passing the latter is a foreign-key
 * violation, and one that only appears at runtime.
 */
export async function recordLoudnessDeferred(ctx: GateContext, takes: number): Promise<void> {
  await recordRunEvent(db, {
    runId: await resolveRunRowId({
      inngestRunId: ctx.inngestRunId,
      functionId: ctx.functionId,
      projectId: ctx.projectId,
    }),
    kind: 'step.skipped',
    stepId: 'loudness-normalise',
    message: storageConfigured()
      ? `Loudness normalisation skipped for ${takes} takes — media-utils arrives in M6. ` +
        'Levels are whatever the TTS provider returned.'
      : `Loudness normalisation skipped for ${takes} takes — media-utils arrives in M6.`,
    data: { reason: 'media-utils-not-deployed', takes, targetLufs: -16 },
  })
}
