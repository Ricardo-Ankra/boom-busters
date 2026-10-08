import {
  GRAPHIC_BAR_GROW_MS,
  GRAPHIC_CAMERA_MOVE_MS,
  GRAPHIC_EXIT_MS,
  GRAPHIC_MAX_ZOOM,
  graphicOnScreen,
} from '@boom-busters/schemas'
import type {
  BrandKitTokens,
  EmphasisWindow,
  GraphicColor,
  GraphicScene,
} from '@boom-busters/schemas'
import { safeArea, tokenColor, type Box, type ElementBox, type GraphicFrame } from './graphic'
import { easeInOut } from './motion'

/**
 * A graphic over time (decision 290): exits, bars that grow one at a time and
 * rescale, colour shifts, timed emphasis and the camera. Pure and unit-tested,
 * like `graphic.ts`; `GraphicCard` reads it frame by frame, and the board's
 * preview reads the still moments, so the two never keep their own copies.
 */

/** Eased 0..1 through a span that starts at `atMs`: 0 before it, 1 after it. */
export function spanProgress(timeMs: number, atMs: number, durationMs: number): number {
  const t = timeMs - atMs
  if (t <= 0) return 0
  return easeInOut(Math.min(1, t / durationMs))
}

/** How far an exit has gone at this time. */
export function exitProgress(timeMs: number, exitAtMs: number): number {
  return spanProgress(timeMs, exitAtMs, GRAPHIC_EXIT_MS)
}

/** How far one bar has grown at this time. */
export function barGrowth(timeMs: number, atMs: number): number {
  return spanProgress(timeMs, atMs, GRAPHIC_BAR_GROW_MS)
}

/**
 * The value a full-length bar stands for at this time. Bars that grow at the
 * entrance set it at once, as they always have, never below 1 (stage 1's
 * floor). A later, larger bar eases it up over the 700 ms it grows, so the
 * bars already there shrink to their share as it arrives; a smaller one
 * leaves it where it is. It never comes back down.
 */
export function barScale(
  items: readonly { value: number; atMs: number }[],
  timeMs: number,
): number {
  if (items.length === 0) return 1
  const first = Math.min(...items.map((item) => item.atMs))
  let scale = Math.max(
    1,
    ...items.filter((item) => item.atMs === first).map((item) => Math.abs(item.value)),
  )
  const later = [...new Set(items.map((item) => item.atMs).filter((at) => at > first))].sort(
    (a, b) => a - b,
  )
  for (const at of later) {
    const growth = barGrowth(timeMs, at)
    if (growth <= 0) break
    const target = Math.max(
      scale,
      ...items.filter((item) => item.atMs === at).map((item) => Math.abs(item.value)),
    )
    scale += (target - scale) * growth
  }
  return scale
}

/** The scale once every bar grown by `timeMs` has finished growing: what a still frame shows. */
export function settledBarScale(
  items: readonly { value: number; atMs: number }[],
  timeMs: number,
): number {
  if (items.length === 0) return 1
  const first = Math.min(...items.map((item) => item.atMs))
  const grown = items.filter((item) => item.atMs === first || item.atMs <= timeMs)
  return Math.max(1, ...grown.map((item) => Math.abs(item.value)))
}

/** A blend of two `#rrggbb` colours, `t` of the way from `from` to `to`. */
export function mixColor(from: string, to: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t))
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const mixed = [1, 3, 5].map((at) =>
    Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * clamped),
  )
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/**
 * An element's colour at this time: its own token, blended over 400 ms to the
 * token a colour emphasis names once that emphasis starts, and held there.
 * With no colour emphasis it is the token itself, exactly as stage 1 drew it.
 */
export function elementColorAt(
  color: GraphicColor,
  window: EmphasisWindow | null,
  timeMs: number,
  brand: BrandKitTokens,
): string {
  const own = tokenColor(color, brand)
  if (window?.kind !== 'color' || window.to === undefined) return own
  const shift = spanProgress(timeMs, window.atMs, window.durationMs)
  if (shift <= 0) return own
  return mixColor(own, tokenColor(window.to as GraphicColor, brand), shift)
}

