import { GRAPHIC_SOURCE_MAX } from '@boom-busters/schemas'

/**
 * The static scan (decision 295): what the designer's code may not touch,
 * read off esbuild's compiled output before anything runs. The dry run's `vm` context has
 * no `window`, `fetch` or timers, so code that reaches for them fails there
 * too; `Date`, `Math.random`, `eval`, `Function` and the stateful hooks do
 * exist there, and each makes a frame depend on something other than the
 * frame. The scan is the guard for those. It is not a security boundary:
 * the designer is a model writing honest code, and this keeps it honest. It
 * also refuses the one-line routes out of the sandbox (`constructor`,
 * `prototype`, `Reflect`, the browser's other globals, `dangerouslySetInnerHTML`
 * and elements such as `script`), so reaching the host costs more than a line;
 * a name built at run time (`fn['con' + 'structor']`) still gets past it, and
 * real isolation is the owner's decision (PROGRESS decision 295).
 *
 * The scan reads the COMPILED code, not the source: after esbuild, JSX text
 * and attribute values are ordinary string literals and comments are gone,
 * so blanking strings is sound (in the source, an apostrophe in JSX text
 * would open a "string" and hide the rest of its line). Identifiers are
 * matched outside strings and comments, and the ones that are also English
 * words only in the shapes code uses them (`Date.now`, `new Date`,
 * `window.`, `eval(`). Colours are matched inside strings, where a CSS
 * colour always lives in compiled code. Only the size cap and the
 * `function Graphic(` requirement read the source.
 */

const PURE = 'a graphic must be a pure function of the frame'
const GIVEN = 'everything it needs arrives as React, Remotion and props'
const COLOURS = 'colours come from props.brand.colors, with Remotion.withAlpha for opacity'
const PAGE = 'a graphic draws React elements inside its frame and touches nothing else on the page'
const DIGITS = 'write the digits by hand, so the board and the film show the same figure'
const MOTION = 'motion comes from the frame alone, never from a CSS transition or animation'

/** The name as an identifier anywhere in the code, a member included (`fn.constructor`). */
const word = (name: string) => new RegExp(`\\b${name}\\b`)
/** The name as a bare identifier, not a member (`inset.self`). */
const bare = (name: string) => new RegExp(`(?<![\\w$.])${name}\\b`)
/**
 * The name used as the browser global it also is: read through (`top.fetch`,
 * `frames[0]`), called, or assigned. A style's `top:`, a member such as
 * `inset.top` and a declaration of the code's own (`const top = ...`) are not.
 */
const usedAsGlobal = (name: string) =>
  new RegExp(`(?<![\\w$.])(?<!\\b(?:const|let|var)\\s+)${name}\\s*(?:\\?\\.|\\.|\\[|\\(|=(?![=>]))`)

