// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { GRAPHIC_SOURCE_MAX } from '@boom-busters/schemas'
import { compileGraphicSource } from './compile'
import { scanGraphicSource, splitSource } from './scan'

/** The scan of a source, as `graphicCodeIssue` runs it: on esbuild's output for it. */
function scan(source: string): string | null {
  const result = compileGraphicSource(source)
  if (!result.ok) throw new Error(result.issue)
  return scanGraphicSource(source, result.compiled)
}

/** A clean graphic with `body` as the first lines of its function. */
const graphic = (body: string) =>
  `function Graphic(props) {\n${body}\n  return <Remotion.AbsoluteFill><div>Acme</div></Remotion.AbsoluteFill>\n}\n`

const PURE = 'a graphic must be a pure function of the frame'
const GIVEN = 'everything it needs arrives as React, Remotion and props'
const COLOURS = 'colours come from props.brand.colors, with Remotion.withAlpha for opacity'

describe('scanGraphicSource (decision 295)', () => {
  it('passes a clean graphic: a function declaration is not the banned Function', () => {
    expect(scan(graphic('  function helper() {\n    return 1\n  }'))).toBeNull()
  })

  it.each([
    ['Math.random', '  const seed = Math.random()', PURE],
    ['Date', '  const now = Date.now()', PURE],
    ['Date', '  const then = new Date(2020, 1, 1)', PURE],
    ['window', '  const wide = window.innerWidth', PURE],
    ['document', '  const title = document.title', PURE],
    ['globalThis', '  const scope = globalThis', PURE],
    ['process', '  const key = process.env.KEY', PURE],
    ['fetch', "  fetch('https://example.com')", PURE],
    ['setTimeout', '  setTimeout(() => {}, 10)', PURE],
    ['setInterval', '  setInterval(() => {}, 10)', PURE],
    ['requestAnimationFrame', '  requestAnimationFrame(() => {})', PURE],
    ['eval', "  const two = eval('1 + 1')", PURE],
    ['Function', "  const make = new Function('return 1')", PURE],
    ['useState', '  const [n] = React.useState(0)', PURE],
    ['useEffect', '  React.useEffect(() => {})', PURE],
    ['useLayoutEffect', '  React.useLayoutEffect(() => {})', PURE],
    ['require', "  const fs = require('fs')", GIVEN],
  ])('refuses %s', (name, line, reason) => {
    expect(scan(graphic(line))).toBe(`the code uses ${name}, which the sandbox bans: ${reason}`)
  })

  it('refuses an import', () => {
    expect(scan(`import { useMemo } from 'react'\n${graphic('')}`)).toBe(
      `the code uses import, which the sandbox bans: ${GIVEN}`,
    )
  })

  it('refuses an assignment to a member of the sandbox arguments: the sandbox is read-only', () => {
    expect(scan(graphic('  Remotion.Easing = null'))).toBe(
      'the code assigns to Remotion.Easing, which the sandbox bans: the sandbox is read-only',
    )
    expect(scan(graphic('  React.createElement = () => null'))).toBe(
      'the code assigns to React.createElement, which the sandbox bans: the sandbox is read-only',
    )
    // Reading a member and comparing it are not assignments.
    expect(
      scan(
        graphic(
          '  const same = Remotion.Easing === null || Remotion.Easing != null\n  const bezier = Remotion.Easing.bezier(0, 0, 1, 1)',
        ),
      ),
    ).toBeNull()
  })

  it('refuses an assignment to a nested member or a compound assignment', () => {
    const sentence = (name: string) =>
      `the code assigns to ${name}, which the sandbox bans: the sandbox is read-only`
    expect(scan(graphic('  Remotion.Easing.linear = (t) => 0'))).toBe(sentence('Remotion.Easing'))
    expect(scan(graphic('  React.Children.map = () => null'))).toBe(sentence('React.Children'))
    expect(scan(graphic('  Remotion.Easing += 1'))).toBe(sentence('Remotion.Easing'))
    expect(scan(graphic('  Remotion.Easing ??= null'))).toBe(sentence('Remotion.Easing'))
  })

  it('refuses Suspense and lazy: a throw inside them is swallowed', () => {
    expect(scan(graphic('  const S = React.Suspense'))).toBe(
      `the code uses Suspense, which the sandbox bans: ${PURE}`,
    )
    expect(scan(graphic('  const L = React.lazy(() => null)'))).toBe(
      `the code uses lazy, which the sandbox bans: ${PURE}`,
    )
  })

  it('is not blinded by an apostrophe in JSX text or a quote in a regex', () => {
    const text = graphic('').replace('<div>Acme</div>', "<div>It's {Date.now()}</div>")
    expect(scan(text)).toBe(`the code uses Date, which the sandbox bans: ${PURE}`)
    const hex = graphic('').replace(
      '<div>Acme</div>',
      "<span>Acme's</span><span style={{ color: '#ff0000' }}>x</span>",
    )
    expect(scan(hex)).toBe(`the code writes the colour #ff0000: ${COLOURS}`)
    const regex = graphic("  const t = 'a'.replace(/'/g, '') + Math.random()")
    expect(scan(regex)).toBe(`the code uses Math.random, which the sandbox bans: ${PURE}`)
  })

  it('does not refuse banned words that are JSX text', () => {
    const source = graphic('').replace(
      '<div>Acme</div>',
      '<div>Date (UTC)</div><div>import duties rose</div>',
    )
    expect(scan(source)).toBeNull()
  })

  it('reads words on screen and in strings as words, not code', () => {
    const source = graphic("  const caption = 'Date of the raid: the window closed'").replace(
      '<div>Acme</div>',
      '<div>A leaked document shows the process failed. Function over form.</div>',
    )
    expect(scan(source)).toBeNull()
  })

  it('refuses a hex colour in a string, a template literal or a JSX attribute', () => {
    expect(scan(graphic("  const red = '#ff0000'"))).toBe(
      `the code writes the colour #ff0000: ${COLOURS}`,
    )
    expect(scan(graphic('  const edge = `${props.durationMs}px solid #0af`'))).toBe(
      `the code writes the colour #0af: ${COLOURS}`,
    )
    const attribute = graphic('').replace('<div>Acme</div>', '<svg><rect fill="#00ff00" /></svg>')
    expect(scan(attribute)).toBe(`the code writes the colour #00ff00: ${COLOURS}`)
  })

  it('refuses rgb(), rgba() and hsl() colours', () => {
    expect(scan(graphic("  const shade = 'rgba(0, 0, 0, 0.5)'"))).toBe(
      `the code writes a colour with rgba(): ${COLOURS}`,
    )
    expect(scan(graphic("  const shade = 'hsl(10, 50%, 50%)'"))).toBe(
      `the code writes a colour with hsl(): ${COLOURS}`,
    )
  })

  it('lets a rank through: only a colour-length hex is a colour', () => {
    expect(scan(graphic("  const rank = '#1 in Europe'"))).toBeNull()
  })

  it('refuses a source over the size cap', () => {
    const source = `${graphic('')}//${'x'.repeat(GRAPHIC_SOURCE_MAX)}`
    expect(scan(source)).toBe(
      `the code is ${source.length} characters; at most ${GRAPHIC_SOURCE_MAX} fit`,
    )
  })

  it('refuses a source that does not declare function Graphic', () => {
    expect(scan('const Graphic = (props) => null\n')).toBe(
      'the code does not declare function Graphic(props) at the top level',
    )
  })
})

describe('splitSource', () => {
  it('blanks comments and strings out of the code and keeps the strings', () => {
    const { code, strings } = splitSource(
      'const a = \'one\' // Date.now()\n/* window.x */ const b = "two"\nconst c = `three ${a + `four`} five`\n',
    )
    expect(code).not.toMatch(/one|two|three|four|five|Date|window/)
    expect(code).toContain('a + ')
    expect(code.split('\n')).toHaveLength(4)
    expect(strings).toEqual(['one', 'two', 'three ', 'four', ' five'])
  })
})