/** The colour token a still frame of this moment draws an element in. */
export function colorTokenAt(
  color: GraphicColor,
  window: EmphasisWindow | null,
  timeMs: number,
): GraphicColor {
  return window?.kind === 'color' && window.to !== undefined && window.atMs <= timeMs
    ? (window.to as GraphicColor)
    : color
}

/** The pulse emphasis: a 4% swell and back across its window. */
export function pulseScaleAt(timeMs: number, window: EmphasisWindow | null): number {
  if (window?.kind !== 'pulse') return 1
  const t = timeMs - window.atMs
  if (t <= 0 || t >= window.durationMs) return 1
  return 1 + 0.04 * Math.sin((t / window.durationMs) * Math.PI)
}

/** The underline emphasis's sweep, 0 to 1, or undefined when the element has none. */
export function underlineSweepAt(
  timeMs: number,
  window: EmphasisWindow | null,
): number | undefined {
  if (window?.kind !== 'underline') return undefined
  return spanProgress(timeMs, window.atMs, window.durationMs)
}

/** Where the camera sits: `translate(x, y) scale(scale)` about the frame's top-left corner. */
export interface CameraView {
  scale: number
  x: number
  y: number
}

export const CAMERA_REST: CameraView = { scale: 1, x: 0, y: 0 }

/**
 * The camera framing `focus` (a laid-out box, or null for the whole
 * composition) at `zoom`: the box's centre aimed at the safe area's centre,
 * the zoom capped so the box still fits the safe area (a push in never puts
 * it under the captions), and the pan capped so the composition's edges never
 * come inside the frame. At zoom 1 there is nowhere to pan.
 */
export function cameraFraming(focus: Box | null, zoom: number, frame: GraphicFrame): CameraView {
  const safe = safeArea(frame)
  const fit = focus ? Math.min(safe.w / focus.w, safe.h / focus.h) : Number.POSITIVE_INFINITY
  const scale = Math.max(1, Math.min(zoom, GRAPHIC_MAX_ZOOM, fit))
  const box = focus ?? safe
  const target = { x: safe.x + safe.w / 2, y: safe.y + safe.h / 2 }
  const clamp = (value: number, size: number) => Math.min(0, Math.max(size * (1 - scale), value))
  return {
    scale,
    x: clamp(target.x - scale * (box.x + box.w / 2), frame.width),
    y: clamp(target.y - scale * (box.y + box.h / 2), frame.height),
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * The camera at this time (decision 290): at rest until the first key, then
 * each key's move eased over `GRAPHIC_CAMERA_MOVE_MS` from wherever the camera
 * was, holding between keys. It frames laid-out boxes, so one track serves
 * 16:9 and 9:16 alike. A scene with no camera is always at rest.
 */
export function graphicCamera(
  scene: GraphicScene,
  boxes: readonly ElementBox[],
  frame: GraphicFrame,
  timeMs: number,
): CameraView {
  const keys = [...(scene.camera ?? [])].sort((a, b) => a.atMs - b.atMs)
  let view = CAMERA_REST
  for (const key of keys) {
    if (timeMs <= key.atMs) break
    const box = key.focus === 'all' ? null : (boxes.find((b) => b.id === key.focus) ?? null)
    const target = cameraFraming(box, key.zoom, frame)
    const p = spanProgress(timeMs, key.atMs, GRAPHIC_CAMERA_MOVE_MS)
    view = {
      scale: lerp(view.scale, target.scale, p),
      x: lerp(view.x, target.x, p),
      y: lerp(view.y, target.y, p),
    }
  }
  return view
}

/** Which elements a still frame of this moment shows: entered by it, not yet leaving. */
export function onScreenAt(scene: GraphicScene, timeMs: number): Set<string> {
  const ids = new Set<string>()
  for (const [id, span] of graphicOnScreen(scene)) {
    if (span.fromMs <= timeMs && timeMs < span.toMs) ids.add(id)
  }
  return ids
}
