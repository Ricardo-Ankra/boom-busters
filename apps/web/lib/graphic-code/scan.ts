import { GRAPHIC_SOURCE_MAX } from '@boom-busters/schemas'

/**
 * The static scan (decision 295): what the designer's code may not touch,
 * read off the source before anything runs. The dry run's `vm` context has
 * no `window`, `fetch` or timers, so code that reaches for them fails there
 * too; `Date`, `Math.random`, `eval`, `Function` and the stateful hooks do
 * exist there, and each makes a frame depend on something other than the
 * frame. The scan is the guard for those. It is not a security boundary:
 * the designer is a model writing honest code, and this keeps it honest.
 *
 * Identifiers are matched in the code with its strings and comments
 * blanked, and the ones that are also English words only in the shapes
 * code uses them (`Date.now`, `new Date`, `window.`, `eval(`), so a caption
 * reading "a leaked document" or "the window closed" is not refused.
 * Colours are matched inside strings, where a CSS colour lives.
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
]

/**
 * `Remotion.<name> =` or `React.<name> =` (not `==`, `===` or `=>`). The
 * sandbox freezes its scope, but a freeze is shallow and Remotion's `Easing`
 * statics are writable, so one graphic could break every later one in the
 * same process by assigning to them.
 */
const ASSIGNS_TO_SANDBOX = /\b(Remotion|React)\s*\.\s*([\w$]+)\s*=(?![=>])/

/** A colour-length hex literal: #rgb, #rgba, #rrggbb or #rrggbbaa. */
const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/
const COLOUR_FUNCTION = /\b(rgba?|hsla?)\s*\(/i
const DECLARES_GRAPHIC = /\bfunction\s+Graphic\s*\(/

/** null when the source is clean; else the first thing wrong with it, as a sentence. */
export function scanGraphicSource(source: string): string | null {
  if (source.length > GRAPHIC_SOURCE_MAX) {
    return `the code is ${source.length} characters; at most ${GRAPHIC_SOURCE_MAX} fit`
  }
  const { code, strings } = splitSource(source)
  if (!DECLARES_GRAPHIC.test(code)) {
    return 'the code does not declare function Graphic(props) at the top level'
  }
  const banned = BANNED.find(({ pattern }) => pattern.test(code))
  if (banned) return `the code uses ${banned.name}, which the sandbox bans: ${banned.reason}`
  const assigned = ASSIGNS_TO_SANDBOX.exec(code)
  if (assigned) {
    return `the code assigns to ${assigned[1]}.${assigned[2]}, which the sandbox bans: the sandbox is read-only`
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
 * of each template literal's literal parts. A lexer, not a parser: an
 * apostrophe in JSX text opens a "string" to the end of its line, which
 * only ever blanks words on screen, and a regex literal is read as code.
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
