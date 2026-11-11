// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type {
  ChartBrief,
  GraphicBrief,
  GraphicCode,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import { DEFAULT_MOTION_IDENTITY } from '@boom-busters/schemas'
import { GRAPHIC_CODE_FIXTURE_SOURCE } from '@boom-busters/providers'
import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
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
    easing: motion.ease.emphasis,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { easing: motion.ease.linear, extrapolateRight: 'clamp' })
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
        motion: 2,
        title: 'Raised in one round',
        facts: [{ text: '$4bn', claimId: A }],
        words: WORDS,
        durationMs: 6000,
      },
    })
  })

  it('stores the compiled code with the channel preamble and version 2 (spec 2026-11-04)', () => {
    const house = graphicCodeIssue(answer(), CONTEXT, slot(GRAPHIC))
    expect('code' in house && house.code.compiled).toContain(MOTION_PREAMBLE)
    const result = graphicCodeIssue(answer(), CONTEXT, slot(GRAPHIC), {
      motion: { ...DEFAULT_MOTION_IDENTITY, ms: { enter: 900 } },
    })
    expect('code' in result && result.code.compiled).toContain('"enter":900')
    expect('code' in result && result.code.compiled).not.toContain(MOTION_PREAMBLE)
    expect('code' in result && result.code.motion).toBe(2)
  })

  it('refuses on the channel still limit', () => {
    const held = answer({
      source: `function Graphic() {
  return <Remotion.AbsoluteFill><div>$4bn</div></Remotion.AbsoluteFill>
}
`,
    })
    expect(graphicCodeIssue(held, CONTEXT, slot(GRAPHIC, 5000))).toHaveProperty('code')
    expect(
      graphicCodeIssue(held, CONTEXT, slot(GRAPHIC, 5000), {
        motion: { ...DEFAULT_MOTION_IDENTITY, changeEveryMs: 500, stillMaxMs: 3000 },
      }),
    ).toEqual({ issue: 'nothing changes between 0.0 s and 5.0 s' })
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
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { easing: motion.ease.linear, extrapolateRight: 'clamp' })
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

  describe('a graphic at rest after its last word', () => {
    // Types "Acme" four letters a second from `fromS` seconds in, over a held figure.
    const typing = (condition: string, fromS: number) => `function Graphic() {
  const frame = Remotion.useCurrentFrame()
  const { width, height } = Remotion.useVideoConfig()
  const letters = Math.max(0, Math.min(4, Math.floor(frame / 6) - ${fromS * 4}))
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { easing: motion.ease.linear, extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      <div>$4bn</div>
      <div>{(${condition}) ? 'Acme'.slice(0, letters) : 'Acme'}</div>
      <div style={{ width: sweep + '%', height: 4 }} />
    </Remotion.AbsoluteFill>
  )
}
`
    const REST_ISSUE = expect.stringContaining('the graphic is still changing')

    it('refuses a design that types a word after the last spoken word', () => {
      expect(
        graphicCodeIssue(answer({ source: typing('true', 2) }), CONTEXT, slot(GRAPHIC)),
      ).toEqual({ issue: REST_ISSUE })
    })

    it('passes a design that has finished typing before the last word has settled', () => {
      expect(
        graphicCodeIssue(answer({ source: typing('true', 0) }), CONTEXT, slot(GRAPHIC)),
      ).toHaveProperty('code')
    })

    it('refuses in portrait with the portrait suffix when only the Short is still moving', () => {
      expect(
        graphicCodeIssue(answer({ source: typing('height > width', 2) }), CONTEXT, slot(GRAPHIC)),
      ).toEqual({ issue: expect.stringMatching(/only the camera may move, in portrait$/) })
    })
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
  const sweep = Remotion.interpolate(frame, [0, 119], [0, 100], { easing: motion.ease.linear, extrapolateRight: 'clamp' })
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

  it('stores the compiled code with the house motion preamble first, and says which version (decision 301)', () => {
    const result = graphicCodeIssue(answer(), CONTEXT, slot(GRAPHIC))
    expect(result).toHaveProperty('code')
    const { code } = result as { code: { compiled: string; motion?: number } }
    expect(code.compiled.startsWith(`${MOTION_PREAMBLE}\n`)).toBe(true)
    expect(code.compiled.slice(MOTION_PREAMBLE.length + 1)).toContain('function Graphic()')
    expect(code.motion).toBe(2)
  })

  it('stores the concept and the storyboard with the design, and leaves them out when the answer has none (decision 388)', () => {
    const planned = answer({
      concept: 'the count is the story',
      storyboard: ['0.2 s the figure counts up', '1.2 s it lands on its claim'],
    })
    const kept = graphicCodeIssue(planned, CONTEXT, slot(GRAPHIC)) as { code: GraphicCode }
    expect(kept.code.concept).toBe('the count is the story')
    expect(kept.code.storyboard).toEqual([
      '0.2 s the figure counts up',
      '1.2 s it lands on its claim',
    ])
    const bare = graphicCodeIssue(answer(), CONTEXT, slot(GRAPHIC)) as { code: GraphicCode }
    expect(bare.code).not.toHaveProperty('concept')
    expect(bare.code).not.toHaveProperty('storyboard')
  })

  it("keeps the design's mechanisms on the stored code, and none when it named none (spec 2026-11-04, section 8.5)", () => {
    const named = graphicCodeIssue(answer({ mechanisms: ['drum'] }), CONTEXT, slot(GRAPHIC)) as {
      code: GraphicCode
    }
    expect(named.code.mechanisms).toEqual(['drum'])
    const bare = graphicCodeIssue(answer(), CONTEXT, slot(GRAPHIC)) as { code: GraphicCode }
    expect(bare.code).not.toHaveProperty('mechanisms')
  })

  it('runs the dry run with the tokens in scope: a design on motion.ms and motion.ease passes', () => {
    const source = `function Graphic() {
  const frame = Remotion.useCurrentFrame()
  const { fps } = Remotion.useVideoConfig()
  const count = Remotion.interpolate(frame, [6, 6 + motion.frames(motion.ms.count, fps)], [0, 1], {
    easing: motion.ease.emphasis,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { easing: motion.ease.linear, extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      <div>{'$' + Math.round(count * 40) / 10 + 'bn'}</div>
      <div style={{ width: sweep + '%', height: motion.px.rise }} />
    </Remotion.AbsoluteFill>
  )
}
`
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toHaveProperty('code')
  })

  it("refuses a design that changes a token, by the dry run's crash report (decision 301)", () => {
    // Not an assignment, so the scan cannot see it; the frozen object throws under strict mode.
    const source = countUp(4).replace(
      'const frame',
      'Object.assign(motion.ms, { enter: 1 })\n  const frame',
    )
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue: expect.stringMatching(
        /^the code failed at 0\.0 s \(frame 0\) in landscape: Cannot (assign to|add property) /,
      ),
    })
  })

  it("passes the fixture, the mock designer's answer, under the preamble (decision 301)", () => {
    const result = graphicCodeIssue(
      {
        title: 'Raised in one round',
        facts: [{ text: '$4bn', claim: 1 }],
        source: GRAPHIC_CODE_FIXTURE_SOURCE,
      },
      CONTEXT,
      slot(GRAPHIC),
    )
    expect(result).not.toHaveProperty('issue')
    expect(result).toHaveProperty('code')
  })
})

