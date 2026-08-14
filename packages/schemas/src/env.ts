import { z } from 'zod'

/**
 * Environment validation (build spec section 4).
 *
 * Env holds infrastructure and bootstrap secrets ONLY. Behavioural
 * configuration lives in the `settings` table.
 *
 * The spec requires the app to refuse to start, listing every missing key.
 * That is enforced here for the variables the app genuinely cannot run
 * without. Infrastructure that arrives in later milestones (R2, the render
 * broker, Inngest, YouTube) is validated lazily through `requireEnv()`, which
 * throws a typed `ConfigError` naming the missing keys at the moment the
 * feature is first used rather than making the app unbootable before that
 * milestone exists.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EnvValidationError extends Error {
  readonly missing: string[]
  constructor(issues: string[], missing: string[]) {
    super(
      [
        'Environment validation failed. The app will not start.',
        ...issues.map((i) => `  - ${i}`),
        '',
        'See .env.example for the full list and copy it to .env.local.',
      ].join('\n'),
    )
    this.name = 'EnvValidationError'
    this.missing = missing
  }
}

/** Thrown when a deferred infrastructure group is used before it is configured. */
export class ConfigError extends Error {
  readonly group: string
  readonly missing: string[]
  constructor(group: string, missing: string[]) {
    super(
      `Missing configuration for "${group}": ${missing.join(', ')}. ` +
        `Add these to .env.local (see .env.example).`,
    )
    this.name = 'ConfigError'
    this.group = group
    this.missing = missing
  }
}

// ---------------------------------------------------------------------------
// Required at boot
// ---------------------------------------------------------------------------

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === '1' || v?.toLowerCase() === 'true')

const base32ByteKey = z
  .string()
  .min(1)
  .refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').length === 32
      } catch {
        return false
      }
    },
    { message: 'must be a base64-encoded 32-byte key (openssl rand -base64 32)' },
  )

export const BootEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z
      .string()
      .min(1)
      .startsWith('postgres', 'must be a postgres:// connection string'),

    AUTH_SECRET: z.string().min(32, 'must be at least 32 characters (npx auth secret)'),
    AUTH_URL: z.url(),
    /**
     * Optional only in mock mode, where the credentials provider stands in for
     * Google so Playwright can sign in (spec section 13). The refinement below
     * makes them mandatory everywhere else, so a real deploy still fails fast.
     */
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),

    OWNER_EMAIL: z.email(),

    SECRETS_ENCRYPTION_KEY: base32ByteKey,

    MOCK_PROVIDERS: booleanish,
  })
  .superRefine((env, ctx) => {
    if (env.MOCK_PROVIDERS && env.NODE_ENV !== 'production') return

    for (const key of ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'] as const) {
      if (!env[key] || env[key].trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'required unless MOCK_PROVIDERS=1 (Google is the only real sign-in)',
        })
      }
    }
  })

export type BootEnv = z.infer<typeof BootEnvSchema>

// ---------------------------------------------------------------------------
// Deferred groups — validated on first use
// ---------------------------------------------------------------------------

export const DEFERRED_GROUPS = {
  /** Cloudflare R2: input assets (narration, stills, stock, music). M4+. */
  r2: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
  /** Render broker + media-utils Lambda in the Reelscript AWS account. M6. */
  broker: ['AWS_BROKER_URL', 'AWS_BROKER_TOKEN'],
  /** Inngest durable orchestration. M2. */
  inngest: ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'],
  /** YouTube Data + Analytics OAuth client. M7. */
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
  /** Resend, for the optional email copy of a notification. M2. */
  email: ['RESEND_API_KEY', 'NOTIFY_FROM_EMAIL'],
} as const satisfies Record<string, readonly string[]>

export type DeferredGroup = keyof typeof DEFERRED_GROUPS

type GroupKeys<G extends DeferredGroup> = (typeof DEFERRED_GROUPS)[G][number]

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type EnvSource = Record<string, string | undefined>

/**
 * Pure parse of the boot-required variables. Returns every problem at once so
 * a first-time setup fixes all of them in a single pass.
 */
export function parseBootEnv(source: EnvSource): BootEnv {
  const result = BootEnvSchema.safeParse(source)
  if (result.success) return result.data

  const issues = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)'
    const present = source[key] !== undefined && source[key] !== ''
    return present ? `${key}: ${issue.message}` : `${key}: missing`
  })
  const missing = result.error.issues
    .map((issue) => String(issue.path[0] ?? ''))
    .filter((key) => key !== '' && (source[key] === undefined || source[key] === ''))

  throw new EnvValidationError(issues, [...new Set(missing)])
}

let cached: BootEnv | undefined

/** Memoised boot env. Throws `EnvValidationError` listing every missing key. */
export function getEnv(source: EnvSource = process.env): BootEnv {
  cached ??= parseBootEnv(source)
  return cached
}

/** Test-only: drop the memoised value so a new source can be parsed. */
export function resetEnvCache(): void {
  cached = undefined
}

/**
 * Fetch a deferred infrastructure group, throwing `ConfigError` if any member
 * is absent. Call this at the point of use, never at module load.
 */
export function requireEnv<G extends DeferredGroup>(
  group: G,
  source: EnvSource = process.env,
): Record<GroupKeys<G>, string> {
  const keys = DEFERRED_GROUPS[group] as readonly string[]
  const missing = keys.filter((key) => {
    const value = source[key]
    return value === undefined || value.trim() === ''
  })
  if (missing.length > 0) throw new ConfigError(group, missing)

  const out: Record<string, string> = {}
  for (const key of keys) out[key] = source[key] as string
  return out as Record<GroupKeys<G>, string>
}

/** Whether a deferred group is fully configured — for UI status chips. */
export function hasEnvGroup(group: DeferredGroup, source: EnvSource = process.env): boolean {
  try {
    requireEnv(group, source)
    return true
  } catch {
    return false
  }
}

/**
 * Mock-provider mode (build spec section 13). Hard-guarded: never active in a
 * production build, whatever the env says.
 */
export function isMockMode(source: EnvSource = process.env): boolean {
  if (source['NODE_ENV'] === 'production') return false
  return source['MOCK_PROVIDERS'] === '1' || source['MOCK_PROVIDERS']?.toLowerCase() === 'true'
}

/**
 * Optional provider API keys read from env. These are SEEDS ONLY: imported
 * into `provider_credentials` on first boot when no row exists, so local dev
 * works without touching Settings -> Connections (build spec section 4).
 */
export const PROVIDER_ENV_SEEDS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  'google-cloud-tts': 'GOOGLE_CLOUD_TTS_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  pexels: 'PEXELS_API_KEY',
  pixabay: 'PIXABAY_API_KEY',
  fal: 'FAL_API_KEY',
} as const satisfies Record<string, string>
