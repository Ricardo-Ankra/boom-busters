import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, emphasisWindow, resolveBrandKit } from '@boom-busters/schemas'
import type { GraphicScene } from '@boom-busters/schemas'
import { safeArea, tokenColor } from './graphic'
import {
  barGrowth,
  barScale,
  CAMERA_REST,
  cameraFraming,
  colorTokenAt,
  elementColorAt,
  exitProgress,
  exitStyle,
  graphicCamera,
  mixColor,
  onScreenAt,
  pulseScaleAt,
  settledBarScale,
  spanProgress,
  underlineSweepAt,
} from './graphic-motion'

const brand = resolveBrandKit(DEFAULT_SETTINGS)
const WIDE = { width: 1920, height: 1080 }

describe('spans, exits and bars growing', () => {
  it('eases 0 to 1 across a span, 0 before it and 1 after', () => {
    expect(spanProgress(900, 1000, 500)).toBe(0)
    expect(spanProgress(1250, 1000, 500)).toBeCloseTo(0.5)
    expect(spanProgress(2000, 1000, 500)).toBe(1)
  })

  it('takes 500 ms to leave and 700 ms to grow a bar', () => {
    expect(exitProgress(4250, 4000)).toBeCloseTo(0.5)
    expect(exitProgress(4500, 4000)).toBe(1)
    expect(barGrowth(2350, 2000)).toBeCloseTo(0.5)
    expect(barGrowth(2700, 2000)).toBe(1)
  })
})

describe('barScale: the value a full-length bar stands for', () => {
  it('holds still for bars that all grow at the entrance, as stage 1 drew them', () => {
    const items = [
      { value: 4, atMs: 300 },
      { value: 3.9, atMs: 300 },
    ]
    expect(barScale(items, 0)).toBe(4)
    expect(barScale(items, 5000)).toBe(4)
  })

  it('keeps stage 1 floor of 1 for small values', () => {
    expect(
      barScale(
        [
          { value: 0.5, atMs: 0 },
          { value: 0.3, atMs: 0 },
        ],
        1000,
      ),
    ).toBe(1)
  })

  it('eases up to a larger bar while it grows, so the first shrinks to its share', () => {
    const items = [
      { value: 1, atMs: 300 },
      { value: 4, atMs: 10_000 },
    ]
    expect(barScale(items, 5000)).toBe(1)
    expect(barScale(items, 10_350)).toBeCloseTo(2.5)
    expect(barScale(items, 11_000)).toBe(4)
  })

  it('never comes back down for a smaller later bar (a decline)', () => {
    const items = [
      { value: 4, atMs: 300 },
      { value: 1, atMs: 10_000 },
    ]
    expect(barScale(items, 10_350)).toBe(4)
    expect(barScale(items, 11_000)).toBe(4)
  })

  it('settles at the largest bar grown by a moment, for a still frame', () => {
    const items = [
      { value: 1, atMs: 300 },
      { value: 4, atMs: 10_000 },
    ]
    expect(settledBarScale(items, 5000)).toBe(1)
    expect(settledBarScale(items, 10_000)).toBe(4)
  })
})

