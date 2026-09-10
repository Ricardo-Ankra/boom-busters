import { MOCK_KEY_PREFIX } from '@boom-busters/db'
import { TimelineSlotSchema } from '@boom-busters/schemas'
import type { SlotCandidate, TimelineSlot } from '@boom-busters/schemas'

/**
 * The teaser studio's fetched-candidate rules (decision 231): how one
 * `SlotCandidate` from the per-beat pool becomes the stored slot snapshot the
 * beat's choice holds. Pure, because three places must agree exactly: the
 * shorts model (which pre-builds slots for candidates whose bytes already
 * exist so the pick is the plain `saveTeaserShot`), the teaser-shot-fetcher
 * (which builds the slot after ingesting a stock pick), and the tests.
 */

/** Generated stills come from generators; everything else searched as stock. */
function slotTypeOf(candidate: SlotCandidate): 'stock' | 'still' | 'upload' {
  if (candidate.provider === 'fal' || candidate.provider === 'google') return 'still'
  if (candidate.provider === 'upload') return 'upload'
  return 'stock'
}

/** The mock bookmark key for a picked mock candidate; nothing to download. */
export function mockTeaserShotKey(candidateId: string): string {
  return `${MOCK_KEY_PREFIX}teaser-shot/${candidateId}`
}

/**
 * Whether the candidate can become a slot RIGHT NOW, without a download:
 * bytes already in R2 (generated stills, previously ingested picks), or mock
 * mode where a bookmark key stands in for bytes that never existed. A live
 * stock candidate without bytes is not ready; its pick goes through the
 * runner's ingest op first, because provider download URLs expire.
 */
export function teaserCandidateReady(candidate: SlotCandidate, mocked: boolean): boolean {
  return mocked || candidate.r2Key !== undefined
}

/**
 * Build the beat's slot snapshot from a candidate whose bytes are settled.
 * Timing fields are placeholders; `compileTeaserMaster` re-clocks every
 * chosen slot onto the beat's narration. New images get a gentle push-in
 * (a static frame reads dead in a teaser); videos already move.
 *
 * Returns null only for a candidate `teaserCandidateReady` would refuse, or
 * one whose shape the timeline schema rejects; callers treat both as "not
 * pickable yet", never as a crash.
 */
export function slotFromTeaserCandidate(
  candidate: SlotCandidate,
  options: { mocked: boolean },
): TimelineSlot | null {
  const src = candidate.r2Key
    ? {
        r2Key: candidate.r2Key,
        ...(candidate.previewR2Key !== undefined ? { previewR2Key: candidate.previewR2Key } : {}),
      }
    : options.mocked
      ? { r2Key: mockTeaserShotKey(candidate.id) }
      : /^https?:\/\//.test(candidate.sourceUrl)
        ? // Last resort for live-without-R2, the same rule assembly compiles by.
          { externalUrl: candidate.sourceUrl }
        : null
  if (src === null) return null

  const type = slotTypeOf(candidate)
  const slot = {
    type: candidate.kind === 'video' ? ('stock' as const) : type,
    startMs: 0,
    durationMs: candidate.durationMs ?? 5000,
    transition: 'cut' as const,
    motion:
      candidate.kind === 'video'
        ? ({ kind: 'static' } as const)
        : ({ kind: 'kenburns', direction: 'in', intensity: 0.08 } as const),
    payload:
      candidate.kind === 'video'
        ? { kind: 'video' as const, src, muted: true as const }
        : {
            kind: 'image' as const,
            src,
            ...(candidate.width !== undefined ? { width: candidate.width } : {}),
            ...(candidate.height !== undefined ? { height: candidate.height } : {}),
          },
  }

  const parsed = TimelineSlotSchema.safeParse(slot)
  return parsed.success ? parsed.data : null
}
