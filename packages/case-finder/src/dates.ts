import type { IsoDate } from './types'

/** Calendar arithmetic on 'YYYY-MM-DD' days, in UTC so no time zone moves a boundary. */

const DAY_MS = 86_400_000

/** The date `months` before `date`, with a missing day clamped to the end of that month. */
export function monthsBefore(date: IsoDate, months: number): IsoDate {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const lastDay = new Date(Date.UTC(year, month - 1 - months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 - months, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10)
}

export function minusDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)
}