const BANNED: readonly { name: string; pattern: RegExp; reason: string }[] = [
  { name: 'import', pattern: /(?:^|[;{}])\s*import\b|\bimport\s*\(/m, reason: GIVEN },
  { name: 'require', pattern: /\brequire\s*\(/, reason: GIVEN },
  { name: 'window', pattern: /\bwindow\s*(?:\.[\w$]|\[)/, reason: PURE },
  { name: 'document', pattern: /\bdocument\s*(?:\.[\w$]|\[)/, reason: PURE },
  { name: 'globalThis', pattern: /\bglobalThis\b/, reason: PURE },
  { name: 'process', pattern: /\bprocess\s*(?:\.[\w$]|\[)/, reason: PURE },
  { name: 'fetch', pattern: /\bfetch\s*\(/, reason: PURE },
  { name: 'setTimeout', pattern: /\bsetTimeout\b/, reason: PURE },
  { name: 'setInterval', pattern: /\bsetInterval\b/, reason: PURE },
  { name: 'requestAnimationFrame', pattern: /\brequestAnimationFrame\b/, reason: PURE },
  { name: 'Date', pattern: /\bnew\s+Date\b|\bDate\s*(?:\.[\w$]|\()/, reason: PURE },
  { name: 'Math.random', pattern: /\bMath\s*\.\s*random\b/, reason: PURE },
  { name: 'eval', pattern: /\beval\s*\(/, reason: PURE },
  // Case-sensitive: `function Graphic(` is a declaration, not the constructor.
  { name: 'Function', pattern: /\bnew\s+Function\b|\bFunction\s*\(/, reason: PURE },
  { name: 'useState', pattern: /\buseState\b/, reason: PURE },
  { name: 'useEffect', pattern: /\buseEffect\b/, reason: PURE },
  { name: 'useLayoutEffect', pattern: /\buseLayoutEffect\b/, reason: PURE },
  // A throw inside a Suspense boundary is swallowed by the dry run's renderer.
  { name: 'Suspense', pattern: /\bSuspense\b/, reason: PURE },
  { name: 'lazy', pattern: /\blazy\b/, reason: PURE },
  // Past the objects the code is handed: any host function's `constructor` is
  // the host's own `Function`, which reaches the host's globals.
  ...['constructor', '__proto__', 'prototype', 'getPrototypeOf', 'Reflect', 'Proxy'].map(
    (name) => ({ name, pattern: word(name), reason: GIVEN }),
  ),
  { name: 'dangerouslySetInnerHTML', pattern: word('dangerouslySetInnerHTML'), reason: PAGE },
  // The browser's other ways out of the frame: other windows, storage, the network.
  ...['self', 'navigator'].map((name) => ({ name, pattern: bare(name), reason: PURE })),
  ...['top', 'parent', 'frames', 'opener', 'location'].map((name) => ({
    name,
    pattern: usedAsGlobal(name),
    reason: PURE,
  })),
  ...[
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'postMessage',
    'importScripts',
    'Worker',
  ].map((name) => ({ name, pattern: word(name), reason: PURE })),
  // The viewer's locale formats these: "1,9" on a board in en-ZA, "1.9" on Lambda.
  { name: 'toLocaleString', pattern: /\btoLocale\w*String\b/, reason: DIGITS },
  { name: 'Intl', pattern: word('Intl'), reason: DIGITS },
  // The Player smooths a CSS transition between frames; Lambda captures each
  // frame as it lands, so the film would lag what the board played.
  {
    name: 'transition',
    pattern: /\btransition(?:[A-Z][\w$]*)?\b|\b(?:Webkit|Moz|ms)Transition/,
    reason: MOTION,
  },
  {
    name: 'animation',
    pattern: /\banimation(?:[A-Z][\w$]*)?\b|\b(?:Webkit|Moz|ms)Animation/,
    reason: MOTION,
  },
]

/**
 * A string that spells out a banned name, which bracket access turns into the
 * member itself (`fn['constructor']`, a quoted style key `'transition'`).
 */
const BANNED_STRINGS: readonly {
  pattern: RegExp
  name: (text: string) => string
  reason: string
}[] = [
  {
    pattern: /^(?:constructor|__proto__|prototype|getPrototypeOf)$/,
    name: (text) => text,
    reason: GIVEN,
  },
  { pattern: /^dangerouslySetInnerHTML$/, name: (text) => text, reason: PAGE },
  { pattern: /^toLocale\w*String$/, name: () => 'toLocaleString', reason: DIGITS },
  { pattern: /^transition(?:[A-Z]\w*)?$/, name: () => 'transition', reason: MOTION },
  { pattern: /^animation(?:[A-Z]\w*)?$/, name: () => 'animation', reason: MOTION },
  { pattern: /@keyframes/, name: () => '@keyframes', reason: MOTION },
]

/**
 * An element a graphic may not make: one that runs code, loads a page or a
 * stylesheet, or changes the document (`React.createElement("script", ...)`,
 * which is also what `<script>` compiles to, or an alias such as `h("iframe")`):
 * a quoted name as the first argument of a call. Case-sensitive, as React's
 * element names are, so a logo keyed "Meta" is not one.
 */
const BANNED_ELEMENT =
  /[\w$)\]]\s*\(\s*(["'`])(script|iframe|object|embed|link|style|meta|base|form)\1/

/**
 * An assignment, plain or compound (`+=`, `??=`, ...), to any member chain
 * under `Remotion` or `React` (not `==`, `===` or `=>`). The sandbox freezes
 * its scope and hands the code frozen copies of `Easing` (and, in the dry run,
 * of React), and the body runs in strict mode, so any assignment to them
 * throws in the dry run whatever its syntax; this names the plain forms before
 * anything runs. The first member is named.
 */
const ASSIGNS_TO_SANDBOX =
  /\b(Remotion|React)((?:\s*\.\s*[\w$]+)+)\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])/

/**
 * `spring`, in any of its shapes: `Remotion.spring`, a bare `spring(` call, or
 * a destructure of it from `Remotion`. Refused for NEW designs (the owner's
 * ruling of 2026-10-12: no bouncy entrances); the runtime scope keeps
 * `spring` for designs stored before 2026-10-12, so those still render.
 */
const USES_SPRING =
  /\bRemotion\s*\.\s*spring\b|(?<![\w$.])spring\s*\(|\{[^}]*\bspring\b[^}]*\}\s*=\s*Remotion\b/
/** The easings that pass their mark and come back. */
const OVERSHOOTING_EASING = /\bEasing\s*\.\s*(elastic|bounce|back|spring)\b/

/** A colour-length hex literal: #rgb, #rgba, #rrggbb or #rrggbbaa. */
const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/
const COLOUR_FUNCTION = /\b(rgba?|hsla?)\s*\(/i
const DECLARES_GRAPHIC = /\bfunction\s+Graphic\s*\(/

/**
 * null when the design is clean; else the first thing wrong with it, as a
 * sentence. `compiled` is `compileGraphicSource`'s output for `source`.
 */
export function scanGraphicSource(source: string, compiled: string): string | null {
  if (source.length > GRAPHIC_SOURCE_MAX) {
    return `the code is ${source.length} characters; at most ${GRAPHIC_SOURCE_MAX} fit`
  }
  if (!DECLARES_GRAPHIC.test(splitSource(source).code)) {
    return 'the code does not declare function Graphic(props) at the top level'
  }
  const { code, strings } = splitSource(compiled)
  const banned = BANNED.find(({ pattern }) => pattern.test(code))
  if (banned) return `the code uses ${banned.name}, which the sandbox bans: ${banned.reason}`
  for (const text of strings) {
    const spelt = BANNED_STRINGS.find(({ pattern }) => pattern.test(text))
    if (spelt) return `the code uses ${spelt.name(text)}, which the sandbox bans: ${spelt.reason}`
  }
  const element = BANNED_ELEMENT.exec(compiled)
  if (element) {
    return `the code makes a ${element[2] ?? ''} element, which the sandbox bans: ${PAGE}`
  }
  const assigned = ASSIGNS_TO_SANDBOX.exec(code)
  if (assigned) {
    const member = /[\w$]+/.exec(assigned[2] ?? '')?.[0] ?? ''
    return `the code assigns to ${assigned[1]}.${member}, which the sandbox bans: the sandbox is read-only`
  }
  if (USES_SPRING.test(code)) {
    return 'the code uses spring, which the sandbox no longer offers: an entrance eases to its mark with interpolate and Easing.out and never overshoots'
  }
  const overshoot = OVERSHOOTING_EASING.exec(code)
  if (overshoot) {
    return `the code uses Easing.${overshoot[1] ?? ''}, which overshoots: the house settles without a bounce`
  }
  for (const text of strings) {
    const hex = HEX_COLOUR.exec(text)
    if (hex) return `the code writes the colour ${hex[0]}: ${COLOURS}`
    const colour = COLOUR_FUNCTION.exec(text)
    if (colour)
      return `the code writes a colour with ${(colour[1] ?? '').toLowerCase()}(): ${COLOURS}`
  }
  return null
}

/**
 * The source split for the scan: `code`, with every comment and the text
 * of every string and template blanked (line breaks kept, so `^` still
 * finds a line's start), and `strings`, the text of each string literal and
 * of each template literal's literal parts. A lexer, not a parser, meant
 * for compiled code: JSX text is not a string until esbuild has made it one
 * (an apostrophe in raw JSX text would open a "string"). A regex literal is
 * recognised by what precedes the slash and blanked, so a quote inside one
 * does not open a string.
 */
export function splitSource(source: string): { code: string; strings: string[] } {
  let code = ''
  const strings: string[] = []
  // Per open template expression (`${`), how many of its own braces are open.
  const expressions: number[] = []

  // From just inside a template (after its backtick, or after an expression's
  // closing brace) to just past its closing backtick or its next `${`.
  const template = (from: number): number => {
    let text = ''
    let at = from
    while (at < source.length) {
      const char = source[at]
      if (char === '\\') {
        text += source.slice(at, at + 2)
        at += 2
      } else if (char === '`') {
        strings.push(text)
        return at + 1
      } else if (char === '$' && source[at + 1] === '{') {
        strings.push(text)
        expressions.push(0)
        return at + 2
      } else {
        if (char === '\n') code += '\n'
        text += char ?? ''
        at += 1
      }
    }
    strings.push(text)
    return at
  }

  let at = 0
  while (at < source.length) {
    const char = source[at]
    const next = source[at + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', at)
      at = end === -1 ? source.length : end
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2)
      const comment = source.slice(at, end === -1 ? source.length : end + 2)
      code += comment.replace(/[^\n]/g, ' ')
      at += comment.length
      continue
    }
    if (char === '/' && regexCanStart(code)) {
      let end = at + 1
      let inClass = false
      while (end < source.length && source[end] !== '\n') {
        const c = source[end]
        if (c === '\\') end += 1
        else if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) break
        end += 1
      }
      if (source[end] === '/') {
        code += '0'
        at = end + 1
        continue
      }
    }
    if (char === "'" || char === '"') {
      let text = ''
      let end = at + 1
      while (end < source.length && source[end] !== char && source[end] !== '\n') {
        if (source[end] === '\\') {
          text += source.slice(end, end + 2)
          end += 2
        } else {
          text += source[end] ?? ''
          end += 1
        }
      }
      strings.push(text)
      code += '""'
      at = source[end] === char ? end + 1 : end
      continue
    }
    if (char === '`') {
      code += '""'
      at = template(at + 1)
      continue
    }
    if (expressions.length > 0 && (char === '{' || char === '}')) {
      const depth = expressions[expressions.length - 1] ?? 0
      if (char === '}' && depth === 0) {
        expressions.pop()
        at = template(at + 1)
        continue
      }
      expressions[expressions.length - 1] = depth + (char === '{' ? 1 : -1)
    }
    code += char ?? ''
    at += 1
  }
  return { code, strings }
}

/** A slash starts a regex literal after an operator or an opening bracket, not after a value. */
function regexCanStart(code: string): boolean {
  const before = code.trimEnd()
  if (before === '') return true
  return /[(,=:[!&|?{};+\-*%<>~^]$/.test(before) || /\b(?:return|typeof)$/.test(before)
}
