import { SEARCH_BRIEF_STALE_DAYS } from '@boom-busters/schemas'

/**
 * A keyword's latest VidIQ reading beside it on the Bible tab. The page hands
 * the readings down keyed by the lower-cased keyword (the same key the database
 * helper uses), so a keyword is found whatever case it was typed in.
 */

export interface KeywordReading {
  volume: number | null
  competition: number | null
  /** ISO time of the measurement. */
  measuredAt: string
}

export type KeywordReadings = Record<string, KeywordReading>

const DAY_MS = 24 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const NEUTRAL = 'text-[12px] text-[var(--color-text-secondary)]'
const MUTED = 'text-[12px] text-[var(--color-text-muted)]'

/** "2 Nov", in UTC so the server and the browser agree. */
function shortDate(iso: string): string {
  const at = new Date(iso)
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
}

/** What to say beside a keyword, and whether to say it quietly. */
export function readingText(
  reading: KeywordReading | undefined,
  now: number = Date.now(),
): { text: string; muted: boolean } {
  if (!reading) return { text: 'Not measured', muted: true }
  const age = now - Date.parse(reading.measuredAt)
  if (age > SEARCH_BRIEF_STALE_DAYS * DAY_MS) {
    return { text: `Measured ${Math.floor(age / DAY_MS)} days ago`, muted: true }
  }
  const noData = reading.volume === null && reading.competition === null
  if (noData) {
    return {
      text: `No VidIQ data for this phrase, measured ${shortDate(reading.measuredAt)}`,
      muted: true,
    }
  }
  const figure = (n: number | null) => (n === null ? 'unknown' : String(n))
  return {
    text: `Volume ${figure(reading.volume)}, competition ${figure(reading.competition)}, measured ${shortDate(reading.measuredAt)}`,
    muted: false,
  }
}

/** A keyword with its reading beside it. */
export function KeywordWithReading({
  keyword,
  readings,
}: {
  keyword: string
  readings: KeywordReadings
}) {
  const { text, muted } = readingText(readings[keyword.trim().toLowerCase()])
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-[14px]">{keyword}</span>
      <span className={muted ? MUTED : NEUTRAL}>{text}</span>
    </span>
  )
}
