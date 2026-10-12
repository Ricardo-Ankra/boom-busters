// @vitest-environment node
import type * as Esbuild from 'esbuild'
import { describe, expect, it, vi } from 'vitest'

/** A host where esbuild cannot run: every transform throws, as a missing binary does. */
const host = vi.hoisted(() => ({ broken: false, transforms: 0 }))
vi.mock('esbuild', async (importOriginal) => {
  const original = await importOriginal<typeof Esbuild>()
  return {
    ...original,
    transformSync: (...args: Parameters<typeof original.transformSync>) => {
      host.transforms += 1
      if (host.broken) {
        throw new Error('The package "@esbuild/linux-x64" could not be found')
      }
      return original.transformSync(...args)
    },
  }
})

import { compileGraphicSource, ensureGraphicCompiler } from './compile'

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

// In this order: the cache a success leaves behind is what the second test reads.
describe('ensureGraphicCompiler (final review I2)', () => {
  it('throws, naming the failure, on a host where esbuild cannot run, and tries again next time', () => {
    host.broken = true
    try {
      expect(() => ensureGraphicCompiler()).toThrow(
        /^the designer's checks cannot compile code on this host: The package "@esbuild\/linux-x64" could not be found/,
      )
      expect(() => ensureGraphicCompiler()).toThrow(/cannot compile code on this host/)
    } finally {
      host.broken = false
    }
  })

  it('compiles once per process once it has worked', () => {
    ensureGraphicCompiler()
    const after = host.transforms
    host.broken = true
    try {
      expect(() => ensureGraphicCompiler()).not.toThrow()
      expect(host.transforms).toBe(after)
    } finally {
      host.broken = false
    }
  })
})
