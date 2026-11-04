import { VIDIQ_CREDIT_COST } from '@boom-busters/providers/vidiq'
import { SEARCH_BRIEF_STALE_DAYS } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'

/**
 * What winning looks like in a format's keywords, beside its card: how long the
 * winning videos run and the title patterns they share, dated. The page hands
 * the readings down keyed by the lower-cased keyword, like the volume readings.
 */

export interface SearchSpaceReading {
  /** ISO time of the analysis. */
  measuredAt: string
  titlePatterns: string[]
  durations: { minSec: number; medianSec: number; maxSec: number } | null
}

export type SearchSpaceReadings = Record<string, SearchSpaceReading>

/** What the formats card needs to show and start an analysis. */
export interface SearchSpaceView {
  readings: SearchSpaceReadings
  /** Per format key, how many of its keywords have no analysis from the last 30 days. */
  counts: Record<string, number>
  /** A VidIQ key is on file. */
  ready: boolean
  /** A run, an archived channel or an action in flight holds the button. */
  disabled: boolean
  onAnalyse: (formatKey: string) => void
}

/** Credits for one keyword: its outliers and the top ten's details. */
export const SEARCH_SPACE_CREDITS_PER_KEYWORD =
  VIDIQ_CREDIT_COST.outliers + VIDIQ_CREDIT_COST.getVideosByIds

const DAY_MS = 24 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2 Nov", in UTC so the server and the browser agree. */
function shortDate(iso: string): string {
  const at = new Date(iso)
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
}

/** "2 h 05" from an hour up (minutes to two places), "42 min" under it. */
export function formatRunTime(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

/** "Winning videos run 1 h 40 to 3 h 10, median 2 h 05"; null with no duration read. */
export function spreadText(durations: SearchSpaceReading['durations']): string | null {
  if (!durations) return null
  return `Winning videos run ${formatRunTime(durations.minSec)} to ${formatRunTime(durations.maxSec)}, median ${formatRunTime(durations.medianSec)}`
}

/** The date, and past 30 days how old it is. */
export function analysedText(
  reading: SearchSpaceReading,
  now: number = Date.now(),
): { text: string; stale: boolean } {
  const age = now - Date.parse(reading.measuredAt)
  if (age > SEARCH_BRIEF_STALE_DAYS * DAY_MS) {
    return {
      text: `Analysed ${Math.floor(age / DAY_MS)} days ago, older than ${SEARCH_BRIEF_STALE_DAYS} days`,
      stale: true,
    }
  }
  return { text: `Analysed ${shortDate(reading.measuredAt)}`, stale: false }
}

/** One format's analysed keywords: the spread, the patterns, the date. Nothing for none. */
export function FormatSearchSpace({
  keywords,
  readings,
}: {
  keywords: string[]
  readings: SearchSpaceReadings
}) {
  const shown = keywords.flatMap((keyword) => {
    const reading = readings[keyword.trim().toLowerCase()]
    return reading ? [{ keyword, reading }] : []
  })
  if (shown.length === 0) return null
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <span className="text-[var(--color-text-secondary)]">Search space:</span>
      <ul className="flex list-none flex-col gap-2 pl-3">
        {shown.map(({ keyword, reading }) => {
          const spread = spreadText(reading.durations)
          const when = analysedText(reading)
          return (
            <li key={keyword} className="flex flex-col gap-0.5">
              <span className="text-[14px]">{keyword}</span>
              {spread ? <span>{spread}</span> : null}
              {reading.titlePatterns.length > 0 ? (
                <ul className="flex list-disc flex-col gap-0.5 pl-5">
                  {reading.titlePatterns.map((pattern) => (
                    <li key={pattern}>{pattern}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  No winning videos found
                </span>
              )}
              <span
                className={`text-[12px] ${when.stale ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'}`}
              >
                {when.text}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** "Analyse search space (about N credits)"; hidden when there is nothing to analyse. */
export function SearchSpaceButton({
  count,
  disabled,
  unavailable,
  onAnalyse,
}: {
  /** Keywords with no analysis from the last 30 days. */
  count: number
  disabled: boolean
  /** No VidIQ key is on file. */
  unavailable: boolean
  onAnalyse: () => void
}) {
  if (count === 0) return null
  return (
    <Button
      variant="outline"
      disabled={disabled || unavailable}
      {...(unavailable ? { title: 'Add a VidIQ key in Settings, Connections' } : {})}
      onClick={onAnalyse}
    >
      Analyse search space (about {count * SEARCH_SPACE_CREDITS_PER_KEYWORD} credits)
    </Button>
  )
}
