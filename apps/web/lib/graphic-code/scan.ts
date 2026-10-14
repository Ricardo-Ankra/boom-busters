import { MOTION_EASE_NAMES, MOTION_SPRING_NAMES } from '@boom-busters/compositions/motion-tokens'
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
 * Since decision 301 it also holds the motion tokens: `Easing` in any form, an
 * `interpolate` without `easing: motion.ease.<name>` in its call text, a spring
 * that is not `Remotion.spring` with `config: motion.spring.<name>`, bracket
 * access to the sandbox, and a `motion` binding or assignment of the design's
 * own.
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
const TOKENS = 'curves come from motion.ease only'

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
 * under `Remotion`, `React` or `motion` (not `==`, `===` or `=>`). The sandbox
 * freezes its scope and hands the code frozen copies of `Easing` (and, in the
 * dry run, of React), the tokens are frozen through, and the body runs in
 * strict mode, so any assignment to them throws in the dry run whatever its
 * syntax; this names the plain forms before anything runs. The first member
 * is named. A `motion` that is a member of the design's own object
 * (`p.motion.x = 1`) is not the tokens.
 */
const ASSIGNS_TO_SANDBOX =
  /\b(Remotion|React|(?<![\w$.])motion)((?:\s*\??\.\s*[\w$]+)+)\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])/

/**
 * What esbuild leaves of a logical assignment two members deep:
 * `motion.ease.enter ??= x` compiles to `(_a = motion.ease).enter ?? (_a.enter = x)`,
 * whose plain `=` is on a temporary, so the rule above cannot see it. The
 * first member of the chain is named, as there.
 */
const ASSIGNS_VIA_TEMPORARY =
  /\(\s*[\w$]+\s*=\s*(Remotion|React|motion)((?:\s*\.\s*[\w$]+)+)\s*\)\s*\.\s*[\w$]+\s*(?:\?\?|\|\||&&)/

/**
 * Bracket access to a sandbox argument (`Remotion['spring']`, `motion['ease']`,
 * `Remotion?.['spring']`): the one spelling that reaches past every dot-form
 * rule below.
 */
const BRACKETS_SANDBOX = /\b(Remotion|React|motion)\s*(?:\?\.\s*)?\[/

/**
 * A `motion` of the design's own: a declaration, a parameter, a destructure
 * (in a declaration or a parameter list, `({ motion }) =>`) or a bare
 * reassignment at a statement's start (`motion = ...`). The preamble declares
 * `const motion` in the same function body, so a second declaration would be
 * a syntax error at parse time; this says what to do instead. The whole
 * `motion` object passed as an argument (`f(motion)`, `f(a.b, motion)`) is
 * refused with them, since the clause for a parameter cannot tell the two
 * apart. Not matched: a member of it as an argument (`f(motion.ms.enter)`),
 * a call's object holding a token (`{ config: motion.spring.settle }`), an
 * object literal's `motion` key or shorthand (`{ frame, motion }`), a member
 * of the design's own object (`p.motion`) and names that contain it
 * (`inMotion`).
 */
const DECLARES_MOTION = new RegExp(
  [
    // A declaration.
    /\b(?:const|let|var|function|class)\s+motion\b/.source,
    // A parameter, or the whole object as an argument: only a parameter list
    // or a call's arguments, never an object literal's shorthand.
    /\(\s*(?:[\w$]+\s*,\s*)*motion\s*[,)=]/.source,
    /,\s*motion\s*\)/.source,
    // A destructure in a declaration.
    /\{[^{}]*\bmotion\b[^{}]*\}\s*=(?![=>])/.source,
    // A destructured parameter: `motion` bound in braces (shorthand, renamed
    // to or with a default), then the parameter list closes into a body.
    /\{(?:[^{}]*[,:])?\s*motion\s*(?=[,}]|=(?![=>]))[^{}]*\}[^(){}]*\)\s*(?:=>|\{)/.source,
    // A bare reassignment.
    /(?:^|[;{}\n])\s*motion\s*=(?![=>])/.source,
  ].join('|'),
)

/**
 * `Easing` as an identifier in any shape: `Remotion.Easing.cubic`, a
 * destructure, an alias. The curves are the tokens (decision 301); the only
 * `Easing` in a stored design is the preamble's, which is prepended after this
 * scan. The member is named when there is one.
 */
const USES_EASING = /\bEasing\b(?:\s*\??\.\s*([\w$]+))?/

/*
 * Each rule that joins members of `Remotion` or `motion`, here and in the
 * sandbox rules above, reads a join as `.` or `?.`: esbuild keeps optional
 * chaining at es2020, so `Remotion?.spring(` reaches the scan as written.
 */

/** Every `motion.ease.<x>` and `motion.spring.<x>` the code names. */
const EASE_TOKEN = /\bmotion\s*\??\.\s*ease\s*\??\.\s*([\w$]+)/g
const SPRING_TOKEN = /\bmotion\s*\??\.\s*spring\s*\??\.\s*([\w$]+)/g

/**
 * `easing: motion.ease.<x>`, or an array of them, as the text of an
 * `interpolate` call must carry. A quoted key (`'easing':`) reaches the scan
 * blanked to `""`, so a blanked key holding a token passes too, here and in
 * SPRING_CONFIG.
 */
const EASING_OPTION =
  /(?:\beasing|"")\s*:\s*(?:motion\s*\??\.\s*ease\s*\??\.\s*[\w$]+|\[\s*motion\s*\??\.\s*ease\s*\??\.\s*[\w$]+(?:\s*,\s*motion\s*\??\.\s*ease\s*\??\.\s*[\w$]+)*\s*,?\s*\])/
