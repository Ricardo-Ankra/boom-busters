import { FORTUNE_CLIMB } from '../config'
import type { IsoDate } from '../types'

export interface FortuneRow {
  year: number
  rank: number
  company: string
}

/**
 * Companies that climbed the Fortune 500 fast (rule A) or arrived late and
 * reached the top 100 (rule B). `since` is Jan 1 of the earliest year either
 * rule was first met, so the success tag never predates what it describes.
 */
export function fortuneClimbers(rows: FortuneRow[]): { company: string; since: IsoDate }[] {
  const byCompany = new Map<string, Map<number, number>>()
  for (const r of rows) {
    const years = byCompany.get(r.company) ?? new Map<number, number>()
    years.set(r.year, r.rank)
    byCompany.set(r.company, years)
  }
  const out: { company: string; since: IsoDate }[] = []
  for (const [company, ranks] of byCompany) {
    const years = [...ranks.keys()].sort((a, b) => a - b)
    const met: number[] = []
    for (const y2 of years) {
      const r2 = ranks.get(y2)!
      if (
        years.some(
          (y1) =>
            y1 < y2 &&
            y2 - y1 <= FORTUNE_CLIMB.years - 1 &&
            ranks.get(y1)! - r2 >= FORTUNE_CLIMB.places,
        )
      ) {
        met.push(y2)
        break
      }
    }
    const first = years[0]!
    if (first > FORTUNE_CLIMB.lateEntryAfter) {
      const later = years.find((y) => y > first && ranks.get(y)! <= FORTUNE_CLIMB.topRank)
      if (later !== undefined) met.push(later)
    }
    if (met.length > 0) out.push({ company, since: `${Math.min(...met)}-01-01` })
  }
  return out.sort((a, b) => (a.company < b.company ? -1 : a.company > b.company ? 1 : 0))
}
