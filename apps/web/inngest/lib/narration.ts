import { recordRunEvent } from '@boom-busters/db'
import { splitParagraphs, takeIdempotencyKey } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { storageConfigured } from '@/lib/storage'
import { resolveRunRowId } from '../middleware/run-mirror'
import type { GateContext } from './gates'

/**
 * The parts of narration that the runner and the retaker both need, and that
 * are worth testing without an Inngest harness around them.
 */

export interface ParagraphJob {
  chapterId: string
  chapterTitle: string
  paragraphIndex: number
  text: string
  idempotencyKey: string
}

/**
 * Every paragraph of a script, in the order it will be spoken.
 *
 * The unit of the whole stage (spec section 7): takes, retakes, alignment merge
 * and Shorts segment refs are all addressed by `(chapterId, paragraphIndex)`,
 * and the indexes have to be stable across re-runs. They are, because they come
 * from one `splitParagraphs` over the approved `contentMd` and nothing else.
 */
export function paragraphJobs(input: {
  projectId: string
  voiceId: string
  chapters: readonly { id: string; title: string; contentMd: string }[]
}): ParagraphJob[] {
  return input.chapters.flatMap((chapter) =>
    splitParagraphs(chapter.contentMd).map((text, paragraphIndex) => ({
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      paragraphIndex,
      text,
      idempotencyKey: takeIdempotencyKey({
        projectId: input.projectId,
        chapterId: chapter.id,
        paragraphIndex,
        text,
        voiceId: input.voiceId,
      }),
    })),
  )
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
