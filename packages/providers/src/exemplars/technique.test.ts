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
    ['as a list', 'animated-list'],
    ['a bulleted list', 'animated-list'],
    ['a lower third please', 'lower-third'],
    ['a progress bar', 'progress-bars'],
    ['progress steps', 'progress-steps'],
    ['step by step', 'progress-steps'],
    ['a split screen', 'split-screen'],
    ['side by side', 'split-screen'],
    ['a quote card', 'quote-card'],
    ['as a quote', 'quote-card'],
    ['a pull quote', 'quote-card'],
    ['a stat counter', 'stat-counter'],
    ['count up', 'stat-counter'],
    ['racing bars', 'racing-chart'],
    ['a bar race', 'racing-chart'],
    ['a donut', 'donut-chart'],
    ['pie', 'donut-chart'],
    ['a chapter title', 'chapter-title'],
    ['a logo reveal', 'logo-reveal'],
    ['reveal the logo', 'logo-reveal'],
    ['highlight the phrase', 'text-highlight'],
    ['word stack', 'kinetic-word-stack'],
    ['kinetic', 'kinetic-word-stack'],
  ])('lets the steer "%s" choose the technique over every rule', (guidance, technique) => {
    expect(techniqueFor(chart({ guidance }))).toBe(technique)
    expect(techniqueFor(graphic({ guidance, intent: '"Quoted," he said.' }))).toBe(technique)
  })

  it.each([
    'bigger and bolder',
    'split the title onto two lines',
    'list fewer words',
    'fewer steps in the animation',
    'make the logo bigger',
    'the counter should be slower',
    'no quote please',
    "don't highlight anything",
    'without a progress bar',
  ])('leaves the steer "%s" to the rules', (guidance) => {
    expect(techniqueFor(graphic({ guidance }))).toBe('kinetic-word-stack')
  })

  it('reads a curly apostrophe in a refusal', () => {
    expect(techniqueFor(graphic({ guidance: 'don’t highlight anything' }))).toBe(
      'kinetic-word-stack',
    )
  })

  it('counts distinct figures across the three fields', () => {
    expect(
      techniqueFor(
        graphic({ intent: 'The company raised 1.2bn.', coversText: 'It raised 1.2bn in March.' }),
      ),
    ).toBe('stat-counter')
    expect(
      techniqueFor(
        graphic({
          intent: 'Revenue of 4.2bn and a loss of 900m.',
          coversText: 'Revenue of 4.2bn and a loss of 900m.',
        }),
      ),
    ).toBe('kpi-counter')
    expect(
      techniqueFor(graphic({ intent: 'It raised $4bn.', coversText: 'It raised $ 4bn.' })),
    ).toBe('stat-counter')
  })

  it('matches a logo title as a whole word only', () => {
    const intent = 'The bank was running out of cash and the board knew it.'
    expect(techniqueFor(graphic({ logos: ['ING'], intent }))).toBe('kinetic-word-stack')
    expect(
      techniqueFor(graphic({ logos: ['ING'], intent: 'ING was the name on every door.' })),
    ).toBe('logo-reveal')
    expect(
      techniqueFor(graphic({ logos: ['Meta'], intent: 'The metadata showed the money moving.' })),
    ).toBe('text-highlight')
  })

  it('does not take "wrote off", "told no one" or "bet against" for speech or a versus', () => {
    expect(techniqueFor(graphic({ intent: 'The bank wrote off $4bn of loans.' }))).toBe(
      'stat-counter',
    )
    expect(techniqueFor(graphic({ intent: 'He told no one about the loans in the end.' }))).toBe(
      'kinetic-word-stack',
    )
    expect(
      techniqueFor(graphic({ intent: 'Burry bet against the housing market for two long years.' })),
    ).toBe('kinetic-word-stack')
  })

  it('reads a single curly quotation as a quote, and keeps a pair inside one field', () => {
    expect(techniqueFor(graphic({ intent: '‘We never saw it,’ the auditor admitted.' }))).toBe(
      'quote-card',
    )
    expect(
      techniqueFor(
        graphic({
          intent: 'A 5" pipe ran from the back room to the vault under the bank.',
          coversText: 'A 6" pipe too.',
        }),
      ),
    ).toBe('kinetic-word-stack')
  })

  it('counts trillions and a rand figure with a unit, but not a bare rand sign', () => {
    expect(techniqueFor(graphic({ intent: 'The debt came to 3tn.' }))).toBe('stat-counter')
    expect(techniqueFor(graphic({ intent: 'The loans came to R40 billion.' }))).toBe('stat-counter')
    expect(techniqueFor(graphic({ intent: 'R4bn went in and R2tn came out.' }))).toBe('kpi-counter')
    expect(techniqueFor(graphic({ intent: 'The R40 note was fake.' }))).toBe('text-highlight')
  })

  it('takes a years axis only for real years', () => {
    expect(techniqueFor(chart({ xLabels: ['1999', '2000', '2001', '2002', '2003'] }))).toBe(
      'racing-chart',
    )
    expect(techniqueFor(chart({ xLabels: ['1011', '1012', '1013', '1014', '1015'] }))).toBe(
      'bar-chart',
    )
  })
})
