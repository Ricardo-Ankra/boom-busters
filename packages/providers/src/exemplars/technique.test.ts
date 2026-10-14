import { describe, expect, it } from 'vitest'
import { techniqueFor } from './technique'
import type { TechniqueInput } from './technique'

const graphic = (over: Partial<TechniqueInput> = {}): TechniqueInput => ({
  type: 'graphic',
  intent: 'The money moved through three shell companies and two banks.',
  description: 'The route of the money.',
  coversText: 'The money moved through three shell companies and two banks.',
  logos: ['Acme', 'Beta Bank'],
  ...over,
})

const chart = (over: Partial<TechniqueInput> = {}): TechniqueInput => ({
  type: 'chart',
  chartKind: 'bar',
  seriesCount: 1,
  xLabels: ['2019', '2020', '2021'],
  intent: 'The debt grew every year.',
  description: 'The debt.',
  coversText: 'The debt grew every year.',
  logos: [],
  ...over,
})

describe('techniqueFor (decision 304)', () => {
  it.each([
    ['bar, one series', chart(), 'bar-chart'],
    ['stacked', chart({ chartKind: 'stacked' }), 'bar-chart'],
    ['line', chart({ chartKind: 'line' }), 'line-chart'],
    ['area', chart({ chartKind: 'area' }), 'line-chart'],
    ['waterfall', chart({ chartKind: 'waterfall' }), 'comparison-chart'],
    ['bar, two series', chart({ seriesCount: 2 }), 'comparison-chart'],
    [
      'bar, one series, five years',
      chart({ xLabels: ['2017', '2018', '2019', '2020', '2021'] }),
      'racing-chart',
    ],
    [
      'bar, one series, five labels that are not years',
      chart({ xLabels: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'] }),
      'bar-chart',
    ],
  ])('maps a chart by its kind and shape: %s', (_name, input, technique) => {
    expect(techniqueFor(input)).toBe(technique)
  })

  it('maps an empty chart to bar-chart', () => {
    expect(techniqueFor(chart({ seriesCount: 0, xLabels: [] }))).toBe('bar-chart')
    expect(
      techniqueFor({ type: 'chart', intent: '', description: '', coversText: '', logos: [] }),
    ).toBe('bar-chart')
  })

  it.each([
    ['a quotation', graphic({ coversText: '"We never saw it," he said.' }), 'quote-card'],
    ['said', graphic({ intent: 'The chairman said the money was safe.' }), 'quote-card'],
    ['a percentage sign', graphic({ intent: '40% of the money was gone.' }), 'donut-chart'],
    ['per cent', graphic({ intent: 'Forty per cent was gone.' }), 'donut-chart'],
    ['share of', graphic({ intent: 'The share of debt that was real.' }), 'donut-chart'],
    ['versus', graphic({ intent: 'Reported versus real.' }), 'split-screen'],
    ['side by side', graphic({ description: 'The two claims side by side.' }), 'split-screen'],
    [
      'a logo title in the intent',
      graphic({ intent: 'Acme was the name on every door.' }),
      'logo-reveal',
    ],
    ['two figures', graphic({ intent: 'Revenue of 4.2bn and a loss of 900m.' }), 'kpi-counter'],
    ['one figure', graphic({ intent: 'The company raised 1.2bn.' }), 'stat-counter'],
    ['a short intent', graphic({ intent: 'Nobody asked.' }), 'text-highlight'],
    ['the fallthrough', graphic(), 'kinetic-word-stack'],
  ])('maps a graphic by keyword: %s', (_name, input, technique) => {
    expect(techniqueFor(input)).toBe(technique)
  })

  it('picks the first rule that matches: a quotation with a figure is a quote card', () => {
    expect(techniqueFor(graphic({ intent: 'He said the £4bn was gone.' }))).toBe('quote-card')
    expect(techniqueFor(graphic({ intent: '40% of the 4bn was gone.' }))).toBe('donut-chart')
  })

  it('counts a figure by its unit or currency, not by every number', () => {
    expect(
      techniqueFor(graphic({ intent: 'In 2019 the three men met in a room above the bank.' })),
    ).toBe('kinetic-word-stack')
    expect(techniqueFor(graphic({ intent: 'The $4bn and the €900m were both gone.' }))).toBe(
      'kpi-counter',
    )
  })

  it('ignores a blank logo title and matches a title case-insensitively', () => {
    expect(techniqueFor(graphic({ logos: ['', '  '], intent: 'Acme was everywhere.' }))).toBe(
      'text-highlight',
    )
    expect(techniqueFor(graphic({ intent: 'ACME was everywhere.' }))).toBe('logo-reveal')
  })

  it.each([
    ['typewriter', 'typewriter'],
    ['make it a list', 'animated-list'],
    ['a lower third please', 'lower-third'],
    ['progress bar', 'progress-bars'],
    ['show the steps', 'progress-steps'],
    ['as a quote', 'quote-card'],
    ['a counter', 'stat-counter'],
    ['racing bars', 'racing-chart'],
    ['a donut', 'donut-chart'],
    ['pie', 'donut-chart'],
    ['split it', 'split-screen'],
    ['a chapter title', 'chapter-title'],
    ['the logo', 'logo-reveal'],
    ['highlight the phrase', 'text-highlight'],
    ['word stack', 'kinetic-word-stack'],
    ['kinetic', 'kinetic-word-stack'],
  ])('lets the steer "%s" choose the technique over every rule', (guidance, technique) => {
    expect(techniqueFor(chart({ guidance }))).toBe(technique)
    expect(techniqueFor(graphic({ guidance, intent: '"Quoted," he said.' }))).toBe(technique)
  })

  it('leaves a steer with no technique word to the rules', () => {
    expect(techniqueFor(graphic({ guidance: 'bigger and bolder' }))).toBe('kinetic-word-stack')
  })
})
