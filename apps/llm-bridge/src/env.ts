import { z } from 'zod'

/**
 * The bridge's own configuration, checked before anything listens.
 *
 * Fails loudly on the two mistakes that would quietly change who pays:
 * `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in the environment (Claude
 * Code ranks both above the subscription token and would bill the API), and
 * a missing `CLAUDE_CODE_OAUTH_TOKEN`. The token's value is never printed.
 */

export class BridgeConfigError extends Error {
  constructor(problems: string[]) {
    super(
      [
        'The subscription bridge will not start:',
        ...problems.map((p) => `  - ${p}`),
        '',
        'See apps/llm-bridge/README.md and apps/llm-bridge/.env.example.',
      ].join('\n'),
    )
    this.name = 'BridgeConfigError'
  }
}

export interface BridgeEnv {
  token: string
  secret: string
  port: number
  concurrency: number
}

const NumberFromEnv = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max))

const Schema = z.object({
  LLM_BRIDGE_PORT: NumberFromEnv(8787, 1024, 65535),
  LLM_BRIDGE_CONCURRENCY: NumberFromEnv(3, 1, 16),
})

const set = (value: string | undefined): boolean => (value?.trim() ?? '') !== ''

export function readBridgeEnv(source: Record<string, string | undefined>): BridgeEnv {
  const problems: string[] = []

  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const) {
    if (set(source[key])) {
      problems.push(
        `${key} is set. Claude Code would use it ahead of your subscription and bill the API. ` +
          'Remove it from this environment (and apps/llm-bridge/.env).',
      )
    }
  }

  const token = source['CLAUDE_CODE_OAUTH_TOKEN']?.trim() ?? ''
  if (token === '') {
    problems.push(
      'CLAUDE_CODE_OAUTH_TOKEN is missing. Run `claude setup-token` and put the token in ' +
        'apps/llm-bridge/.env.',
    )
  }

  const secret = source['LLM_BRIDGE_SECRET']?.trim() ?? ''
  if (secret.length < 32) {
    problems.push(
      'LLM_BRIDGE_SECRET must be at least 32 characters, and the same value as on Vercel ' +
        '(openssl rand -base64 32).',
    )
  }

  const parsed = Schema.safeParse(source)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join('.')}: ${issue.message}`)
    }
  }

  if (problems.length > 0 || !parsed.success) throw new BridgeConfigError(problems)

  return {
    token,
    secret,
    port: parsed.data.LLM_BRIDGE_PORT,
    concurrency: parsed.data.LLM_BRIDGE_CONCURRENCY,
  }
}
