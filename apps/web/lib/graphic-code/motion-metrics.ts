import sharp from 'sharp'
import type { MotionMetrics } from '@boom-busters/schemas'
import type { FrameShot } from './frames'

/**
 * Measured motion (spec 2026-11-04, section 10.1): the dense shots of one
 * orientation, decoded to a small greyscale picture and compared neighbour
 * to neighbour, so the critic sees where the beats are as numbers instead of
 * guessing motion from stills. Decoded with sharp, already on this route for
 * the reference images; the width, the threshold and the window are the
 * author's (spec 14 leaves them to the builder).
 */

/** The pictures are compared at this width; the height follows the frame. */
export const METRICS_WIDTH = 160
/** Mean absolute grey difference per pixel (0 to 255) under which a pair reads as frozen. */
export const FROZEN_THRESHOLD = 2
/** The window the simultaneity share is measured over. */
export const SIMULTANEITY_WINDOW_MS = 250

export async function decodeGrey(
  jpegBase64: string,
): Promise<{ width: number; height: number; data: Uint8Array }> {
  const { data, info } = await sharp(Buffer.from(jpegBase64, 'base64'))
    .resize({ width: METRICS_WIDTH })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

/** The mean absolute difference per pixel between two greyscale pictures of one size. */
export function frameChange(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error('frameChange: the two pictures differ in size')
  if (a.length === 0) return 0
  let total = 0
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i]! - b[i]!)
  return total / a.length
}

/**
 * The numbers from each shot's change against the one before it (`atMs` is
 * the later shot's time; the pair spans from the earlier shot to it).
 */
export function metricsFromChanges(
  changes: readonly { atMs: number; change: number }[],
  durationMs: number,
  stillMaxMs: number,
): MotionMetrics {
  const sorted = [...changes].sort((a, b) => a.atMs - b.atMs)
  let frozenMs = 0
  let longestFrozenMs = 0
  let run = 0
  let lastChangeAt: number | null = null
  let previousAt = 0
  for (const { atMs, change } of sorted) {
    const span = Math.max(0, atMs - previousAt)
    if (change < FROZEN_THRESHOLD) {
      frozenMs += span
      run += span
      longestFrozenMs = Math.max(longestFrozenMs, run)
    } else {
      run = 0
      lastChangeAt = atMs
    }
    previousAt = atMs
  }
  const total = sorted.reduce((sum, { change }) => sum + change, 0)
  let busiest = 0
  for (let i = 0; i < sorted.length; i += 1) {
    const from = sorted[i]!.atMs
    let inWindow = 0
    for (let j = i; j < sorted.length && sorted[j]!.atMs - from < SIMULTANEITY_WINDOW_MS; j += 1) {
      inWindow += sorted[j]!.change
    }
    busiest = Math.max(busiest, inWindow)
  }
  return {
    frozenMs: Math.round(frozenMs),
    longestFrozenMs: Math.round(longestFrozenMs),
    frozenCritical: longestFrozenMs > stillMaxMs,
    simultaneity: total > 0 ? Math.min(1, busiest / total) : 0,
    holdAfterLastMs: Math.max(0, Math.round(durationMs - (lastChangeAt ?? 0))),
    speedProfile: sorted.map(({ atMs, change }) => ({ atMs, change })),
  }
}

/**
 * The landscape shots in time order, each decoded and compared with the one
 * before it; null with fewer than two, since one picture has no motion.
 */
export async function motionMetrics(
  shots: readonly FrameShot[],
  durationMs: number,
  stillMaxMs: number,
): Promise<MotionMetrics | null> {
  const landscape = shots
    .filter((shot) => shot.orientation === 'landscape')
    .sort((a, b) => a.atMs - b.atMs)
  if (landscape.length < 2) return null
  const pictures = await Promise.all(landscape.map((shot) => decodeGrey(shot.jpeg)))
  const changes = landscape.slice(1).map((shot, index) => ({
    atMs: shot.atMs,
    change: frameChange(pictures[index]!.data, pictures[index + 1]!.data),
  }))
  return metricsFromChanges(changes, durationMs, stillMaxMs)
}
