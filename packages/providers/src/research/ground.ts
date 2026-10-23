import type {
  CaseBrief,
  ClaimSourceTypeName,
  DocumentKind,
  GroundedClaim,
  GroundedRef,
  GroundedResearch,
  GroundedSupport,
  ResearchAnswer,
  ResearchClaim,
  Scene,
  Series,
} from '@boom-busters/schemas'
import type { Note } from '../prompts/repair'
import { computeConfidence } from './confidence'
import { documentByNumber, type CorpusDocument } from './corpus'
import { foldDocument, foldText, locatorSeconds, quoteFoundIn, type Folded } from './fold'

export interface GroundInput {
  entity: GroundedResearch['entity']
  brief: CaseBrief
  scenes: readonly Scene[]
  claims: readonly ResearchClaim[]
  answers: readonly ResearchAnswer[]
  documents: readonly CorpusDocument[]
  corpus: { read: number; unread: number; failed: number }
}

const SOURCE_TYPES: Record<DocumentKind, ClaimSourceTypeName> = {
  court: 'court',
  regulator: 'regulator',
  reporting: 'major_outlet',
  video: 'major_outlet',
  filing: 'other',
  'web-archive': 'other',
  'press-release': 'other',
  figures: 'other',
}

const NOT_GIVEN = 'cites a document that was not given'

/**
 * Turn the research passes' numbered citations into stored shapes. Pure: the
 * quote checks are the only thing standing between a model's say-so and a
 * script, so nothing here trusts a number, a quote or a confidence it was told.
 */
