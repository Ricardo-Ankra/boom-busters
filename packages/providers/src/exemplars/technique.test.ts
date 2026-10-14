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

describe('techniqueFor (decision 305)', () => {
  it.each([
    ['bar, one series', chart(), 'bar-chart'],
    ['stacked', chart({ chartKind: 'stacked' }), 'bar-chart'],
    ['line', chart({ chartKind: 'line' }), 'line-chart'],
    ['area', chart({ chartKind: 'area' }), 'line-chart'],
    ['waterfall', chart({ chartKind: 'waterfall' }), 'comparison-chart'],
    ['bar, two series', chart({ seriesCount: 2 }), 'comparison-chart'],
    [
      'bar, one series, six years',
      chart({ xLabels: ['2016', '2017', '2018', '2019', '2020', '2021'] }),
      'bar-chart',
    ],
    [
      'bar, three series, five years',
      chart({ seriesCount: 3, xLabels: ['2017', '2018', '2019', '2020', '2021'] }),
      'racing-chart',
    ],
    [
      'bar, two series, five years',
      chart({ seriesCount: 2, xLabels: ['2017', '2018', '2019', '2020', '2021'] }),
      'comparison-chart',
    ],
    [
      'bar, three series, four years',
      chart({ seriesCount: 3, xLabels: ['2018', '2019', '2020', '2021'] }),
      'comparison-chart',
    ],
    [
      'bar, three series, five labels that are not years',
      chart({ seriesCount: 3, xLabels: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'] }),
      'comparison-chart',
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
    [
      'said in the narration only',
      graphic({
        intent: 'EY could not find the €1.9bn the company reported.',
        coversText: 'EY said €1.9bn could not be found.',
      }),
      'stat-counter',
    ],
    ['a percentage sign', graphic({ intent: '40% of the money was gone.' }), 'donut-chart'],
    [
      'a percentage that moves',
      graphic({ intent: 'Wirecard shares lost 70% in a single day.' }),
      'stat-counter',
    ],
    ['per cent', graphic({ intent: 'Forty per cent was gone.' }), 'donut-chart'],
    ['per cent of', graphic({ intent: 'Forty per cent of it was gone.' }), 'donut-chart'],
    ['share of', graphic({ intent: 'The share of debt that was real.' }), 'donut-chart'],
    ['versus', graphic({ intent: 'Reported versus real.' }), 'split-screen'],
    ['side by side', graphic({ description: 'The two claims side by side.' }), 'split-screen'],
    [
      'compared in the narration only',
      graphic({
        intent: 'The debt kept growing every year after the merger.',
        coversText: 'Compared with its rivals, the debt kept growing.',
      }),
      'kinetic-word-stack',
    ],
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
    'remove the highlight',
  ])('leaves the steer "%s" to the rules', (guidance) => {
    expect(techniqueFor(graphic({ guidance }))).toBe('kinetic-word-stack')
  })

  it('reads "less" and "drop" as refusals too', () => {
    // A short intent falls through to text-highlight, so the steer's own
    // technique would show if "less kinetic" were taken as a request.
    expect(techniqueFor(graphic({ intent: 'Nobody asked.', guidance: 'less kinetic' }))).toBe(
      'text-highlight',
    )
    expect(techniqueFor(graphic({ guidance: 'drop the pie, lose the donut' }))).toBe(
      'kinetic-word-stack',
    )
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

  it('merges the same figure written two ways, but not two currencies', () => {
    const pair = (intent: string, coversText: string) =>
      techniqueFor(graphic({ intent, coversText }))
    expect(pair('It raised $4bn.', 'It raised 4 billion dollars.')).toBe('stat-counter')
    expect(pair('It raised $4.2bn.', 'It raised 4.2 billion dollars.')).toBe('stat-counter')
    expect(pair('It raised $4.2bn.', 'It raised 4.2bn.')).toBe('stat-counter')
    expect(pair('It raised 4bn.', 'It raised 4.0bn.')).toBe('stat-counter')
    expect(pair('It raised $4bn.', 'It raised €4bn.')).toBe('kpi-counter')
  })

  it('scopes a refusal to its clause', () => {
    expect(techniqueFor(graphic({ guidance: 'not too fast, as a quote' }))).toBe('quote-card')
    expect(techniqueFor(graphic({ guidance: 'No clutter, a pull quote' }))).toBe('quote-card')
    expect(techniqueFor(graphic({ guidance: 'Do not crowd it; step by step' }))).toBe(
      'progress-steps',
    )
    expect(techniqueFor(graphic({ guidance: 'no lower third or chapter title' }))).toBe(
      'kinetic-word-stack',
    )
    expect(techniqueFor(graphic({ guidance: 'not a donut but a stat counter' }))).toBe(
      'stat-counter',
    )
  })

  it('takes the first steer phrase in table order when two are named', () => {
    expect(techniqueFor(graphic({ guidance: 'a pie, then a lower third' }))).toBe('lower-third')
  })

  it('does not take "told no-one" for speech', () => {
    expect(techniqueFor(graphic({ intent: 'He told no-one about the loans in the end.' }))).toBe(
      'kinetic-word-stack',
    )
  })

  it('does not take a leading single curly mark used as an apostrophe for a quote', () => {
    expect(
      techniqueFor(graphic({ intent: 'In the ‘90s the bank’s loans grew and grew every year.' })),
    ).toBe('kinetic-word-stack')
  })

  it('skips a lower-case match of a capitalised logo title', () => {
    const logos = ['Shell']
    expect(
      techniqueFor(
        graphic({ logos, intent: 'A shell company in Cyprus held the money for years.' }),
      ),
    ).toBe('kinetic-word-stack')
    expect(techniqueFor(graphic({ logos, intent: 'Shell was the name on every door.' }))).toBe(
      'logo-reveal',
    )
    expect(techniqueFor(graphic({ logos: ['Acme'], intent: 'ACME was everywhere.' }))).toBe(
      'logo-reveal',
    )
  })

  it('takes a years axis only for real years', () => {
    const three = (xLabels: string[]) => techniqueFor(chart({ seriesCount: 3, xLabels }))
    expect(three(['1999', '2000', '2001', '2002', '2003'])).toBe('racing-chart')
    expect(three(['1011', '1012', '1013', '1014', '1015'])).toBe('comparison-chart')
  })
})
