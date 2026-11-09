/**
 * The derivation's estimate as the Derive dialogue computes it (spec
 * 2026-11-04, section 9.1), in the browser: pure, no import, so a client
 * component can follow the ticks and the rounds without pulling the cost
 * package (and its database) into the bundle. The table itself is priced on
 * the server (`motion-estimates.ts`).
 */

export interface DerivationEstimateTable {
  /** The storyboard, the build and the verify: paid once per technique. */
  perTechniqueFixed: number
  /** One critic call and one fix: paid per round. */
  perRound: number
  /** The pairwise ask with the order swapped: paid from round two. */
  perPairwise: number
  /** The technique proposal (spec 8.5): paid once when the tick is on. */
  perProposal: number
}

/** With `propose`, the proposal call plus one more technique's loop for what it proposes. */
export function derivationEstimateUsd(
  table: DerivationEstimateTable,
  input: { techniques: number; rounds: number; propose?: boolean },
): number {
  const perTechnique =
    table.perTechniqueFixed +
    input.rounds * table.perRound +
    Math.max(0, input.rounds - 1) * table.perPairwise
  const techniques = input.techniques + (input.propose ? 1 : 0)
  return techniques * perTechnique + (input.propose ? table.perProposal : 0)
}
