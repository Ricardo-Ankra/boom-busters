import type { DuckingPoint, NarrationSegment } from '@boom-busters/schemas'

/**
 * Ducking-curve maths (build spec sections 8.2, 13): the music bed sits at
 * its base gain, drops by the Brand Kit's duck depth while narration plays,
 * and only rises back in silences long enough to be deliberate breathing
 * space — a half-second pause between sentences is not an invitation to
 * swell the soundtrack.
 *
 * Points are ABSOLUTE gains in dB (not offsets), piecewise-linear, strictly
 * increasing in time. The composition's MusicBed interpolates between them.
 */

export interface DuckingConfig {
  /** Base bed gain, dB (Brand Kit `music.bedGainDb`). */
  bedGainDb: number
  /** How far below base the bed sits under narration, dB, negative. */
  duckDepthDb: number
  /** Ramp down before speech starts. */
  attackMs?: number
  /** Ramp up after speech ends. */
  releaseMs?: number
  /** A silence must be at least this long for the bed to rise into it. */
  riseThresholdMs?: number
}

export const DEFAULT_ATTACK_MS = 200
export const DEFAULT_RELEASE_MS = 600
export const DEFAULT_RISE_THRESHOLD_MS = 2000

interface Span {
  startMs: number
  endMs: number
}

/** Merge narration into continuous speech spans, bridging short silences. */
export function speechSpans(
  narration: readonly Pick<NarrationSegment, 'startMs' | 'durationMs'>[],
  riseThresholdMs: number,
): Span[] {
  const ordered = [...narration].sort((a, b) => a.startMs - b.startMs)
  const spans: Span[] = []
  for (const segment of ordered) {
    const endMs = segment.startMs + segment.durationMs
    const last = spans[spans.length - 1]
    if (last && segment.startMs - last.endMs < riseThresholdMs) {
      last.endMs = Math.max(last.endMs, endMs)
    } else {
      spans.push({ startMs: segment.startMs, endMs })
    }
  }
  return spans
}

export function buildDuckingCurve(
  narration: readonly Pick<NarrationSegment, 'startMs' | 'durationMs'>[],
  config: DuckingConfig,
): DuckingPoint[] {
  const attack = config.attackMs ?? DEFAULT_ATTACK_MS
  const release = config.releaseMs ?? DEFAULT_RELEASE_MS
  const threshold = config.riseThresholdMs ?? DEFAULT_RISE_THRESHOLD_MS
  const bed = config.bedGainDb
  const ducked = config.bedGainDb + config.duckDepthDb

  const spans = speechSpans(narration, threshold)
  if (spans.length === 0) return [{ tMs: 0, gainDb: bed }]

  const points: DuckingPoint[] = []
  const first = spans[0]!

  // Before the first words: at bed level only if there is room to be there.
  if (first.startMs - attack > 0) {
    points.push({ tMs: 0, gainDb: bed })
    points.push({ tMs: first.startMs - attack, gainDb: bed })
    points.push({ tMs: first.startMs, gainDb: ducked })
  } else {
    points.push({ tMs: 0, gainDb: ducked })
  }

  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!
    const next = spans[index + 1]
    points.push({ tMs: span.endMs, gainDb: ducked })
    if (next) {
      // The gap is at least `threshold` (shorter ones were merged), so the
      // bed rises, holds, and ducks again before the next words.
      points.push({ tMs: span.endMs + release, gainDb: bed })
      points.push({ tMs: next.startMs - attack, gainDb: bed })
      points.push({ tMs: next.startMs, gainDb: ducked })
    } else {
      // Outro: the bed comes back up after the final words.
      points.push({ tMs: span.endMs + release, gainDb: bed })
    }
  }

  // Strictly increasing tMs: collapse any accidental duplicates, last wins.
  const collapsed: DuckingPoint[] = []
  for (const point of points) {
    const last = collapsed[collapsed.length - 1]
    if (last && point.tMs <= last.tMs) {
      last.gainDb = point.gainDb
    } else {
      collapsed.push({ tMs: point.tMs, gainDb: point.gainDb })
    }
  }
  return collapsed
}

// The bed's gain at time t — the interpolation MusicBed mirrors. The
// implementation moved into the schemas CONTRACT (compositions may import
// only schemas); re-exported here so preview code keeps one import path.
export { gainAt } from '@boom-busters/schemas'
