import type { ShotSlotStatus, SlotCandidate } from '@boom-busters/schemas'

/**
 * The pure half of shot reuse on the board (decision 261): what a card says
 * about its link, and the note when one picture plays twice within a minute.
 * The writes live in the db package; this is what the review model and the
 * board read.
 */

/** Two plays of one picture closer than this get a note, in the picker and on the plan. */
export const CLOSE_REUSE_MS = 60_000

export interface ReuseSource {
  sourceSlotId: string
  chapterIndex: number
  startMs: number
  sourceStatus: ShotSlotStatus
}

export interface ReusableRow {
  id: string
  chapterIndex: number
  startMs: number
  status: ShotSlotStatus
  reuseOfSlotId: string | null
  candidates: readonly SlotCandidate[]
}

export function timecode(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

/** "3 min 20 s earlier": where another slot plays, relative to this one. */
export function describeGap(fromMs: number, toMs: number): string {
  const seconds = Math.round(Math.abs(toMs - fromMs) / 1000)
  const words = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
  return `${words} ${toMs < fromMs ? 'earlier' : 'later'}`
}

/** The source a linked slot shows, or null for a slot with its own shot or a source row that is gone. */
export function reuseView(row: ReusableRow, rows: readonly ReusableRow[]): ReuseSource | null {
  if (!row.reuseOfSlotId) return null
  const source = rows.find((other) => other.id === row.reuseOfSlotId)
  if (!source) return null
  return {
    sourceSlotId: source.id,
    chapterIndex: source.chapterIndex,
    startMs: source.startMs,
    sourceStatus: source.status,
  }
}

/** What identifies a chosen picture: the bytes we hold, else the provider's own id. */
function chosenKey(row: ReusableRow): string | null {
  const chosen = row.candidates.find((candidate) => candidate.chosen)
  if (!chosen) return null
  return chosen.assetId ?? `${chosen.provider}:${chosen.id}`
}

/** "the same shot plays at 3:10 and 3:40": two slots holding one picture within a minute. */
export function sharedShotWarnings(rows: readonly ReusableRow[]): string[] {
  const warnings: string[] = []
  const sorted = [...rows].sort((a, b) => a.startMs - b.startMs)
  for (let first = 0; first < sorted.length; first += 1) {
    const a = sorted[first]!
    const keyA = chosenKey(a)
    if (keyA === null) continue
    for (let second = first + 1; second < sorted.length; second += 1) {
      const b = sorted[second]!
      if (b.startMs - a.startMs >= CLOSE_REUSE_MS) break
      if (chosenKey(b) === keyA) {
        warnings.push(
          `the same shot plays at ${timecode(a.startMs)} and ${timecode(b.startMs)}, under a minute apart`,
        )
      }
    }
  }
  return warnings
}
