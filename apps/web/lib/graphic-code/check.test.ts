// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ChartBrief, GraphicBrief, PlannedGraphicCode } from '@boom-busters/schemas'
import {
  GRAPHIC_EXAMPLE_CHART,
  GRAPHIC_EXAMPLE_CHART_DATA,
  GRAPHIC_EXAMPLE_TYPE,
} from '@boom-busters/providers'
import type { GraphicDesignContext } from '@/lib/graphic-design-core'
import { graphicCodeIssue } from './check'

const A = '01J00000000000000000000001'
const B = '01J00000000000000000000002'
const CONTEXT: GraphicDesignContext = {
  projectId: '01J0000000000000000000000P',
  caseTitle: 'Acme',
  claims: [
    { id: A, text: 'Acme raised 4 billion dollars in 2024.', sourceUrl: null, confidence: 'high' },
    { id: B, text: 'Acme raised 1 billion dollars in 2023.', sourceUrl: null, confidence: 'high' },
  ],
  logos: [{ id: '01J000000000000000000000L1', title: 'Acme', width: 1200, height: 400 }],
  paragraphs: [],
  chapterTitle: 'The raise',
}
const GRAPHIC: GraphicBrief = {
  type: 'graphic',
  coversText: 'Acme raised four billion.',
  description: 'The figure.',
  motion: { kind: 'static' },
  transition: 'cut',
  intent: 'Four billion is the story.',
  intentClaimIds: [A],
}
const CHART: ChartBrief = {
  type: 'chart',
  coversText: 'A billion, then four.',
  description: 'Two raises.',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'bar',
  series: [
    {
      label: 'Raised',
      unit: 'USD bn',
      points: [
        { x: '2023', y: 1 },
        { x: '2024', y: 4 },
      ],
    },
  ],
  dataRefs: [B, A],
  takeaway: 'Four times in a year',
  reveal: 'draw-on',
}
const WORDS = [
  { text: 'four', atMs: 900 },
  { text: 'billion.', atMs: 1200 },
]
const slot = (brief: GraphicBrief | ChartBrief, durationMs = 6000) => ({
  brief,
  durationMs,
  words: WORDS,
})

/** A count-up to `figure` billion over the first second, then held, with a sweep so it never sits still. */
const countUp = (figure: number) => `function Graphic() {
  const frame = Remotion.useCurrentFrame()
  const { fps } = Remotion.useVideoConfig()
  const count = Remotion.interpolate(frame, [6, 6 + fps], [0, 1], {
    easing: Remotion.Easing.out(Remotion.Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      <div>{'$' + Math.round(count * ${figure * 10}) / 10 + 'bn'}</div>
      <div style={{ width: sweep + '%', height: 4 }} />
    </Remotion.AbsoluteFill>
  )
}
`

const CHART_SOURCE = `function Graphic(props) {
  const points = props.data.series[0].points
  return (
    <Remotion.AbsoluteFill>
      <div>{props.data.takeaway}</div>
      {points.map((point) => (
        <div key={point.x}>{point.x + ': ' + point.y}</div>
      ))}
    </Remotion.AbsoluteFill>
  )
}
`

const answer = (over: Partial<PlannedGraphicCode> = {}): PlannedGraphicCode => ({
  title: 'Raised in one round',
  facts: [{ text: '$4bn', claim: 1 }],
  source: countUp(4),
  ...over,
})