describe('a figure built from pieces, or struck on its way (decision 449)', () => {
  // The derived stat counter's world: one claim per figure the plan speaks.
  const LOSS: GraphicDesignContext = {
    ...CONTEXT,
    claims: [{ id: A, text: 'The figure is 3.4bn.', sourceUrl: null, confidence: 'high' }],
  }
  const lossAnswer = (source: string): PlannedGraphicCode => ({
    title: 'The loss',
    facts: [{ text: '3.4bn', claim: 1 }],
    source,
  })
  /** Each sample's figure, from a beat number to the text it shows, with a sweep so it never sits still. */
  const showing = (figure: string) => `function Graphic() {
  const frame = Remotion.useCurrentFrame()
  const { fps } = Remotion.useVideoConfig()
  const beat = Math.floor(frame / Math.round(0.4 * fps))
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { easing: motion.ease.linear, extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      ${figure}
      <div style={{ width: sweep + '%', height: 4 }} />
    </Remotion.AbsoluteFill>
  )
}
`

  it('reads a figure drawn a digit to a column as the one figure it shows', () => {
    const drum = showing(
      `<div style={{ display: 'flex' }}><span>$</span><span>3</span><span>.</span><span>4</span><span>bn</span></div>`,
    )
    expect(graphicCodeIssue(lossAnswer(drum), LOSS, slot(GRAPHIC))).toEqual({
      code: expect.anything(),
    })
  })

  it('still refuses a figure drawn in pieces when the pieces make an uncited figure', () => {
    const drum = showing(
      `<div style={{ display: 'flex' }}><span>7</span><span>.</span><span>1</span></div>`,
    )
    expect(graphicCodeIssue(lossAnswer(drum), LOSS, slot(GRAPHIC))).toEqual({
      issue: 'the graphic shows 7, which no cited claim contains',
    })
  })

  it('keeps a count that strikes each whole figure for a beat on its way to the cited one', () => {
    const struck = showing(
      `<div>{'$' + (beat === 0 ? '1' : beat === 1 ? '2' : beat === 2 ? '3' : '3.4') + 'bn'}</div>`,
    )
    expect(graphicCodeIssue(lossAnswer(struck), LOSS, slot(GRAPHIC))).toEqual({
      code: expect.anything(),
    })
  })

  it('keeps a drum whose whole part lands a beat before its decimals', () => {
    const landing = showing(`<div>{'$' + (beat < 2 ? '3' : '3.4') + 'bn'}</div>`)
    expect(graphicCodeIssue(lossAnswer(landing), LOSS, slot(GRAPHIC))).toEqual({
      code: expect.anything(),
    })
  })

  it('refuses a count that lands on a figure no cited claim holds, and a held figure no count passes', () => {
    const wrong = showing(`<div>{'$' + (beat === 0 ? '1' : beat === 1 ? '2' : '7') + 'bn'}</div>`)
    expect(graphicCodeIssue(lossAnswer(wrong), LOSS, slot(GRAPHIC))).toEqual({
      issue: 'the graphic shows 7, which no cited claim contains',
    })
    const label = showing(`<div>{'3 years'}</div><div>{'$3.4bn'}</div>`)
    expect(graphicCodeIssue(lossAnswer(label), LOSS, slot(GRAPHIC))).toEqual({
      issue: 'the graphic shows 3, which no cited claim contains',
    })
  })
})
