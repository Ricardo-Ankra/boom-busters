const CONCEPTS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'NetIncomeLoss',
  'Assets',
  'Liabilities',
  'CashAndCashEquivalentsAtCarryingValue',
] as const

/** A fiscal year is about 365 days; 350 allows 52-week years and short-year quirks. */
const MIN_ANNUAL_DAYS = 350

interface Fact {
  fy?: number
  fp?: string
  form?: string
  val?: number
  start?: string
  end?: string
  filed?: string
}

interface Row {
  concept: string
  year: number
  value: number
  unit: string
  filed: string
  days: number
}

/**
 * Annual XBRL facts as `concept | FY | value | unit` lines.
 *
 * The year comes from the period end, not the `fy` field: every 10-K repeats
 * its prior years' figures tagged with its own `fy`, so keying on `fy` would
 * let a comparative overwrite the year it describes.
 */
export function xbrlFactsText(json: unknown): string {
  const gaap = (
    json as { facts?: { 'us-gaap'?: Record<string, { units?: Record<string, Fact[]> }> } } | null
  )?.facts?.['us-gaap']
  if (!gaap || typeof gaap !== 'object') return ''

  const rows = new Map<string, Row>()
  for (const concept of CONCEPTS) {
    const units = gaap[concept]?.units
    if (!units) continue
    for (const [unit, facts] of Object.entries(units)) {
      if (!Array.isArray(facts)) continue
      for (const fact of facts) {
        if (fact.form !== '10-K' || fact.fp !== 'FY') continue
        if (typeof fact.val !== 'number' || typeof fact.end !== 'string') continue
        const year = Number(fact.end.slice(0, 4))
        if (!Number.isInteger(year)) continue
        // Some filings tag quarterly-note facts fp FY with the fiscal year end as
        // their end date; only the duration tells them from the annual figure.
        let days = 0
        if (fact.start !== undefined) {
          days = (Date.parse(fact.end) - Date.parse(fact.start)) / 86_400_000
          if (!(days >= MIN_ANNUAL_DAYS)) continue
        }
        const filed = fact.filed ?? ''
        const key = `${concept}|${unit}|${year}`
        const held = rows.get(key)
        // Ties are settled the same way every run: a restatement beats the
        // original, then the longer period, then whichever was seen first.
        const wins =
          held === undefined || filed > held.filed || (filed === held.filed && days > held.days)
        if (wins) rows.set(key, { concept, year, value: fact.val, unit, filed, days })
      }
    }
  }

  const order = (concept: string): number => CONCEPTS.indexOf(concept as (typeof CONCEPTS)[number])
  return [...rows.values()]
    .sort((a, b) => a.year - b.year || order(a.concept) - order(b.concept))
    .map((row) => `${row.concept} | ${row.year} | ${row.value} | ${row.unit}`)
    .join('\n')
}

/** Stooq daily CSV reduced to the last trading day's close of each month. */
export function pricesText(csv: string): string {
  const closes = new Map<string, { date: string; close: string }>()
  for (const line of csv.split(/\r?\n/)) {
    const [date, , , , close] = line.split(',')
    if (!date || !close || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const month = date.slice(0, 7)
    const held = closes.get(month)
    if (held === undefined || date > held.date) closes.set(month, { date, close: close.trim() })
  }
  return [...closes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, row]) => `${month} | ${row.close}`)
    .join('\n')
}
