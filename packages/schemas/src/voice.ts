import { createHash } from 'node:crypto'
import { z } from 'zod'
import { matchedHints } from './settings'
import type { PhonemeHint, StabilityTier } from './settings'

/**
 * The voice stage's shared vocabulary (build spec sections 5, 6 and 7).
 *
 * Three things in this file exist because more than one place has to agree on
 * them, and disagreeing would be silent rather than loud:
 *
 *  - **The idempotency key.** The runner computes it to decide whether to pay
 *    for synthesis; the retaker computes it to find the take it is replacing.
 *    A key that differed by one field would make every re-run buy the audio
 *    again, which is exactly what the key exists to prevent.
 *  - **Which take is current.** A paragraph accumulates takes; the coverage
 *    bar, the approve action and the review rows must all mean the same one by
 *    "the take". Only the highest take number counts, and the earlier ones
 *    survive purely so a human can A/B against them.
 *  - **The waveform.** Drawn by the UI, computed by the runner, and stored in
 *    between — bounded here so a bad decode cannot write 4 MB of floats into a
 *    jsonb column.
 */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Mirrors the `voice_take_status` enum in `packages/db` (spec section 5). */
export const VOICE_TAKE_STATUSES = ['pending', 'generated', 'flagged', 'approved'] as const
export const VoiceTakeStatusSchema = z.enum(VOICE_TAKE_STATUSES)
export type VoiceTakeStatus = z.infer<typeof VoiceTakeStatusSchema>

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * `hash(projectId, chapterId, paragraphIndex, textHash, voiceId)`, spec §6.
 *
 * Every field is load-bearing. Drop the text and an edited paragraph keeps its
 * old audio; drop the voice and changing the narrator silently keeps the old
 * narrator; drop the paragraph index and two identical sentences in different
 * places collapse onto one take.
 *
 * The text is hashed **verbatim** — not normalised the way `sentenceHash` is.
 * The opposite rule applies here: `sentenceHash` deliberately survives a typo
 * fix so a claim reference is not orphaned, whereas fixing a typo is precisely
 * when narration must be re-read aloud. Punctuation changes how a line is
 * spoken, so punctuation counts.
 */
export function takeIdempotencyKey(input: {
  projectId: string
  chapterId: string
  paragraphIndex: number
  text: string
  voiceId: string
  /**
   * The channel-wide pronunciation list, narrowed here to the terms this
   * paragraph actually contains.
   *
   * Beyond spec section 6's five fields, and it has to be. A hint changes how a
   * paragraph is *spoken* without changing a character of it, so without this a
   * corrected pronunciation was unreachable: re-running the voice stage matched
   * the old key and handed back the old take, `Fix the words` refused because
   * the words had not changed, and on a narrator that cannot vary a re-read
   * there was no third door. Teaching the narrator to say "Jan" the English way
   * meant editing the paragraph into something you did not want, purely to
   * force a new key.
   *
   * Only the *matching* hints, so adding a term for "Theranos" re-reads the
   * paragraphs that say Theranos and nothing else. Folded in only when there
   * are any, so a project with no hints keeps every key it already has and this
   * change re-narrates nothing by itself.
   */
  pronunciations?: readonly PhonemeHint[]
  /**
   * `settings.tts.stability` — Eleven v3's three-way delivery control.
   *
   * In the key for the reason the pacing slider was, when there was one: it
   * changes how a paragraph is *spoken* without changing a character of it,
   * and anything with that property left out of the key makes changing it a
   * silent no-op — the fingerprints all still match and a re-run hands back
   * the old audio. (This project shipped that bug twice, once for
   * pronunciations and once for pacing, before the rule was learned.) Folded
   * in only when it is off the default `natural`, so every take bought before
   * this field existed keeps the key it was bought under.
   */
  stability?: StabilityTier
}): string {
  const applicable = matchedHints(input.text, input.pronunciations ?? [])

  return createHash('sha256')
    .update(
      [
        input.projectId,
        input.chapterId,
        String(input.paragraphIndex),
        createHash('sha256').update(input.text).digest('hex'),
        input.voiceId,
        ...(applicable.length === 0
          ? []
          : [
              createHash('sha256')
                .update(
                  applicable
                    .map((hint) => `${hint.term.trim()}=${hint.hint.trim()}`)
                    // Sorted, because the same instructions reordered in
                    // Settings are the same instructions and must not re-buy a
                    // chapter's narration.
                    .sort()
                    .join('\u0000'),
                )
                .digest('hex'),
            ]),
        // The tier name verbatim, prefixed so it can never read as one of the
        // hex hashes around it. Absent at the default — see above.
        ...(input.stability === undefined || input.stability === 'natural'
          ? []
          : [`stability=${input.stability}`]),
        // A NUL, written as an escape because it was previously a literal control
        // character sitting invisibly in this file — source that reads `join('')`
        // and is not. The separator itself is load-bearing and must not change:
        // it keeps ("ab", "c") from hashing the same as ("a", "bc"), and every
        // take already in the database was keyed with it.
      ].join('\u0000'),
    )
    .digest('hex')
    .slice(0, 32)
}

