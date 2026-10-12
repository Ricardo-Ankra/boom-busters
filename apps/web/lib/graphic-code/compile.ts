import { transformSync, type Message, type TransformOptions } from 'esbuild'

/**
 * The designer's JSX as plain JavaScript (decision 295): esbuild's
 * `transformSync`, JSX to `React.createElement` calls, ES2020, and no module
 * format, so the top-level `function Graphic` stays a plain declaration the
 * sandbox's appended `return Graphic` can reach. Server only: esbuild runs a
 * native binary, which `serverExternalPackages` keeps out of the bundle.
 */
const OPTIONS: TransformOptions = {
  loader: 'jsx',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  target: 'es2020',
}

export function compileGraphicSource(
  source: string,
): { ok: true; compiled: string } | { ok: false; issue: string } {
  try {
    const { code } = transformSync(source, OPTIONS)
    return { ok: true, compiled: code }
  } catch (error) {
    const first = failureMessages(error)[0]
    // Anything but a compile failure (a missing binary, a dead service) is
    // not the designer's mistake, and no retry of the model can fix it.
    if (!first) throw error
    const line = first.location ? ` (line ${first.location.line})` : ''
    return { ok: false, issue: `the code does not compile: ${first.text}${line}` }
  }
}

/** The messages of an esbuild transform failure; none for any other error. */
function failureMessages(error: unknown): Message[] {
  if (typeof error !== 'object' || error === null || !('errors' in error)) return []
  return Array.isArray(error.errors) ? (error.errors as Message[]) : []
}

let compilerProven = false

/**
 * Compiles one line, once per process, so a host where esbuild cannot run
 * (its platform binary missing from the function, or not executable) is
 * found before a model call is paid for, not after (final review I2).
 * `designGraphicWith` calls it beside `ensureDryRunRuntime`. Throws naming
 * the failure; a success is remembered, a failure is tried again next time.
 */
export function ensureGraphicCompiler(): void {
  if (compilerProven) return
  try {
    transformSync('function Graphic() { return <div /> }', OPTIONS)
  } catch (error) {
    throw new Error(
      `the designer's checks cannot compile code on this host: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  compilerProven = true
}
