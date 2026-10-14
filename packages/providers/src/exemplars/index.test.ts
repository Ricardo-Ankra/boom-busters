import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESIGNS } from './designs/index'
import { exemplarFor, exemplars, MANIFEST, TECHNIQUES, techniqueFor, vendoredPath } from './index'

const HERE = new URL('./', import.meta.url)
const DASH = /[–—]/

describe('the exemplar manifest (decision 305)', () => {
  it('has exactly one entry per technique, under the technique as its id', () => {
    expect(MANIFEST.map((entry) => entry.technique).sort()).toEqual([...TECHNIQUES].sort())
    for (const entry of MANIFEST) expect(entry.id).toBe(entry.technique)
  })

  it('names a vendored file that exists, beside its licence', () => {
    for (const entry of MANIFEST) {
      const file = new URL(vendoredPath(entry), HERE)
      expect(existsSync(file), `${entry.id}: ${vendoredPath(entry)}`).toBe(true)
      expect(readFileSync(file, 'utf8').length).toBeGreaterThan(200)
      expect(existsSync(new URL(`vendored/${entry.source.repo}/LICENSE`, HERE))).toBe(true)
    }
  })

  it('pins each source to one of the two fetched commits', () => {
    for (const entry of MANIFEST) {
      expect(entry.source.commit).toBe(
        entry.source.repo === 'rendercomp'
          ? 'f648980e528defb7594e24c6447055f0540f340b'
          : '6209b724798e48ff395f8df1a6fa2d26082372b5',
      )
    }
  })

  it('gives every entry a synthetic slot with timed words, and data on the chart techniques', () => {
    for (const entry of MANIFEST) {
      expect(entry.slot.durationMs).toBeGreaterThanOrEqual(4000)
      expect(entry.slot.words.length).toBeGreaterThanOrEqual(3)
      let last = -1
      for (const word of entry.slot.words) {
        expect(word.atMs).toBeGreaterThanOrEqual(last)
        expect(word.atMs).toBeLessThan(entry.slot.durationMs)
        last = word.atMs
      }
      if (entry.chart) {
        expect(entry.slot.data).toBeDefined()
        expect(entry.slot.data!.series[0]!.points.length).toBeGreaterThanOrEqual(2)
      } else {
        expect(entry.slot.data).toBeUndefined()
      }
      expect(entry.description).not.toMatch(DASH)
      expect(entry.slot.intent).not.toMatch(DASH)
    }
  })

  it('gives each chart technique a slot the rules pick for that technique', () => {
    for (const entry of MANIFEST.filter((candidate) => candidate.chart)) {
      const series = entry.slot.data!.series
      expect(
        techniqueFor({
          type: 'chart',
          chartKind: entry.chart!.kind,
          seriesCount: series.length,
          xLabels: series[0]!.points.map((point) => point.x),
          intent: entry.slot.data!.takeaway,
          description: entry.description,
          coversText: entry.slot.words.map((word) => word.text).join(' '),
          logos: [],
        }),
        entry.id,
      ).toBe(entry.technique)
    }
  })

  it('gives the racing slot series whose order changes from year to year', () => {
    const racing = MANIFEST.find((entry) => entry.technique === 'racing-chart')!
    const series = racing.slot.data!.series
    expect(series.length).toBeGreaterThanOrEqual(3)
    const leaders = series[0]!.points.map((_, index) =>
      [...series]
        .sort((a, b) => b.points[index]!.y - a.points[index]!.y)
        .map((s) => s.label)
        .join(),
    )
    const changes = leaders.filter((order, index) => index > 0 && order !== leaders[index - 1])
    expect(changes.length).toBeGreaterThanOrEqual(2)
  })

  it('returns nothing for a technique with no stored design, and the design when one is stored', () => {
    for (const technique of TECHNIQUES) {
      const stored = DESIGNS[technique]
      const found = exemplarFor(technique)
      if (stored === undefined) {
        expect(found).toBeUndefined()
      } else {
        expect(found).toEqual({
          technique,
          description: MANIFEST.find((entry) => entry.technique === technique)!.description,
          title: stored.title,
          source: stored.source,
        })
        expect(stored.source).not.toMatch(DASH)
        expect(stored.title).not.toMatch(DASH)
      }
    }
    expect(exemplars().map((entry) => entry.id)).toEqual(MANIFEST.map((entry) => entry.id))
  })
})