// ---------------------------------------------------------------------------
// Waveform
// ---------------------------------------------------------------------------

/**
 * How many buckets a waveform strip carries.
 *
 * A strip is a couple of hundred pixels wide on the review screen, so more
 * detail than this is invisible and costs database rows. Stored as integer
 * percentages rather than floats for the same reason: `[0, 47, 92]` reads in a
 * psql dump, and nothing downstream needs more precision than a bar height.
 */
export const WAVEFORM_BUCKETS = 160

export const WaveformSchema = z.array(z.number().int().min(0).max(100)).max(WAVEFORM_BUCKETS)
export type Waveform = z.infer<typeof WaveformSchema>

// ---------------------------------------------------------------------------
// Which take counts
// ---------------------------------------------------------------------------

/** The minimum a caller must know about a take to reason about coverage. */
export interface TakeRef {
  chapterId: string
  paragraphIndex: number
  takeNumber: number
  status: VoiceTakeStatus
}

function paragraphKey(take: TakeRef): string {
  return `${take.chapterId}:${take.paragraphIndex}`
}

/**
 * The current take for each paragraph: highest take number wins.
 *
 * Earlier takes are never deleted — a retake you dislike more than the original
 * is a real outcome, and the A/B toggle on the review row is the way back.
 */
export function latestTakes<T extends TakeRef>(takes: readonly T[]): T[] {
  const byParagraph = new Map<string, T>()

  for (const take of takes) {
    const key = paragraphKey(take)
    const held = byParagraph.get(key)
    if (!held || take.takeNumber > held.takeNumber) byParagraph.set(key, take)
  }

  return [...byParagraph.values()]
}

export interface VoiceCoverage {
  paragraphs: number
  generated: number
  flagged: number
  approved: number
  pending: number
}

/** The counts behind the coverage bar (spec section 11.3, Voice review). */
export function voiceCoverage(takes: readonly TakeRef[]): VoiceCoverage {
  const current = latestTakes(takes)

  return {
    paragraphs: current.length,
    generated: current.filter((take) => take.status === 'generated').length,
    flagged: current.filter((take) => take.status === 'flagged').length,
    approved: current.filter((take) => take.status === 'approved').length,
    pending: current.filter((take) => take.status === 'pending').length,
  }
}

/**
 * Why the voice gate cannot be approved yet, or `undefined` when it can.
 *
 * Spec section 7.3: "the main run's gate wait is only satisfied when the UI
 * approve action verifies zero flagged takes server-side". So this is read by
 * the action as well as by the screen — a disabled button is a hint, and a hint
 * is not a guarantee against a stale tab or a replayed post. Same rule as the
 * dossier's unsourced-claim blocker.
 */
export function voiceApprovalBlockedReason(
  takes: readonly TakeRef[],
  expectedParagraphs: number,
): string | undefined {
  if (expectedParagraphs === 0) return 'This script has no paragraphs to narrate.'

  const coverage = voiceCoverage(takes)

  if (coverage.paragraphs < expectedParagraphs) {
    const missing = expectedParagraphs - coverage.paragraphs
    return `${missing} of ${expectedParagraphs} paragraphs have no audio yet.`
  }

  if (coverage.pending > 0) {
    return `${coverage.pending} paragraph${coverage.pending === 1 ? ' is' : 's are'} still being synthesised.`
  }

  if (coverage.flagged > 0) {
    return (
      `${coverage.flagged} flagged ${coverage.flagged === 1 ? 'take is' : 'takes are'} unresolved. ` +
      'Each one needs a retake you accept, or the flag cleared.'
    )
  }

  return undefined
}
