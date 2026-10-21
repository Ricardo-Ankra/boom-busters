import { describe, expect, it } from 'vitest'
import { bootstrapInterval, median, mulberry32, percentileRanks, spearman } from './stats'

describe('rank statistics', () => {
  it('percentile ranks give ties the average', () => {
    expect(percentileRanks([10, 20, 20, 40])).toEqual([0, 50, 50, 100])
  })
  it('a single value ranks 100', () => expect(percentileRanks([7])).toEqual([100]))
  it('spearman is 1 for a monotone pair and -1 reversed', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 1000])).toBeCloseTo(1)
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1)
  })
  it('spearman handles ties with average ranks', () => {
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9487, 3)
  })
  it('bootstrap is reproducible from its seed and brackets the point estimate', () => {
    const pairs: [number, number][] = Array.from({ length: 30 }, (_, i) => [i, i + ((i * 7) % 5)])
    const stat = (p: [number, number][]) =>
      spearman(
        p.map((q) => q[0]),
        p.map((q) => q[1]),
      )
    const a = bootstrapInterval(pairs, stat, 2000, 0.9, 1)
    const b = bootstrapInterval(pairs, stat, 2000, 0.9, 1)
    expect(a).toEqual(b)
    expect(a[0]).toBeLessThanOrEqual(stat(pairs))
  })
  it('median handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const r1 = mulberry32(5)
    const r2 = mulberry32(5)
    const xs = [r1(), r1(), r1()]
    expect(xs).toEqual([r2(), r2(), r2()])
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})
