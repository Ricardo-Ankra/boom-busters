import { Easing } from 'remotion'
import { describe, expect, it } from 'vitest'
import {
  MOTION_EASE_NAMES,
  MOTION_PREAMBLE,
  MOTION_SPRING,
  MOTION_SPRING_NAMES,
  MOTION_VERSION,
  motionFrames,
  motionStagger,
  motionTokens,
} from './motion-tokens'
import type { MotionTokens } from './motion-tokens'

/**
 * The preamble as the sandbox evaluates it: inside a strict function body
 * with `Remotion` in scope, and the `motion` it declares handed back.
 */
const evaluated = new Function('Remotion', `"use strict";\n${MOTION_PREAMBLE}\nreturn motion`)({
  Easing,
}) as MotionTokens
const typed = motionTokens(Easing)
const SAMPLES = Array.from({ length: 11 }, (_, i) => i / 10)

/** Every object reachable from `value` through own enumerable properties. */
function objectsIn(value: unknown, found: object[] = []): object[] {
  if (typeof value !== 'object' || value === null) return found
  found.push(value)
  for (const child of Object.values(value)) objectsIn(child, found)
  return found
}

describe('motion tokens (decision 301)', () => {
  it('declares in the preamble the numbers the typed object holds', () => {
    expect(MOTION_VERSION).toBe(1)
    expect(evaluated.ms).toEqual(typed.ms)
    expect(evaluated.ms).toEqual({
      micro: 120,
      enter: 450,
      exit: 300,
      reveal: 550,
      draw: 700,
      count: 1000,
      move: 900,
      gap: 120,
    })
    expect(evaluated.spring).toEqual(typed.spring)
    expect(evaluated.spring).toEqual({
      settle: { damping: 200 },
      hero: { damping: 14, stiffness: 120 },
      snap: { damping: 20, stiffness: 200 },
    })
    expect(evaluated.px).toEqual({ rise: 20 })
    expect(evaluated.scale).toEqual({ enter: 0.96 })
    expect(evaluated.order).toEqual(['frame', 'title', 'body', 'hero', 'note'])
    expect(evaluated.px).toEqual(typed.px)
    expect(evaluated.scale).toEqual(typed.scale)
    expect(evaluated.order).toEqual(typed.order)
  })

  it('declares the same five curves, sampled at ten points', () => {
    expect(Object.keys(evaluated.ease).sort()).toEqual([...MOTION_EASE_NAMES].sort())
    expect(Object.keys(evaluated.spring).sort()).toEqual([...MOTION_SPRING_NAMES].sort())
    expect(Object.keys(MOTION_SPRING).sort()).toEqual([...MOTION_SPRING_NAMES].sort())
    expect(Object.keys(typed.ease).sort()).toEqual([...MOTION_EASE_NAMES].sort())
    for (const name of MOTION_EASE_NAMES) {
      expect(SAMPLES.map(evaluated.ease[name])).toEqual(SAMPLES.map(typed.ease[name]))
    }
  })

  it('eases arrivals out, departures in, moves both ways, emphasis hard, and linear straight', () => {
    for (const name of MOTION_EASE_NAMES) {
      expect(typed.ease[name](0)).toBeCloseTo(0, 2)
      expect(typed.ease[name](1)).toBeCloseTo(1, 2)
    }
    expect(typed.ease.enter(0.5)).toBeGreaterThan(0.9)
    expect(typed.ease.exit(0.5)).toBeLessThan(0.15)
    expect(typed.ease.move(0.5)).toBeCloseTo(0.5, 5)
    expect(typed.ease.emphasis(0.5)).toBeGreaterThan(0.95)
    expect(typed.ease.linear(0.3)).toBe(0.3)
  })

  it('counts frames and staggers at the edges, the same in both forms', () => {
    expect(motionFrames(1, 30)).toBe(1)
    expect(motionFrames(0, 30)).toBe(1)
    expect(motionFrames(450, 30)).toBe(14)
    expect(motionFrames(1000, 30)).toBe(30)
    expect(motionStagger(0, 30)).toBe(0)
    expect(motionStagger(1, 30)).toBe(2)
    expect(motionStagger(8, 30)).toBe(18)
    expect(motionStagger(20, 30)).toBe(18)
    for (const [ms, fps] of [
      [0, 30],
      [1, 30],
      [450, 30],
      [333, 25],
    ]) {
      expect(evaluated.frames(ms!, fps!)).toBe(typed.frames(ms!, fps!))
    }
    for (const index of [0, 1, 7, 8, 20]) {
      expect(evaluated.stagger(index, 30)).toBe(typed.stagger(index, 30))
    }
  })

  it('is frozen through, in both forms, so a design cannot change a token', () => {
    for (const form of [evaluated, typed]) {
      for (const object of objectsIn(form)) expect(Object.isFrozen(object)).toBe(true)
    }
    const mutable = evaluated as unknown as { ms: { enter: number } }
    expect(() => {
      mutable.ms.enter = 1
    }).toThrow(TypeError)
    expect(evaluated.ms.enter).toBe(450)
  })

  it('reads only Remotion.Easing from its scope', () => {
    expect(MOTION_PREAMBLE).toMatch(/^\/\/ The house motion tokens/)
    expect(MOTION_PREAMBLE).toContain('const motion = Object.freeze({')
    const identifiers = MOTION_PREAMBLE.match(/\bRemotion\s*\.\s*(\w+)/g) ?? []
    expect(new Set(identifiers)).toEqual(new Set(['Remotion.Easing']))
    const code = MOTION_PREAMBLE.split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/\b(props|React|window|require|import)\b/)
  })
})
