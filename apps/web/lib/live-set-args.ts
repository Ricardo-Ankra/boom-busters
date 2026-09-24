/**
 * The live set harness's command-line arguments (decision 275, Task 13),
 * parsed and validated as a pure function so the `--cap` rules that protect
 * the $1 spend cap can be unit-tested — the previous private `parseArgs`
 * inside the script could not be, since the script ran `main()` on load.
 *
 * No database, storage or env import, direct or transitive: same rule as
 * `still-prompt.ts` and `set-layout-prompt.ts`.
 */

export interface LiveSetArgs {
  image: string
  name: string
  look: string
  layout?: string
  out?: string
  shot?: string
  cap: number
}

/**
 * The exact wording the controller's ruling requires for an over-cap `--cap`:
 * a cap above $1 is a spending decision only the owner makes, never a flag a
 * run can quietly hand itself.
 */
const CAP_ABOVE_ONE_MESSAGE = "A cap above $1 needs the owner's approval first."

/** `--flag value` and `--flag=value` both split into a bare key and its value. */
function splitToken(token: string): { key: string; inlineValue: string | undefined } {
  const body = token.slice(2)
  const at = body.indexOf('=')
  return at === -1
    ? { key: body, inlineValue: undefined }
    : { key: body.slice(0, at), inlineValue: body.slice(at + 1) }
}

function readRawFlags(argv: readonly string[]): Record<string, string> {
  const raw: Record<string, string> = {}
  for (let at = 0; at < argv.length; at += 1) {
    const token = argv[at]
    if (!token?.startsWith('--')) continue
    const { key, inlineValue } = splitToken(token)
    if (inlineValue !== undefined) {
      raw[key] = inlineValue
      continue
    }
    const value = argv[at + 1]
    raw[key] = value !== undefined && !value.startsWith('--') ? value : ''
    if (raw[key] !== '') at += 1
  }
  return raw
}

/**
 * The cap rules (controller ruling, fix round 1): only a finite number
 * greater than 0 and at most 1 is accepted. `Number('1,00')` and
 * `Number('Infinity')` both defeated the old `next > capUsd + 1e-9` guard —
 * a `NaN` comparison is always false, and `Infinity` accepts everything — so
 * both are refused here, before the harness reads a single byte.
 */
function parseCap(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 1
  const cap = Number(raw)
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(`--cap "${raw}" is not a valid dollar amount; give a number greater than 0.`)
  }
  if (cap > 1) throw new Error(CAP_ABOVE_ONE_MESSAGE)
  return cap
}

export function parseLiveSetArgs(argv: readonly string[]): LiveSetArgs {
  const raw = readRawFlags(argv)
  if (!raw.image) throw new Error('--image is required (a jpeg, png or webp file).')
  if (!raw.name) throw new Error('--name is required (the set name).')

  return {
    image: raw.image,
    name: raw.name,
    look: raw.look ?? '',
    layout: raw.layout,
    out: raw.out,
    shot: raw.shot,
    cap: parseCap(raw.cap),
  }
}
