// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ChartBrief, GraphicBrief, PlannedGraphicCode } from '@boom-busters/schemas'
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
  const count = Remotion.spring({ frame, fps, delay: 6, durationInFrames: fps, config: { damping: 200 } })
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

  it('scans before it compiles or runs anything', () => {
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
})
