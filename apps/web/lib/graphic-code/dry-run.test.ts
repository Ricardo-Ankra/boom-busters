// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { graphicBrand } from '@boom-busters/compositions/graphic-code'
import { GRAPHIC_CODE_SOURCE } from '@boom-busters/compositions/graphic-code-fixture'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import { compileGraphicSource } from './compile'
import { dryRunGraphic, type DryRunInput } from './dry-run'

const PROPS: DryRunInput['props'] = {
  brand: graphicBrand(resolveBrandKit(DEFAULT_SETTINGS)),
  words: [
    { text: 'Acme', atMs: 0 },
    { text: 'raised', atMs: 400 },
    { text: 'four', atMs: 900 },
    { text: 'billion.', atMs: 1200 },
  ],
  durationMs: 4000,
  logos: {},
}

function compiled(source: string): string {
  const result = compileGraphicSource(source)
  if (!result.ok) throw new Error(result.issue)
  return result.compiled
}

function dryRun(
  source: string,
  durationMs = 4000,
  limits: Pick<DryRunInput, 'timeoutMs' | 'frameMaxMs'> = {},
) {
  return dryRunGraphic({
    compiled: compiled(source),
    props: { ...PROPS, durationMs },
    durationMs,
    ...limits,
  })
}

describe('dryRunGraphic (decision 295)', () => {
  it('passes the fixture graphic in both frames, with one text sample per 250 ms', () => {
    const result = dryRun(GRAPHIC_CODE_SOURCE, 6000)
    expect(result.issue).toBeNull()
    expect(result.textSamples).toHaveLength(6000 / 250 + 1)
    expect(result.textSamples.at(-1)).toContain('$4bn')
  })

  it("runs a Sequence's children on a clock from its start, and nothing before it", () => {
    const result = dryRun(`function Clock() {
  return <div>{Remotion.useCurrentFrame()}</div>
}

function Graphic() {
  return (
    <Remotion.AbsoluteFill>
      <Remotion.Sequence from={30}>
        <Clock />
      </Remotion.Sequence>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBeNull()
    expect(result.textSamples[0]).toBe('')
    // 1.5 s is frame 45, fifteen frames into a sequence from frame 30.
    expect(result.textSamples[6]).toBe('15')
  })

  it('names the time, the frame and the error when the code throws', () => {
    // Samples land on frames 38 and 45 around 1.3 s, so frame 45 is the first to throw.
    const result = dryRun(`function Graphic() {
  const frame = Remotion.useCurrentFrame()
  if (frame >= 40) throw new Error('boom')
  return <Remotion.AbsoluteFill><div>{frame}</div></Remotion.AbsoluteFill>
}
`)
    expect(result.issue).toBe('the code failed at 1.5 s (frame 45) in landscape: boom')
  })

  it('names the crash at frame 0 when the code reads a logo it was not given', () => {
    const result = dryRun(`function Graphic(props) {
  return (
    <Remotion.AbsoluteFill>
      <Remotion.Img src={props.logos['Acme'].src} />
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBe(
      "the code failed at 0.0 s (frame 0) in landscape: Cannot read properties of undefined (reading 'src')",
    )
  })

  it('refuses code the sandbox cannot run', () => {
    const result = dryRun(`export function Graphic() {
  return <Remotion.AbsoluteFill><div>Hello</div></Remotion.AbsoluteFill>
}
`)
    expect(result.issue).toBe("the code does not run: Unexpected token 'export'")
  })

  it('names a stretch of dead air longer than six seconds', () => {
    const result = dryRun(
      `function Graphic() {
  return <Remotion.AbsoluteFill><div>Raised in one round</div></Remotion.AbsoluteFill>
}
`,
      8000,
    )
    expect(result.issue).toBe('nothing changes between 0.0 s and 8.0 s')
  })

  it('refuses a graphic whose last second is empty', () => {
    const result = dryRun(`function Graphic() {
  const { fps } = Remotion.useVideoConfig()
  return (
    <Remotion.AbsoluteFill>
      <Remotion.Sequence durationInFrames={3 * fps}>
        <div>Gone before the end</div>
      </Remotion.Sequence>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBe('the last second of the graphic is empty: hold the ending')
  })

  it('names an element placed outside the safe area, and the frame', () => {
    const result = dryRun(`function Graphic() {
  return (
    <Remotion.AbsoluteFill>
      <div style={{ position: 'absolute', left: -10, top: 400 }}>Off the edge</div>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBe('"Off the edge" sits outside the safe area in landscape')
  })

  it('measures an element inside a positioned box from that box, not from the frame', () => {
    const result = dryRun(`function Graphic(props) {
  const inset = props.safeArea
  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top,
        paddingRight: inset.right,
        paddingBottom: inset.bottom,
        paddingLeft: inset.left,
      }}
    >
      <div style={{ position: 'relative', height: 300 }}>
        <div style={{ position: 'absolute', left: 0, bottom: 0 }}>Inside its chart</div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBeNull()
  })

  it('checks the portrait frame too, and keeps the landscape text', () => {
    const result = dryRun(`function Graphic() {
  const { width, height } = Remotion.useVideoConfig()
  return (
    <Remotion.AbsoluteFill>
      <div style={{ position: 'absolute', left: height > width ? 10 : 100, top: 200 }}>Tall only</div>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBe('"Tall only" sits outside the safe area in portrait')
    expect(result.textSamples).toHaveLength(4000 / 250 + 1)
  })

  it('refuses a frame slower than its limit', () => {
    const result = dryRun(
      `function Graphic() {
  let total = 0
  for (let i = 0; i < 20000000; i += 1) total += i % 7
  return <Remotion.AbsoluteFill><div>{total}</div></Remotion.AbsoluteFill>
}
`,
      4000,
      { frameMaxMs: 1 },
    )
    expect(result.issue).toBe('frame 0 (0.0 s) did not finish in 0.001 s in landscape')
  })

  it('stops a loop that never ends at the run limit', () => {
    const result = dryRun(
      `function Graphic() {
  while (true) {}
}
`,
      4000,
      { timeoutMs: 500 },
    )
    expect(result.issue).toBe('the landscape dry run did not finish in 0.5 s')
  })
})