/** `config: motion.spring.<x>`, as the text of a `Remotion.spring` call must carry. */
const SPRING_CONFIG = /(?:\bconfig|"")\s*:\s*motion\s*\??\.\s*spring\s*\??\.\s*[\w$]+/
/**
 * A bare `spring(` call, or `spring` destructured from `Remotion`, plain or
 * renamed (`{ spring: sp }`); `Remotion.spring` read without a call is caught
 * by ALIASES_CALLED_API.
 */
const BARE_SPRING = /(?<![\w$.])spring\s*\(|\{[^}]*\bspring\b[^}]*\}\s*=\s*Remotion\b/
/**
 * `interpolate` destructured from `Remotion`, plain or renamed
 * (`{ interpolate: lerp }`): a renamed call escapes the easing rule.
 */
const TAKES_INTERPOLATE = /\{[^}]*\binterpolate\b[^}]*\}\s*=\s*Remotion\b/
/**
 * `Remotion.spring` or `Remotion.interpolate` read without being called
 * (`const sp = Remotion.spring`): the alias's calls would escape the call rules.
 * An optional call (`Remotion.spring?.(`) is a call, and the call rules below
 * check it like a plain one.
 */
const ALIASES_CALLED_API = /\bRemotion\s*\??\.\s*(spring|interpolate)\b(?!\s*(?:\?\.)?\s*\()/
const INTERPOLATE_CALL = /\binterpolate\s*(?:\?\.)?\s*\(/g
const REMOTION_SPRING_CALL = /\bRemotion\s*\??\.\s*spring\s*(?:\?\.)?\s*\(/g

const EASE_NAMES = new Set<string>(MOTION_EASE_NAMES)
const SPRING_NAMES = new Set<string>(MOTION_SPRING_NAMES)

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
  const bracketed = BRACKETS_SANDBOX.exec(code)
  if (bracketed) {
    return `the code reads ${bracketed[1] ?? ''} by bracket, which the sandbox bans: ${GIVEN}`
  }
  if (DECLARES_MOTION.test(code)) {
    return "the code declares a motion of its own, which the sandbox bans: motion is the house's token object, read it where it is needed"
  }
  const assigned = ASSIGNS_TO_SANDBOX.exec(code) ?? ASSIGNS_VIA_TEMPORARY.exec(code)
  if (assigned) {
    const member = /[\w$]+/.exec(assigned[2] ?? '')?.[0] ?? ''
    return `the code assigns to ${assigned[1]}.${member}, which the sandbox bans: the sandbox is read-only`
  }
  const easing = USES_EASING.exec(code)
  if (easing) {
    const named = easing[1] ? `Easing.${easing[1]}` : 'Easing'
    return `the code uses ${named}, which the sandbox no longer offers: ${TOKENS}`
  }
  for (const match of code.matchAll(EASE_TOKEN)) {
    const name = match[1] ?? ''
    if (!EASE_NAMES.has(name)) {
      return `the code uses motion.ease.${name}, which is not a token: the curves are motion.ease.enter, exit, move, emphasis and linear`
    }
  }
  for (const match of code.matchAll(SPRING_TOKEN)) {
    const name = match[1] ?? ''
    if (!SPRING_NAMES.has(name)) {
      return `the code uses motion.spring.${name}, which is not a token: the presets are motion.spring.settle, hero and snap`
    }
  }
  const aliased = ALIASES_CALLED_API.exec(code)
  if (aliased) {
    const name = aliased[1] ?? ''
    return `the code reads Remotion.${name} without calling it, which the sandbox bans: call Remotion.${name}( where it is used, so the check can read the call`
  }
  if (TAKES_INTERPOLATE.test(code)) {
    return 'the code takes interpolate out of Remotion, which the sandbox bans: call Remotion.interpolate( where it is used, so the check can read the call'
  }
  const interpolates = calls(code, INTERPOLATE_CALL)
  for (const [index, text] of interpolates.entries()) {
    if (!EASING_OPTION.test(text)) {
      return `interpolate call ${index + 1} of ${interpolates.length} carries no easing: motion.ease.<name>, so it moves on a straight line, which is the first thing that reads as generated`
    }
  }
  if (BARE_SPRING.test(code)) {
    return 'the code calls spring bare, which the sandbox bans: a spring is Remotion.spring({ frame, fps, config: motion.spring.settle }) and nothing else'
  }
  const springs = calls(code, REMOTION_SPRING_CALL)
  for (const [index, text] of springs.entries()) {
    if (!SPRING_CONFIG.test(text)) {
      return `Remotion.spring call ${index + 1} of ${springs.length} carries no config: motion.spring.<name>; Remotion's default spring bounces`
    }
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
 * The text of each call that `name` opens, from its first character to the
 * bracket that closes the call, in blanked code (so a bracket inside a string
 * does not count). A call that never closes runs to the end of the code.
 * Known limit: the text includes any call nested inside, so a nested
 * interpolate's `easing:` also satisfies the call around it.
 */
function calls(code: string, name: RegExp): string[] {
  const found: string[] = []
  for (const match of code.matchAll(name)) {
    const start = match.index ?? 0
    let depth = 0
    let end = code.length
    for (let at = start + match[0].length - 1; at < code.length; at += 1) {
      const char = code[at]
      if (char === '(' || char === '[' || char === '{') depth += 1
      else if (char === ')' || char === ']' || char === '}') {
        depth -= 1
        if (depth === 0) {
          end = at + 1
          break
        }
      }
    }
    found.push(code.slice(start, end))
  }
  return found
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
