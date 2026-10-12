// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { compileGraphicSource } from './compile'

describe('compileGraphicSource (decision 295)', () => {
  it('compiles JSX to React.createElement calls and keeps Graphic a plain declaration', () => {
    const result = compileGraphicSource(
      'function Graphic(props) {\n  return <Remotion.AbsoluteFill><div>{props.durationMs}</div></Remotion.AbsoluteFill>\n}\n',
    )
    if (!result.ok) throw new Error(result.issue)
    expect(result.compiled).toContain('function Graphic(props) {')
    expect(result.compiled).toContain('React.createElement(Remotion.AbsoluteFill, null')
    expect(result.compiled).toContain('React.createElement("div", null, props.durationMs)')
    expect(result.compiled).not.toContain('<div>')
  })

  it('compiles a fragment to React.Fragment', () => {
    const result = compileGraphicSource('function Graphic() {\n  return <><b>a</b></>\n}\n')
    if (!result.ok) throw new Error(result.issue)
    expect(result.compiled).toContain('React.createElement(React.Fragment, null')
  })

  it("refuses a syntax error with esbuild's message and its line", () => {
    const result = compileGraphicSource(
      'function Graphic(props) {\n  const a = 1\n  return <div>{a</div>\n}\n',
    )
    expect(result).toEqual({
      ok: false,
      issue: 'the code does not compile: Unterminated regular expression (line 3)',
    })
  })
})
