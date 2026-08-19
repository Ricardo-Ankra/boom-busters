import type { MediaRef } from '@boom-busters/schemas'

/** Smoothstep — gentle in and out, no library, no surprises. */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

/**
 * The Ken Burns scale at `progress` through a slot. `in` pushes from 1 to
 * 1 + intensity; `out` starts pushed in and settles back. Intensity is the
 * compiler's 0.06/0.10/0.16 (decision 120).
 */
export function kenburnsScale(
  direction: 'in' | 'out',
  intensity: number,
  progress: number,
): number {
  const eased = easeInOut(progress)
  return direction === 'in' ? 1 + intensity * eased : 1 + intensity * (1 - eased)
}

/** dB → linear amplitude, the audio side of `gainAt`. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/** Milliseconds → whole frames at the composition's fps. */
export function msToFrames(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000)
}

/**
 * The URL a component may actually load. Compositions only ever see
 * MATERIALISED timelines (broker or preview server resolves storage keys to
 * URLs, spec section 8.2); a bare r2Key reaching a component is a pipeline
 * bug and must fail loudly, not render a broken image quietly.
 */
export function mediaUrl(ref: MediaRef): string {
  const url = ref.url ?? ref.externalUrl
  if (url === undefined) {
    throw new Error(
      `unmaterialised media reference (r2Key: ${ref.r2Key ?? 'none'}) — ` +
        'compositions render materialised timelines only',
    )
  }
  return url
}

/**
 * A materialised URL or a loud failure — the narration/music counterpart of
 * `mediaUrl`, for fields where the canonical form is a bare r2Key.
 */
export function materialisedUrl(url: string | undefined, what: string): string {
  if (url === undefined) {
    throw new Error(`unmaterialised ${what} — compositions render materialised timelines only`)
  }
  return url
}

/**
 * The prefix of a polyline covering `progress` of its length, the last point
 * interpolated — a route that draws on point to point, not vertex to vertex.
 */
export function polylineProgressPoints(
  points: readonly { x: number; y: number }[],
  progress: number,
): { x: number; y: number }[] {
  if (points.length === 0) return []
  if (progress >= 1) return [...points]
  if (progress <= 0) return []
  const lengths: number[] = []
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    const segment = Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y,
    )
    lengths.push(segment)
    total += segment
  }
  let remaining = total * progress
  const out = [points[0]!]
  for (let index = 1; index < points.length; index += 1) {
    const segment = lengths[index - 1]!
    if (remaining >= segment) {
      out.push(points[index]!)
      remaining -= segment
      continue
    }
    const t = segment === 0 ? 0 : remaining / segment
    out.push({
      x: points[index - 1]!.x + (points[index]!.x - points[index - 1]!.x) * t,
      y: points[index - 1]!.y + (points[index]!.y - points[index - 1]!.y) * t,
    })
    break
  }
  return out
}

/** How far through a dissolve-in the slot is; `cut` transitions return 1. */
export function transitionOpacity(
  transition: 'cut' | 'dissolve',
  tMs: number,
  dissolveMs = 500,
): number {
  if (transition === 'cut') return 1
  return Math.min(1, Math.max(0, tMs / dissolveMs))
}
