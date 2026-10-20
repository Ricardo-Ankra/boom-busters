import { PAPER_TRAIL_LEVELS } from '../config'
import type { EntryEvidence, Lane, PrimaryDocument } from '../types'

export type PaperTrail = 'none' | 'thin' | 'enough' | 'strong'
export type LegalFlag = 'adjudicated' | 'alleged' | 'self-reported' | 'clear'

/**
 * What the rubric needs to kill or flag an entry before it is scored. A pure
 * function of the evidence and the lane, so the back-test applies it unchanged.
 */
export interface Gates {
  paperTrail: PaperTrail
  documentCount: number
  legal: LegalFlag
  livingPeople: number
  kill: string | null
}

export const KILL_NO_RECORD = 'not enough public record'
export const KILL_LEGAL = 'legal: alleged, living people named, thin record'

/**
 * Documents that existed before T, deduplicated by URL (the same filing can
 * arrive from two sources). A document dated on or after T is hindsight and is
 * ignored everywhere below, including the AAER test for 'adjudicated'.
 */
function countedDocuments(e: EntryEvidence): PrimaryDocument[] {
  const seen = new Map<string, PrimaryDocument>()
  for (const d of e.documents) {
    if (d.datedAt !== null && d.datedAt >= e.asOf) continue
    if (!seen.has(d.url)) seen.set(d.url, d)
  }
  return [...seen.values()]
}

function paperTrailFor(n: number): PaperTrail {
  if (n >= PAPER_TRAIL_LEVELS.strong) return 'strong'
  if (n >= PAPER_TRAIL_LEVELS.enough) return 'enough'
  if (n >= PAPER_TRAIL_LEVELS.thin) return 'thin'
  return 'none'
}

export function gates(e: EntryEvidence, lane: Lane): Gates {
  const counted = countedDocuments(e)
  const paperTrail = paperTrailFor(counted.length)
  const livingPeople = e.people.filter((p) => p.living).length

  let legal: LegalFlag
  if (lane === 'downfall') {
    const adjudicated =
      e.people.some((p) => p.convicted) || counted.some((d) => d.source === 'sec-aaer')
    legal = adjudicated ? 'adjudicated' : 'alleged'
  } else {
    legal =
      livingPeople > 0 && !counted.some((d) => d.source === 'edgar') ? 'self-reported' : 'clear'
  }

  let kill: string | null = null
  if (paperTrail === 'none') kill = KILL_NO_RECORD
  else if (legal === 'alleged' && livingPeople > 0 && paperTrail === 'thin') kill = KILL_LEGAL

  return { paperTrail, documentCount: counted.length, legal, livingPeople, kill }
}
