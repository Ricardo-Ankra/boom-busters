import path from 'node:path'

/**
 * The back-test CLI's arguments. Pure, so every refusal is tested without a
 * process: the paid baseline call in particular must be impossible to reach
 * by a typo, so it needs `--live` as well as `--baseline`, a provider and a
 * model, and unknown flags are errors rather than ignored.
 */

export const COMMANDS = ['hitlist', 'subjects', 'run'] as const
export type Command = (typeof COMMANDS)[number]

export const BASELINE_PROVIDERS = ['anthropic', 'openai', 'google'] as const
export type BaselineProvider = (typeof BASELINE_PROVIDERS)[number]

export interface CliArgs {
  command: Command
  /** Without it every source is a mock and nothing touches the network. */
  live: boolean
  /** The one paid call; null unless asked for. */
  baseline: { provider: BaselineProvider; model: string } | null
  dailyUnits: number
  spentToday: number
  lopucki: string | null
}

export const DEFAULT_DAILY_UNITS = 10000

const BOOLEAN_FLAGS = new Set(['--live', '--baseline'])
const VALUE_FLAGS = new Set([
  '--baseline-provider',
  '--baseline-model',
  '--daily-units',
  '--spent-today',
  '--lopucki',
])

export const USAGE =
  'Usage: backtest <hitlist|subjects|run> [--live] [--lopucki <path>] ' +
  '[--daily-units <n>] [--spent-today <n>] ' +
  '[--baseline --baseline-provider <anthropic|openai|google> --baseline-model <id>]'

function wholeNumber(flag: string, text: string): number {
  if (!/^\d+$/.test(text)) throw new Error(`${flag} needs a whole number, got "${text}"`)
  return Number(text)
}

/**
 * The raw HTTP cache: `.cache/case-finder/` in the repo (decision 10), or
 * CASE_FINDER_CACHE_DIR. The live run's cache runs to gigabytes, and a synced
 * folder such as OneDrive chokes on that many files, so the owner can move it.
 * The small snapshots the commands hand each other stay in the repo either way.
 */
export function rawCacheDir(env: Record<string, string | undefined>, root: string): string {
  const override = env.CASE_FINDER_CACHE_DIR?.trim()
  return override ? path.resolve(override) : path.join(root, '.cache', 'case-finder')
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  // pnpm passes a lone `--` through when the caller separates script arguments with one.
  const tokens = argv[0] === '--' ? argv.slice(1) : [...argv]
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const positional: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const eq = token.indexOf('=')
    const name = eq < 0 ? token : token.slice(0, eq)
    if (BOOLEAN_FLAGS.has(name) && eq < 0) {
      flags.add(name)
    } else if (VALUE_FLAGS.has(name)) {
      const value = eq < 0 ? tokens[++i] : token.slice(eq + 1)
      if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) {
        throw new Error(`${name} needs a value`)
      }
      values.set(name, value)
    } else {
      throw new Error(`Unknown flag ${token}. ${USAGE}`)
    }
  }

  const [command, ...extra] = positional
  if (command === undefined) throw new Error(`No command given. ${USAGE}`)
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`Unknown command "${command}". ${USAGE}`)
  }
  if (extra.length > 0) throw new Error(`Unexpected argument "${extra[0]}". ${USAGE}`)

  const live = flags.has('--live')
  const provider = values.get('--baseline-provider')
  const model = values.get('--baseline-model')
  let baseline: CliArgs['baseline'] = null
  if (flags.has('--baseline')) {
    if (command !== 'run') throw new Error('--baseline belongs to the run command')
    if (!live) throw new Error('--baseline is the paid call and is refused without --live')
    if (provider === undefined) throw new Error('--baseline needs --baseline-provider')
    if (!(BASELINE_PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error(`Unknown --baseline-provider "${provider}": anthropic, openai or google`)
    }
    if (model === undefined) throw new Error('--baseline needs --baseline-model')
    baseline = { provider: provider as BaselineProvider, model }
  } else if (provider !== undefined || model !== undefined) {
    throw new Error('--baseline-provider and --baseline-model need --baseline')
  }

  const units = values.get('--daily-units')
  const spent = values.get('--spent-today')
  return {
    command: command as Command,
    live,
    baseline,
    dailyUnits: units === undefined ? DEFAULT_DAILY_UNITS : wholeNumber('--daily-units', units),
    spentToday: spent === undefined ? 0 : wholeNumber('--spent-today', spent),
    lopucki: values.get('--lopucki') ?? null,
  }
}
