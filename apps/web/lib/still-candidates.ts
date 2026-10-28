import type { SlotCandidate } from '@boom-busters/schemas'

/**
 * A Regenerate on a still adds its images to the ones the slot already holds
 * (decision 324), where it used to replace them. A still buys one image a
 * pass now, so Regenerate is how the owner asks for a second look, and a
 * second look that threw the first away would cost a pick every time.
 *
 * Three rules:
 *
 * - **The pick stays.** The owner's chosen candidate, and the slot's chosen
 *   asset with it, survive the press. Only a slot that holds no pick takes
 *   the first new image as its default, the rule `withChoice` applies to a
 *   fresh slot.
 * - **Newest beside the pick.** The board shows the chosen candidate first,
 *   then the rest in stored order, `CANDIDATES_SHOWN` of them. New images go
 *   ahead of the old ones, so the image just bought is never the one that
 *   falls past the strip.
 * - **No image twice.** A candidate's id comes from its content hash, so an
 *   image already held is not listed again.
 *
 * Pure: the refetcher decides whether a press adds (the slot's images still
 * answer its brief and route) and this decides how.
 */
export function addRegenerated(input: {
  existing: readonly SlotCandidate[]
  existingChosenAssetId: string | null
  fresh: readonly SlotCandidate[]
}): { candidates: SlotCandidate[]; chosenAssetId: string | null } {
  const held = new Set(input.existing.map((candidate) => candidate.id))
  const added = input.fresh
    .filter((candidate) => !held.has(candidate.id))
    .map(({ chosen: _chosen, ...candidate }) => candidate)
  const picked = input.existing.find((candidate) => candidate.chosen === true)

  if (picked) {
    return {
      candidates: [...added, ...input.existing],
      chosenAssetId: input.existingChosenAssetId ?? picked.assetId ?? null,
    }
  }

  const [first, ...rest] = added
  if (!first) {
    return { candidates: [...input.existing], chosenAssetId: input.existingChosenAssetId }
  }
  return {
    candidates: [{ ...first, chosen: true }, ...rest, ...input.existing],
    chosenAssetId: first.assetId ?? null,
  }
}
