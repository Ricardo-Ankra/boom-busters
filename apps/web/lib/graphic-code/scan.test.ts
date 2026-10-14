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
const PAGE = 'a graphic draws React elements inside its frame and touches nothing else on the page'
const DIGITS = 'write the digits by hand, so the board and the film show the same figure'
const MOTION = 'motion comes from the frame alone, never from a CSS transition or animation'
const TOKENS = 'curves come from motion.ease only'
const NO_EASING = (call: number, of: number) =>
  `interpolate call ${call} of ${of} carries no easing: motion.ease.<name>, so it moves on a straight line, which is the first thing that reads as generated`
const NO_CONFIG = (call: number, of: number) =>
  `Remotion.spring call ${call} of ${of} carries no config: motion.spring.<name>; Remotion's default spring bounces`
const OWN_MOTION =
  "the code declares a motion of its own, which the sandbox bans: motion is the house's token object, read it where it is needed"
/** An interpolate on a frame the test never declares; the scan does not run the code. */
const call = (options: string) =>
  `  const v = Remotion.interpolate(frame, [0, 10], [0, 1], ${options})`
const uses = (name: string, reason: string) =>
  `the code uses ${name}, which the sandbox bans: ${reason}`

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
          '  const same = Remotion.Sequence === null || Remotion.Sequence != null\n  const ease = motion.ease.enter',
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

  it.each([
    ['Remotion.Easing.cubic', '  const e = Remotion.Easing.cubic', 'Easing.cubic'],
    ['Easing.elastic', '  const e = Remotion.Easing.elastic(1)', 'Easing.elastic'],
    ['a destructured Easing', '  const { Easing } = Remotion\n  const e = Easing.linear', 'Easing'],
    ['an alias of Easing', '  const E = Remotion.Easing', 'Easing'],
  ])('refuses %s: curves come from motion.ease only (decision 301)', (_name, line, named) => {
    expect(scan(graphic(line))).toBe(
      `the code uses ${named}, which the sandbox no longer offers: ${TOKENS}`,
    )
  })

  it('refuses bracket access to a sandbox argument', () => {
    expect(scan(graphic("  const e = Remotion['Easing']"))).toBe(
      `the code reads Remotion by bracket, which the sandbox bans: ${GIVEN}`,
    )
    expect(scan(graphic("  const s = Remotion['spring']"))).toBe(
      `the code reads Remotion by bracket, which the sandbox bans: ${GIVEN}`,
    )
    expect(scan(graphic("  const e = motion['ease']"))).toBe(
      `the code reads motion by bracket, which the sandbox bans: ${GIVEN}`,
    )
    expect(scan(graphic("  const c = React['createElement']"))).toBe(
      `the code reads React by bracket, which the sandbox bans: ${GIVEN}`,
    )
  })

  it('lets the words Quantitative Easing be shown on screen', () => {
    expect(
      scan(
        `function Graphic(props) {
  return <div><span>Quantitative</span> <span>Easing</span></div>
}
`,
      ),
    ).toBeNull()
  })

  it.each([
    ['spring', '  const sp = Remotion.spring\n  const s = sp({ frame: 1, fps: 30 })'],
    ['interpolate', '  const lerp = Remotion.interpolate\n  const v = lerp(1, [0, 10], [0, 1])'],
  ])('refuses Remotion.%s aliased instead of called', (name, line) => {
    expect(scan(graphic(line))).toBe(
      `the code reads Remotion.${name} without calling it, which the sandbox bans: call Remotion.${name}( where it is used, so the check can read the call`,
    )
  })

  it('refuses interpolate destructured from Remotion: its bare call carries no easing', () => {
    expect(
      scan(
        graphic('  const { interpolate } = Remotion\n  const v = interpolate(1, [0, 10], [0, 1])'),
      ),
    ).toBe(NO_EASING(1, 1))
  })

  it('still passes Remotion.spring( and Remotion.interpolate( called directly', () => {
    expect(
      scan(
        graphic(
          call('{ easing: motion.ease.enter }') +
            '\n  const s = Remotion.spring({ frame, fps: 30, config: motion.spring.snap })',
        ),
      ),
    ).toBeNull()
  })

  it('passes an interpolate on a token curve, an array of them, or a spread with one', () => {
    expect(
      scan(graphic(call("{ easing: motion.ease.enter, extrapolateRight: 'clamp' }"))),
    ).toBeNull()
    expect(scan(graphic(call('{ easing: motion.ease.linear }')))).toBeNull()
    expect(
      scan(
        graphic(
          "  const clamp = { extrapolateLeft: 'clamp' }\n" +
            call('{ ...clamp, easing: motion.ease.exit }'),
        ),
      ),
    ).toBeNull()
    expect(
      scan(
        graphic(
          '  const v = Remotion.interpolate(frame, [0, 10, 20], [0, 1, 0], { easing: [motion.ease.enter, motion.ease.exit] })',
        ),
      ),
    ).toBeNull()
    // Nested brackets inside the call are part of the call.
    expect(
      scan(
        graphic(
          '  const v = Remotion.interpolate(frame, [motion.frames(0, 30), motion.frames(450, 30)], [0, 1], { easing: motion.ease.enter })',
        ),
      ),
    ).toBeNull()
  })

  it('refuses an interpolate with no easing, naming which call', () => {
    expect(scan(graphic(call("{ extrapolateRight: 'clamp' }")))).toBe(NO_EASING(1, 1))
    expect(scan(graphic('  const v = Remotion.interpolate(frame, [0, 10], [0, 1])'))).toBe(
      NO_EASING(1, 1),
    )
    expect(
      scan(
        graphic(
          call('{ easing: motion.ease.enter }') +
            '\n  const w = Remotion.interpolate(frame, [0, 10], [0, 1])',
        ),
      ),
    ).toBe(NO_EASING(2, 2))
  })

  it('refuses an easing that is not a token, or passed through a variable', () => {
    expect(scan(graphic(call('{ easing: motion.ease.quart }')))).toBe(
      'the code uses motion.ease.quart, which is not a token: the curves are motion.ease.enter, exit, move, emphasis and linear',
    )
    expect(scan(graphic('  const ease = motion.ease.enter\n' + call('{ easing: ease }')))).toBe(
      NO_EASING(1, 1),
    )
  })

  it('passes Remotion.spring on a token preset', () => {
    expect(
      scan(
        graphic(
          '  const s = Remotion.spring({ frame, fps: 30, delay: 3, config: motion.spring.settle })',
        ),
      ),
    ).toBeNull()
    expect(
      scan(
        graphic(
          '  const s = Remotion.spring({ frame, fps: 30, config: motion.spring.hero, durationInFrames: 20 })',
        ),
      ),
    ).toBeNull()
  })

  it.each([
    ['no config', '  const s = Remotion.spring({ frame: 0, fps: 30 })'],
    [
      'a literal config',
      '  const s = Remotion.spring({ frame: 0, fps: 30, config: { damping: 9 } })',
    ],
    [
      'a preset spread and changed',
      '  const s = Remotion.spring({ frame: 0, fps: 30, config: { ...motion.spring.hero, damping: 5 } })',
    ],
  ])('refuses Remotion.spring with %s', (_name, line) => {
    expect(scan(graphic(line))).toBe(NO_CONFIG(1, 1))
  })

  it('names which spring call when there are several', () => {
    expect(
      scan(
        graphic(
          '  const a = Remotion.spring({ frame, fps: 30, config: motion.spring.settle })\n  const b = Remotion.spring({ frame, fps: 30 })',
        ),
      ),
    ).toBe(NO_CONFIG(2, 2))
  })

  it.each([
    ['a bare call', '  const s = spring({ frame: 0, fps: 30, config: motion.spring.settle })'],
    [
      'a destructure',
      '  const { spring } = Remotion\n  const s = spring({ frame: 0, fps: 30, config: motion.spring.settle })',
    ],
  ])('refuses spring as %s: only Remotion.spring with a preset', (_name, line) => {
    expect(scan(graphic(line))).toBe(
      'the code calls spring bare, which the sandbox bans: a spring is Remotion.spring({ frame, fps, config: motion.spring.settle }) and nothing else',
    )
  })

  it('refuses a spring preset that is not a token', () => {
    expect(
      scan(
        graphic('  const s = Remotion.spring({ frame, fps: 30, config: motion.spring.bouncy })'),
      ),
    ).toBe(
      'the code uses motion.spring.bouncy, which is not a token: the presets are motion.spring.settle, hero and snap',
    )
  })

  it('does not take a word spring in a string or a longer name for the call', () => {
    expect(scan(graphic("  const note = 'spring'\n  const springy = 1"))).toBeNull()
  })

  it.each([
    ['const motion', '  const motion = { ms: {} }'],
    ['let motion', '  let motion'],
    ['function motion', '  function motion() {}'],
    ['a motion parameter', '  const f = (frame, motion) => frame'],
    ['a destructured motion', '  const { motion } = props'],
  ])("refuses %s: the token object is the house's", (_name, line) => {
    expect(scan(graphic(line))).toBe(OWN_MOTION)
  })

  it('does not take motion read as an argument or in an object for a declaration', () => {
    expect(
      scan(
        graphic(
          '  const style = { opacity: 1, marginTop: motion.px.rise }\n  const f = motion.frames(motion.ms.enter, 30)\n  const inMotion = 1\n  const motionless = 2',
        ),
      ),
    ).toBeNull()
  })

  it('refuses an assignment to a token, plain or compound', () => {
    expect(scan(graphic('  motion.ms.enter = 1'))).toBe(
      'the code assigns to motion.ms, which the sandbox bans: the sandbox is read-only',
    )
    expect(scan(graphic('  motion.ease.enter ??= null'))).toBe(
      'the code assigns to motion.ease, which the sandbox bans: the sandbox is read-only',
    )
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

  it("refuses the reviewer's probe: a host function's constructor is the host's Function", () => {
    // `process` sits inside a string, which the scan blanks; `constructor` does not.
    expect(scan(graphic('  const env = React.createElement.constructor("return process")()'))).toBe(
      uses('constructor', GIVEN),
    )
  })

  it.each([
    ['constructor', '  const make = Remotion.interpolate.constructor', GIVEN],
    ['__proto__', '  const up = props.__proto__', GIVEN],
    ['prototype', '  const shape = Object.prototype', GIVEN],
    ['getPrototypeOf', '  const up = Object.getPrototypeOf(props)', GIVEN],
    ['Reflect', '  const keys = Reflect.ownKeys(props)', GIVEN],
    ['Proxy', '  const spy = new Proxy({}, {})', GIVEN],
    ['self', "  const get = self['fe' + 'tch']", PURE],
    ['navigator', "  navigator.sendBeacon('/x', '')", PURE],
    ['top', '  const up = top.location', PURE],
    ['parent', "  parent.postMessage('x', '*')", PURE],
    ['frames', '  const first = frames[0]', PURE],
    ['opener', '  const back = opener.document', PURE],
    ['location', "  location = 'https://example.com'", PURE],
    ['XMLHttpRequest', '  const request = new XMLHttpRequest()', PURE],
    ['WebSocket', "  const socket = new WebSocket('wss://example.com')", PURE],
    ['EventSource', "  const feed = new EventSource('/x')", PURE],
    ['localStorage', "  const kept = localStorage.getItem('x')", PURE],
    ['sessionStorage', "  const kept = sessionStorage.getItem('x')", PURE],
    ['indexedDB', "  const db = indexedDB.open('x')", PURE],
    ['postMessage', '  const send = props.postMessage', PURE],
    ['importScripts', "  importScripts('/x.js')", PURE],
    ['Worker', "  const worker = new Worker('/x.js')", PURE],
    ['toLocaleString', '  const figure = (4000000).toLocaleString()', DIGITS],
    ['Intl', "  const figure = new Intl.NumberFormat('en').format(4)", DIGITS],
  ])('refuses %s', (name, line, reason) => {
    expect(scan(graphic(line))).toBe(uses(name, reason))
  })

  it('refuses dangerouslySetInnerHTML, as a JSX attribute or a quoted key', () => {
    const attribute = graphic('').replace(
      '<div>Acme</div>',
      "<div dangerouslySetInnerHTML={{ __html: '<b>Acme</b>' }} />",
    )
    expect(scan(attribute)).toBe(uses('dangerouslySetInnerHTML', PAGE))
    const quoted = graphic("  const raw = { 'dangerouslySetInnerHTML': { html: 'x' } }")
    expect(scan(quoted)).toBe(uses('dangerouslySetInnerHTML', PAGE))
  })

  it('refuses a banned name spelt out in a string for bracket access', () => {
    expect(scan(graphic("  const make = React.createElement['constructor']"))).toBe(
      uses('constructor', GIVEN),
    )
    expect(scan(graphic("  const up = props['__proto__']"))).toBe(uses('__proto__', GIVEN))
    expect(scan(graphic("  const figure = (4)['toLocaleString']()"))).toBe(
      uses('toLocaleString', DIGITS),
    )
  })

  it('refuses elements that run code, load a page or change the document', () => {
    for (const element of [
      'script',
      'iframe',
      'object',
      'embed',
      'link',
      'style',
      'meta',
      'base',
      'form',
    ]) {
      const jsx = graphic('').replace('<div>Acme</div>', `<${element} />`)
      expect(scan(jsx)).toBe(`the code makes a ${element} element, which the sandbox bans: ${PAGE}`)
    }
    // An alias for createElement is caught the same way.
    expect(scan(graphic("  const h = React.createElement\n  h('script', { src: '/x.js' })"))).toBe(
      `the code makes a script element, which the sandbox bans: ${PAGE}`,
    )
  })

  it('lets those names through where they are words, keys or members of its own', () => {
    const source = graphic(
      [
        '  const inset = props.safeArea',
        '  const top = inset.top + 10',
        "  const kind = typeof props.data === 'object' ? 'chart' : 'graphic'",
        "  const mark = props.logos['Meta']",
        "  const place = { location: 'Munich', parent: 'Acme' }",
      ].join('\n'),
    ).replace(
      '<div>Acme</div>',
      "<div style={{ position: 'absolute', top: top, left: inset.left }}>The parent company, its location and its prototype</div>",
    )
    expect(scan(source)).toBeNull()
  })

  it('refuses a CSS transition, animation or @keyframes: motion comes from the frame', () => {
    const styled = (style: string) =>
      graphic('').replace('<div>Acme</div>', `<div style={{ ${style} }}>Acme</div>`)
    expect(scan(styled("transition: 'opacity 0.3s'"))).toBe(uses('transition', MOTION))
    expect(scan(styled("transitionProperty: 'opacity'"))).toBe(uses('transition', MOTION))
    expect(scan(styled("WebkitTransition: 'opacity 0.3s'"))).toBe(uses('transition', MOTION))
    expect(scan(styled("animation: 'spin 1s'"))).toBe(uses('animation', MOTION))
    expect(scan(styled("animationName: 'spin'"))).toBe(uses('animation', MOTION))
    expect(scan(styled("'transition': 'opacity 0.3s'"))).toBe(uses('transition', MOTION))
    expect(scan(graphic("  const css = '@keyframes spin { to { opacity: 1 } }'"))).toBe(
      uses('@keyframes', MOTION),
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
