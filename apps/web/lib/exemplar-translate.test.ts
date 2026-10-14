// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MANIFEST } from '@boom-busters/providers'
import {
  designHeader,
  exemplarBrief,
  exemplarContext,
  exemplarInput,
  parseExemplarArgs,
  renderDesignFile,
  renderRegistry,
  staleDesign,
  storedHash,
  TRANSLATE_STEER,
  vendoredHash,
} from './exemplar-translate'

const stat = MANIFEST.find((entry) => entry.id === 'stat-counter')!
const bar = MANIFEST.find((entry) => entry.id === 'bar-chart')!

describe('exemplar translation, the pure parts (decision 304)', () => {
  it('hashes a vendored file the same whatever its line endings', () => {
    expect(vendoredHash('a\r\nb\r\n')).toBe(vendoredHash('a\nb\n'))
    expect(vendoredHash('a\nb\n')).toMatch(/^[0-9a-f]{64}$/)
    expect(vendoredHash('a\nb\n')).not.toBe(vendoredHash('a\nc\n'))
  })

  it('renders a design file whose header carries the vendored hash, and reads it back', () => {
    const hash = vendoredHash('x')
    const file = renderDesignFile(stat, hash, {
      title: 'The 1.2bn',
      source: 'function Graphic() {\n  return `a${1}`\n}',
      facts: [{ text: '1.2bn', claim: 1 }],
    })
    expect(file).toContain(designHeader(stat, hash))
    expect(file).toContain('vendored/rve/stat-counter.tsx.txt')
    expect(file).toContain(`vendored sha256: ${hash}`)
    expect(storedHash(file)).toBe(hash)
    expect(file).toContain('export const DESIGN')
    expect(file).toContain('facts: [{"text":"1.2bn","claim":1}]')
    // The source round-trips through a JSON string, so backticks and ${ are safe.
    const match = /source: ("(?:[^"\\]|\\.)*")/.exec(file)
    expect(JSON.parse(match![1]!)).toBe('function Graphic() {\n  return `a${1}`\n}')
    expect(file).not.toMatch(/[–—]/)
  })

  it('staleDesign names the file whose hash moved, and is quiet when nothing is stored or it matches', () => {
    const hash = vendoredHash('the template')
    const file = renderDesignFile(stat, hash, { title: 't', source: 's', facts: [] })
    expect(staleDesign(stat, 'the template', file)).toBeNull()
    expect(staleDesign(stat, 'the template', undefined)).toBeNull()
    expect(staleDesign(stat, 'the template, changed', file)).toBe(
      'stat-counter: vendored/rve/stat-counter.tsx.txt changed since its design was written',
    )
  })

  it('derives a context whose claims hold every figure the slot speaks or charts', () => {
    const context = exemplarContext(bar)
    expect(context.caseTitle).toBe('Exemplar')
    expect(context.chapterTitle).toBe('bar-chart')
    expect(context.logos).toEqual([
      { id: '01J00000000000000000000EX1', title: 'Acme', width: 1200, height: 400 },
    ])
    const texts = context.claims.map((claim) => claim.text)
    for (const year of ['2019', '2020', '2021', '2022']) {
      expect(texts.some((text) => text.includes(year))).toBe(true)
    }
    expect(texts).toContain('In 2022 the value was 4 bn.')
    expect(exemplarContext(stat).claims.map((claim) => claim.text)).toContain(
      'The figure is 1.2bn.',
    )
    expect(new Set(context.claims.map((claim) => claim.id)).size).toBe(context.claims.length)
  })

  it('builds a chart brief for a chart technique and a graphic brief otherwise, citing every claim', () => {
    const chart = exemplarBrief(bar, exemplarContext(bar))
    expect(chart.type).toBe('chart')
    if (chart.type === 'chart') {
      expect(chart.chartKind).toBe('bar')
      expect(chart.series).toEqual(bar.slot.data!.series)
      expect(chart.takeaway).toBe(bar.slot.data!.takeaway)
      expect(chart.dataRefs.length).toBeGreaterThan(0)
    }
    const graphic = exemplarBrief(stat, exemplarContext(stat))
    expect(graphic.type).toBe('graphic')
    if (graphic.type === 'graphic') {
      expect(graphic.intent).toBe(stat.slot.intent)
      expect(graphic.intentClaimIds!.length).toBe(exemplarContext(stat).claims.length)
    }
  })

  it('builds the designer input with the steer and the template in a four-backtick fence, and no exemplar', () => {
    const input = exemplarInput(stat, 'const x = `tpl`\n```\n')
    expect(input.caseTitle).toBe('Exemplar')
    expect(input.words).toEqual(
      stat.slot.words.map((word) => ({ text: word.text, offsetMs: word.atMs })),
    )
    expect(input.wordsEstimated).toBe(false)
    expect(input.intent).toBe(stat.slot.intent)
    expect(input.intentRefs.length).toBe(exemplarContext(stat).claims.length)
    expect(input.guidance).toContain(TRANSLATE_STEER)
    expect(input.guidance).toContain('````tsx\nconst x = `tpl`\n```\n\n````')
    expect(input.exemplar).toBeUndefined()
    expect(input.current).toBeUndefined()
    expect(input.data).toBeUndefined()
    expect(exemplarInput(bar, 't').data).toEqual(bar.slot.data)
  })

  it('renders the registry in sorted order, as one import per design', () => {
    const file = renderRegistry(['stat-counter', 'bar-chart'])
    expect(file).toContain("import { DESIGN as barChart } from './bar-chart'")
    expect(file).toContain("import { DESIGN as statCounter } from './stat-counter'")
    expect(file.indexOf('barChart')).toBeLessThan(file.indexOf('statCounter'))
    expect(file).toContain("'bar-chart': barChart,")
    expect(file).toContain('export const DESIGNS: Partial<Record<Technique, ExemplarDesign>> = {')
    expect(renderRegistry([])).toContain('= {}')
    expect(renderRegistry([])).toBe(
      readFileSync(
        new URL('../../../packages/providers/src/exemplars/designs/index.ts', import.meta.url),
        'utf8',
      ),
    )
  })

  it('parses the cap (default 1, at most 5), --only and --model', () => {
    expect(parseExemplarArgs([])).toEqual({ cap: 1, model: 'claude-opus-5-5' })
    expect(
      parseExemplarArgs(['--cap', '3', '--only', 'stat-counter', '--model', 'claude-sonnet-5-5']),
    ).toEqual({
      cap: 3,
      only: 'stat-counter',
      model: 'claude-sonnet-5-5',
    })
    expect(() => parseExemplarArgs(['--cap', '6'])).toThrow(
      "A cap above $5 needs the owner's approval first.",
    )
    expect(() => parseExemplarArgs(['--cap', 'abc'])).toThrow('not a valid dollar amount')
    expect(() => parseExemplarArgs(['--only', 'nope'])).toThrow(
      '--only "nope" is not a manifest id',
    )
  })
})
