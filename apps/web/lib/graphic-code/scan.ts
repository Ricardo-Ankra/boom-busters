import { GRAPHIC_SOURCE_MAX } from '@boom-busters/schemas'

/**
 * The static scan (decision 295): what the designer's code may not touch,
 * read off esbuild's compiled output before anything runs. The dry run's `vm` context has
 * no `window`, `fetch` or timers, so code that reaches for them fails there
 * too; `Date`, `Math.random`, `eval`, `Function` and the stateful hooks do
 * exist there, and each makes a frame depend on something other than the
 * frame. The scan is the guard for those. It is not a security boundary:
 * the designer is a model writing honest code, and this keeps it honest.
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
]

/**
 * An assignment, plain or compound (`+=`, `??=`, ...), to any member chain
 * under `Remotion` or `React` (not `==`, `===` or `=>`). The sandbox freezes
 * its scope, but a freeze is shallow and Remotion's `Easing` statics are
 * writable, so one graphic could break every later one in the same process
 * by assigning to `Remotion.Easing.linear`. The first member is named.
 */
const ASSIGNS_TO_SANDBOX =
  /\b(Remotion|React)((?:\s*\.\s*[\w$]+)+)\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])/

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
  const assigned = ASSIGNS_TO_SANDBOX.exec(code)
  if (assigned) {
    const member = /[\w$]+/.exec(assigned[2] ?? '')?.[0] ?? ''
    return `the code assigns to ${assigned[1]}.${member}, which the sandbox bans: the sandbox is read-only`
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