describe('graphicCodeIssue (decision 295)', () => {
  it('keeps a count-up whose passing values flicker by, citing its claim by id', () => {
    const planned = answer()
    expect(graphicCodeIssue(planned, CONTEXT, slot(GRAPHIC))).toEqual({
      code: {
        version: 1,
        source: planned.source,
        compiled: expect.stringContaining('function Graphic()'),
        title: 'Raised in one round',
        facts: [{ text: '$4bn', claimId: A }],
        words: WORDS,
        durationMs: 6000,
      },
    })
  })

  it('refuses a figure that settles on a number no cited claim holds', () => {
    expect(graphicCodeIssue(answer({ source: countUp(7) }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue: expect.stringContaining('7'),
    })
  })

  it('checks the portrait frame on its own: a figure only the Short shows is refused (final review I4)', () => {
    const source = `function Graphic() {
  const frame = Remotion.useCurrentFrame()
  const { width, height } = Remotion.useVideoConfig()
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      <div>{height > width ? '$7bn' : '$4bn'}</div>
      <div style={{ width: sweep + '%', height: 4 }} />
    </Remotion.AbsoluteFill>
  )
}
`
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue: 'the graphic shows 7, which no cited claim contains, in portrait',
    })
    // The same figure in both frames passes: the facts hold in each.
    const both = source.replace("'$7bn'", "'$4bn'")
    expect(graphicCodeIssue(answer({ source: both }), CONTEXT, slot(GRAPHIC))).toHaveProperty(
      'code',
    )
  })

  it('scans the compiled code before it runs anything', () => {
    const source = countUp(4).replace('const frame', 'const seed = Math.random()\n  const frame')
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue:
        'the code uses Math.random, which the sandbox bans: a graphic must be a pure function of the frame',
    })
  })

  it('refuses code that does not compile', () => {
    const source = 'function Graphic(props) {\n  return <div>{props.durationMs</div>\n}\n'
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue: expect.stringMatching(/^the code does not compile: /),
    })
  })

  it("passes the dry run's refusal through", () => {
    const source = `function Graphic() {
  return <Remotion.AbsoluteFill><div>Raised</div></Remotion.AbsoluteFill>
}
`
    expect(graphicCodeIssue(answer({ source, facts: [] }), CONTEXT, slot(GRAPHIC, 8000))).toEqual({
      issue: 'nothing changes between 0.0 s and 8.0 s',
    })
  })

  it('gives a chart its series as props.data, and a graphic none', () => {
    const facts = [
      { text: '2023', claim: 2 },
      { text: '1', claim: 2 },
      { text: '2024', claim: 1 },
      { text: '4', claim: 1 },
    ]
    const chart = graphicCodeIssue(
      answer({ source: CHART_SOURCE, facts }),
      CONTEXT,
      slot(CHART, 4000),
    )
    expect(chart).toHaveProperty('code')
    const graphic = graphicCodeIssue(
      answer({ source: CHART_SOURCE, facts }),
      CONTEXT,
      slot(GRAPHIC, 4000),
    )
    expect(graphic).toEqual({
      issue:
        "the code failed at 0.0 s (frame 0) in landscape: Cannot read properties of undefined (reading 'series')",
    })
  })

  it('lets a chart show a value from its own series that no claim holds (ruling 4)', () => {
    const shareChart: ChartBrief = {
      ...CHART,
      series: [
        {
          label: 'Share price',
          unit: 'EUR',
          points: [
            { x: '2020-06-17', y: 104.5 },
            { x: '2020-06-26', y: 1.28 },
          ],
        },
      ],
    }
    // "104.5" stays on screen the whole slot; no claim in CONTEXT holds it, and
    // the facts cite nothing. A sweep keeps every sample moving.
    const source = `function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const sweep = Remotion.interpolate(frame, [0, 119], [0, 100], { extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      <div>{String(props.data.series[0].points[0].y)}</div>
      <div style={{ width: sweep + '%', height: 4 }} />
    </Remotion.AbsoluteFill>
  )
}
`
    expect(
      graphicCodeIssue(answer({ source, facts: [] }), CONTEXT, slot(shareChart, 4000)),
    ).toHaveProperty('code')
  })

  it('hands the code every mark the library holds with a size, by title, and no sizeless one (ruling 25)', () => {
    const source = `function Graphic(props) {
  const mark = props.logos['Acme']
  return (
    <Remotion.AbsoluteFill>
      <Remotion.Img src={mark.src} />
      <div>Acme</div>
    </Remotion.AbsoluteFill>
  )
}
`
    expect(
      graphicCodeIssue(answer({ source, facts: [] }), CONTEXT, slot(GRAPHIC, 4000)),
    ).toHaveProperty('code')
    // The same mark with no recorded size is left out of props.logos, as the
    // assembly and the board leave it out, so the code that reads it crashes.
    const sizeless: GraphicDesignContext = {
      ...CONTEXT,
      logos: [{ id: '01J000000000000000000000L1', title: 'Acme', width: null, height: null }],
    }
    expect(graphicCodeIssue(answer({ source, facts: [] }), sizeless, slot(GRAPHIC, 4000))).toEqual({
      issue:
        "the code failed at 0.0 s (frame 0) in landscape: Cannot read properties of undefined (reading 'src')",
    })
  })

  it('refuses a fact citing a claim the list does not have', () => {
    const facts = [
      { text: '$4bn', claim: 1 },
      { text: 'Acme', claim: 9 },
    ]
    expect(graphicCodeIssue(answer({ facts }), CONTEXT, slot(GRAPHIC))).toHaveProperty('issue')
  })
  it("passes both of the prompt's worked examples (decision 295)", () => {
    const claimId = (n: number) => `01J${String(n).padStart(23, '0')}`
    const years = GRAPHIC_EXAMPLE_CHART_DATA.series[0]!.points
    const context: GraphicDesignContext = {
      ...CONTEXT,
      claims: [
        {
          id: claimId(1),
          text: 'Wirecard was a payments company.',
          sourceUrl: null,
          confidence: 'high',
        },
        {
          id: claimId(2),
          text: 'Wirecard reported €1.9 billion in trustee accounts that auditors could not confirm existed.',
          sourceUrl: null,
          confidence: 'high',
        },
        { id: claimId(3), text: 'The auditors were EY.', sourceUrl: null, confidence: 'high' },
        { id: claimId(4), text: 'The filings ran for years.', sourceUrl: null, confidence: 'high' },
        ...years.map((point, i) => ({
          id: claimId(5 + i),
          text: `Trustee cash reported in ${point.x} was €${point.y} billion.`,
          sourceUrl: null,
          confidence: 'high' as const,
        })),
      ],
    }

    const typeBrief: GraphicBrief = {
      ...GRAPHIC,
      coversText: 'The auditors could not find 1.9 billion euros. It had never existed.',
      intentClaimIds: [claimId(2)],
    }
    const typeWords = [
      ['The', 0],
      ['auditors', 300],
      ['could', 900],
      ['not', 1200],
      ['find', 1500],
      ['1.9', 2600],
      ['billion', 3000],
      ['euros.', 3400],
      ['It', 4400],
      ['had', 4600],
      ['never', 5000],
      ['existed.', 5400],
    ].map(([text, atMs]) => ({ text: text as string, atMs: atMs as number }))
    const type = graphicCodeIssue(
      {
        title: 'The missing €1.9bn',
        facts: [{ text: '€1.9bn', claim: 2 }],
        source: GRAPHIC_EXAMPLE_TYPE,
      },
      context,
      { brief: typeBrief, durationMs: 7500, words: typeWords },
    )
    expect(type).not.toHaveProperty('issue')
    expect(type).toHaveProperty('code')

    const chartBrief: ChartBrief = {
      ...CHART,
      coversText: 'The cash grew every year.',
      series: GRAPHIC_EXAMPLE_CHART_DATA.series,
      annotations: GRAPHIC_EXAMPLE_CHART_DATA.annotations,
      takeaway: GRAPHIC_EXAMPLE_CHART_DATA.takeaway,
      dataRefs: years.map((_, i) => claimId(5 + i)),
    }
    const chartWords = [
      { text: '2016', atMs: 1000 },
      { text: '2017', atMs: 2000 },
      { text: '2018', atMs: 3000 },
      { text: '2019', atMs: 4200 },
    ]
    const chart = graphicCodeIssue(
      {
        title: 'Trustee cash, year by year',
        facts: [
          { text: '2019', claim: 8 },
          { text: '1.9', claim: 8 },
        ],
        source: GRAPHIC_EXAMPLE_CHART,
      },
      context,
      { brief: chartBrief, durationMs: 7200, words: chartWords },
    )
    expect(chart).not.toHaveProperty('issue')
    expect(chart).toHaveProperty('code')
  })
})