export function groundResearch(
  input: GroundInput,
  note: Note,
): { research: GroundedResearch; claims: GroundedClaim[] } {
  const { documents } = input
  // Each document is folded once; every quote of the run searches the same copy.
  const folds = new Map<string, Folded>()
  const foldOf = (doc: CorpusDocument): Folded => {
    let f = folds.get(doc.id)
    if (!f) {
      f = foldDocument(doc.text)
      folds.set(doc.id, f)
    }
    return f
  }

  const check = (doc: CorpusDocument, quote: string) => {
    const hit = quoteFoundIn(foldOf(doc), quote)
    const seconds =
      hit.found && hit.offset !== null && doc.kind === 'video'
        ? locatorSeconds(doc.text, hit.offset)
        : null
    return { ...hit, seconds }
  }

  const refFor = (docNumber: number, quote: string, field: string): GroundedRef => {
    const doc = documentByNumber(documents, docNumber)
    if (!doc) {
      note({ action: 'dropped', field, reason: NOT_GIVEN })
      return { documentId: null, url: null, found: false, locatorSeconds: null, quote: null }
    }
    const hit = check(doc, quote)
    return {
      documentId: doc.id,
      url: doc.url,
      found: hit.found,
      locatorSeconds: hit.seconds,
      quote,
    }
  }

  function groundSeries(
    series: Series | null,
    doc: CorpusDocument | undefined,
    n: number,
  ): Series | null {
    if (!series) return null
    if (!doc) {
      note({
        action: 'dropped',
        field: `claim ${n} series`,
        reason: 'it has no document to check against',
      })
      return null
    }
    // Padded so a figure must sit between fold boundaries: "5" is not in "2015".
    const haystack = ` ${foldOf(doc).folded} `
    const points = series.points.filter((p, i) => {
      const written = foldText(p.asWritten).folded
      // No length floor here: a printed number is short. A digit is required so
      // a label alone cannot pass for a figure.
      const ok = /\d/.test(written) && haystack.includes(` ${written} `)
      if (!ok) {
        note({
          action: 'dropped',
          field: `claim ${n} series point ${i + 1}`,
          reason: 'its written number is not in the document',
        })
      }
      return ok
    })
    if (points.length === 0) {
      note({
        action: 'dropped',
        field: `claim ${n} series`,
        reason: 'no point was found in the document',
      })
      return null
    }
    return { ...series, points }
  }

  function groundClaim(claim: ResearchClaim, n: number): GroundedClaim {
    const supports: GroundedSupport[] = []
    const docs: CorpusDocument[] = []
    claim.supports.forEach((s, m) => {
      const doc = documentByNumber(documents, s.doc)
      if (!doc) {
        note({ action: 'dropped', field: `claim ${n} support ${m + 1}`, reason: NOT_GIVEN })
        return
      }
      const hit = check(doc, s.quote)
      supports.push({
        documentId: doc.id,
        rank: supports.length + 1,
        quote: s.quote,
        found: hit.found,
        offset: hit.offset,
        locatorSeconds: hit.seconds,
        url: doc.url,
        archivedUrl: doc.archivedUrl,
      })
      docs.push(doc)
    })

    let legalStatus: GroundedClaim['legalStatus'] = 'none'
    let legalStatusDate: string | null = null
    let legalStatusDocumentId: string | null = null
    if (claim.legal) {
      const legalDoc = documentByNumber(documents, claim.legal.doc)
      if (!legalDoc) {
        note({ action: 'dropped', field: `claim ${n} legal status`, reason: NOT_GIVEN })
      } else {
        legalStatusDate = claim.legal.date
        legalStatusDocumentId = legalDoc.id
        legalStatus = claim.legal.status
        if (legalStatus === 'ruled' && legalDoc.kind !== 'court' && legalDoc.kind !== 'regulator') {
          legalStatus = 'alleged'
          note({
            action: 'dropped',
            field: `claim ${n} legal status`,
            reason: 'ruled needs a court or regulator document',
          })
        }
      }
    }

    const series = groundSeries(claim.series, docs[0], n)
    // The claim's headline source is one whose quote was found; a support the
    // check could not place is only the fallback.
    const firstFound = supports.findIndex((s) => s.found)
    const primary = firstFound >= 0 ? firstFound : 0
    const primaryDoc = docs[primary]
    return {
      text: series ? `${claim.text} ${renderSeries(series)}` : claim.text,
      sourceUrl: supports[primary]?.url ?? null,
      sourceType: primaryDoc ? SOURCE_TYPES[primaryDoc.kind] : 'other',
      confidence: computeConfidence(supports),
      legalStatus,
      legalStatusDate,
      legalStatusDocumentId,
      series,
      supports,
    }
  }

  const claims = input.claims.map((claim, i) => groundClaim(claim, i + 1))

  const scenes = input.scenes.map((s, i) => {
    const { doc, ...rest } = s
    return { ...rest, ref: refFor(doc, s.quote, `scene ${i + 1}`) }
  })

  const cast = input.brief.cast.map((member, i) => {
    const { scene, ...rest } = member
    return { ...rest, ref: scene ? refFor(scene.doc, scene.quote, `cast ${i + 1} scene`) : null }
  })

  // Spec 4.4: a told-already beat is what an existing video said, so it is kept
  // only when its quote is found in a video's transcript and has a timestamp.
  const toldAlready = input.brief.toldAlready.flatMap((t, i) => {
    const field = `told-already beat ${i + 1}`
    const ref = refFor(t.doc, t.quote, field)
    if (ref.locatorSeconds !== null) return [{ beat: t.beat, ref }]
    // refFor has already noted a document that was not given.
    if (ref.documentId !== null) {
      note({ action: 'dropped', field, reason: 'its quote is not found in a video transcript' })
    }
    return []
  })

  const answers = input.answers.map((a, i) => {
    const { doc, ...rest } = a
    if (doc === undefined) return { ...rest, ref: null }
    const found = documentByNumber(documents, doc)
    if (!found) {
      note({ action: 'dropped', field: `answer ${i + 1}`, reason: NOT_GIVEN })
      return { ...rest, ref: null }
    }
    // An answer cites a document without quoting it, so there is nothing to
    // find: the ref says which document it rests on.
    return {
      ...rest,
      ref: { documentId: found.id, url: found.url, found: true, locatorSeconds: null, quote: null },
    }
  })

  return {
    research: {
      entity: input.entity,
      brief: {
        currentStatus: input.brief.currentStatus,
        summary: input.brief.summary,
        turningPoint: input.brief.turningPoint,
        cast,
        toldAlready,
        openQuestions: input.brief.openQuestions,
      },
      scenes,
      answers,
      corpus: input.corpus,
    },
    claims,
  }
}

function renderSeries(series: Series): string {
  const unit = `${series.unit}${series.currency ? ', ' + series.currency : ''}`
  return `${series.label} (${unit}): ${series.points.map((p) => `${p.at} ${p.asWritten}`).join('; ')}`
}
