import { COUNTED_OUTCOMES, holdGood, suggestTuning, trackRecord } from '@boom-busters/schemas'
import type {
  CountedVideo,
  ResearchThresholds,
  Suggestion,
  VerdictCheck,
} from '@boom-busters/schemas'

/**
 * What the Search track record panel shows, as plain data a server component
 * can hand to a client one. The actions recompute the suggestions from the
 * same inputs, so what a button applies is never read back from the browser.
 */

export interface TrackRecordCheck {
  check: VerdictCheck
  right: number
  counted: number
  videos: { projectId: string; title: string; right: boolean }[]
}

export interface AppliedValue {
  key: keyof ResearchThresholds
  value: number
  previous: number | null
  /** ISO date. */
  appliedAt: string
  evidence: string
}

export interface IntentRow {
  label: string
  good: number
  total: number
}

export interface TrackRecordData {
  counted: number
  checks: TrackRecordCheck[]
  suggestions: Suggestion[]
  applied: AppliedValue[]
  intents: IntentRow[]
}

export type TrackedVideo = CountedVideo & { targetIntent?: string; targetTopic?: string }

export interface Dismissal {
  key: keyof ResearchThresholds
  direction: 'raise' | 'lower'
  supportAtDismissal: number
}

/** The live suggestions for a channel: what the panel lists and what an action checks against. */
export function liveSuggestions(
  videos: TrackedVideo[],
  current: ResearchThresholds,
  dismissals: Dismissal[],
): Suggestion[] {
  return suggestTuning(
    videos,
    current,
    dismissals.map((d) => ({ key: d.key, direction: d.direction, support: d.supportAtDismissal })),
  )
}

/**
 * Per intent label (the topic when a target has no intent), how many counted
 * videos had a good target hold. Information only: nothing here changes a threshold.
 */
export function intentRows(videos: TrackedVideo[]): IntentRow[] {
  const byLabel = new Map<string, IntentRow>()
  for (const v of videos) {
    if (v.report.checkpoint !== 28 || !COUNTED_OUTCOMES.includes(v.report.outcome)) continue
    const label = v.targetIntent ?? v.targetTopic
    if (!label) continue
    const row = byLabel.get(label) ?? { label, good: 0, total: 0 }
    row.total += 1
    if (holdGood(v.report) === true) row.good += 1
    byLabel.set(label, row)
  }
  return [...byLabel.values()].sort((a, b) => b.good - a.good || a.label.localeCompare(b.label))
}

export function buildTrackRecordData(input: {
  videos: TrackedVideo[]
  current: ResearchThresholds
  dismissals: Dismissal[]
  applied: AppliedValue[]
}): TrackRecordData {
  const counted = input.videos.filter(
    (v) => v.report.checkpoint === 28 && COUNTED_OUTCOMES.includes(v.report.outcome),
  ).length
  return {
    counted,
    checks: trackRecord(input.videos),
    suggestions: liveSuggestions(input.videos, input.current, input.dismissals),
    applied: input.applied,
    intents: intentRows(input.videos),
  }
}
