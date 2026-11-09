import type {
  GroundedClaim,
  GroundedSupport,
  ResearchClaim,
  ResearchProfile,
} from '@boom-busters/schemas'
import type { Note } from '../prompts/repair'
import { documentByNumber, type CorpusDocument } from './corpus'

export const NOT_GIVEN = 'cites a document that was not given'

/** Any review word as a whole phrase, any case, any run of spaces between its words. */
function reviewPattern(words: readonly string[]): RegExp | null {
  if (words.length === 0) return null
  const escaped = words.map((phrase) =>
    phrase
      .split(' ')
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+'),
  )
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i')
}

/**
 * The evidence a claim ends with. A downgrade is free and an upgrade is
 * earned (spec 5.2): the earned status stands only when the claim's found
 * scholarly supports meet the axis's rule, and otherwise falls to the
 * profile's fallback with a repair note. Only a support whose quote was found
 * counts, and two supports from one document count once.
 */
export function groundEvidence(
  claim: ResearchClaim,
  found: readonly { doc: CorpusDocument; support: GroundedSupport }[],
  documents: readonly CorpusDocument[],
  profile: ResearchProfile,
  note: Note,
  n: number,
): GroundedClaim['evidence'] {
  const axis = profile.evidence
  if (!axis || !claim.evidence) return null
  const shown = documentByNumber(documents, claim.evidence.doc)
  if (!shown) {
    note({ action: 'dropped', field: `claim ${n} evidence`, reason: NOT_GIVEN })
    return null
  }
  let status = claim.evidence.status
  if (status === axis.earned.status) {
    const scholarly = found.filter(({ doc, support }) => support.found && doc.kind === 'scholarly')
    const distinct = new Set(scholarly.map(({ support }) => support.documentId)).size
    const review = reviewPattern(axis.earned.reviewWords)
    const reviewed = review !== null && scholarly.some(({ support }) => review.test(support.quote))
    if (distinct < axis.earned.minScholarlyDocuments && !reviewed) {
      status = axis.fallback
      note({
        action: 'dropped',
        field: `claim ${n} evidence status`,
        reason: `${axis.earned.status} needs ${axis.earned.minScholarlyDocuments} scholarly documents, or one that reviews the studies, with the quote found`,
      })
    }
  }
  return { status, documentId: shown.id }
}