describe('colour, pulse and underline at a time', () => {
  it('blends two hex colours', () => {
    expect(mixColor('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixColor('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('shifts an element to its colour emphasis and holds it there', () => {
    const shift = emphasisWindow({ kind: 'color', atMs: 5000, to: 'collapse' }, 0)
    const own = tokenColor('accent', brand)
    const target = tokenColor('collapse', brand)
    expect(elementColorAt('accent', shift, 4000, brand)).toBe(own)
    expect(elementColorAt('accent', shift, 5200, brand)).toBe(mixColor(own, target, 0.5))
    expect(elementColorAt('accent', shift, 9000, brand)).toBe(mixColor(own, target, 1))
    // No colour emphasis: the token itself, exactly as stage 1 drew it.
    expect(elementColorAt('accent', emphasisWindow('pulse', 0), 9000, brand)).toBe(own)
    expect(colorTokenAt('accent', shift, 4999)).toBe('accent')
    expect(colorTokenAt('accent', shift, 5000)).toBe('collapse')
  })

  it('pulses and sweeps where stage 1 did for the word forms', () => {
    // Word-form pulse on an element entering at 1000 ms: 1600 to 1960 ms, peak 4% at 1780.
    const pulse = emphasisWindow('pulse', 1000)
    expect(pulseScaleAt(1600, pulse)).toBe(1)
    expect(pulseScaleAt(1780, pulse)).toBeCloseTo(1.04)
    expect(pulseScaleAt(1960, pulse)).toBe(1)
    // Word-form underline: its sweep runs 1500 to 2100 ms.
    const underline = emphasisWindow('underline', 1000)
    expect(underlineSweepAt(1500, underline)).toBe(0)
    expect(underlineSweepAt(1800, underline)).toBeCloseTo(0.5)
    expect(underlineSweepAt(9000, underline)).toBe(1)
    expect(underlineSweepAt(9000, pulse)).toBeUndefined()
  })
})

describe('the camera', () => {
  const safe = safeArea(WIDE)
  const centre = { x: safe.x + safe.w / 2, y: safe.y + safe.h / 2 }

  it('frames "all" at rest whatever its zoom', () => {
    expect(cameraFraming(null, 1.3, WIDE)).toEqual(CAMERA_REST)
  })

  it('caps the zoom and the pan in 9:16 too', () => {
    const TALL = { width: 1080, height: 1920 }
    const tall = safeArea(TALL)
    // A box as wide as the safe area has no room to be pushed in.
    expect(cameraFraming({ x: tall.x, y: tall.y + 100, w: tall.w, h: 200 }, 1.5, TALL).scale).toBe(
      1,
    )
    // A box near the bottom-right corner: the pan stops at the composition's edge.
    const view = cameraFraming({ x: 900, y: 1500, w: 100, h: 100 }, 1.5, TALL)
    expect(view.x).toBeCloseTo(TALL.width * (1 - 1.5))
    expect(view.y).toBeGreaterThanOrEqual(TALL.height * (1 - 1.5))
    expect(view.y).toBeLessThanOrEqual(0)
  })

  it('cannot pan at zoom 1', () => {
    expect(cameraFraming({ x: 1400, y: 200, w: 300, h: 200 }, 1, WIDE)).toEqual(CAMERA_REST)
  })

  it('puts a box at the safe area centre', () => {
    const box = { x: centre.x - 200, y: centre.y - 100, w: 400, h: 200 }
    const view = cameraFraming(box, 1.4, WIDE)
    expect(view.scale).toBe(1.4)
    expect(view.x + view.scale * centre.x).toBeCloseTo(centre.x)
    expect(view.y + view.scale * centre.y).toBeCloseTo(centre.y)
  })

  it('caps the pan so the composition edges never come inside the frame', () => {
    const view = cameraFraming({ x: 1700, y: 60, w: 180, h: 120 }, 1.5, WIDE)
    expect(view.x).toBeCloseTo(WIDE.width * (1 - 1.5))
    expect(view.y).toBe(0)
  })

  it('caps the zoom so the box still fits the safe area', () => {
    const box = { x: safe.x, y: safe.y, w: safe.w / 1.2, h: safe.h / 2 }
    expect(cameraFraming(box, 1.6, WIDE).scale).toBeCloseTo(1.2)
  })

  it('rests until the first key, moves over 1.5 s, holds, and moves on from there', () => {
    const scene: GraphicScene = {
      elements: [
        {
          kind: 'text',
          id: 'a',
          cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
          content: 'a',
          role: 'title',
          color: 'textPrimary',
          align: 'start',
          enter: { kind: 'fade', atMs: 0 },
        },
      ],
      camera: [
        { atMs: 2000, focus: 'a', zoom: 1.4 },
        { atMs: 6000, focus: 'all', zoom: 1 },
      ],
    }
    const boxes = [{ id: 'a', x: 100, y: 100, w: 600, h: 200 }]
    const framed = cameraFraming(boxes[0]!, 1.4, WIDE)
    expect(graphicCamera(scene, boxes, WIDE, 1000)).toEqual(CAMERA_REST)
    expect(graphicCamera(scene, boxes, WIDE, 2750).scale).toBeCloseTo(1.2)
    expect(graphicCamera(scene, boxes, WIDE, 5000)).toEqual(framed)
    expect(graphicCamera(scene, boxes, WIDE, 9000)).toEqual(CAMERA_REST)
    expect(graphicCamera({ elements: scene.elements }, boxes, WIDE, 5000)).toEqual(CAMERA_REST)
  })
})

describe('onScreenAt: what a still frame of a moment shows', () => {
  it('shows what has entered and has not started to leave', () => {
    const scene: GraphicScene = {
      elements: (['a', 'b'] as const).map((id, index) => ({
        kind: 'text' as const,
        id,
        cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
        content: id,
        role: 'title' as const,
        color: 'textPrimary' as const,
        align: 'start' as const,
        enter: { kind: 'fade' as const, atMs: index * 4000 },
        ...(index === 0 ? { exit: { kind: 'fade' as const, atMs: 4000 } } : {}),
      })),
    }
    expect([...onScreenAt(scene, 3999)]).toEqual(['a'])
    expect([...onScreenAt(scene, 4000)]).toEqual(['b'])
    expect([...onScreenAt(scene, Number.MAX_SAFE_INTEGER)]).toEqual(['b'])
  })
})

describe('exitStyle', () => {
  it('fades, drops and wipes in proportion to the exit', () => {
    expect(exitStyle('fade', 0.5, 1)).toEqual({ opacity: 0.5 })
    expect(exitStyle('drop', 0.5, 2)).toEqual({ opacity: 0.5, transform: 'translateY(24px)' })
    expect(exitStyle('wipe', 0.25, 1)).toEqual({ clipPath: 'inset(0 0 0 25%)' })
  })

  it('starts where the entrance left the element', () => {
    expect(exitStyle('fade', 0, 1)).toEqual({ opacity: 1 })
    expect(exitStyle('drop', 0, 1)).toEqual({ opacity: 1, transform: 'translateY(0px)' })
    expect(exitStyle('wipe', 0, 1)).toEqual({ clipPath: 'inset(0 0 0 0%)' })
  })
})
