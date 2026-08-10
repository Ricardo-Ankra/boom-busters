import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')

/**
 * CLI scripts (migrate, seed, drizzle-kit) run outside Next.js, which loads
 * `.env.local` for us. Load it here in the same precedence order Next uses:
 * `.env.local` wins over `.env`, and anything already in the process
 * environment wins over both — that is how CI passes DATABASE_URL.
 */
export function loadEnvFiles(): void {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(repoRoot, file)
    if (existsSync(path)) config({ path, override: false, quiet: true })
  }
}

/**
 * Placeholder used by `drizzle-kit generate`, which diffs the schema against
 * the migration folder and never opens a connection. Commands that do connect
 * go through `requireDatabaseUrl()` instead.
 */
export const OFFLINE_PLACEHOLDER_URL = 'postgresql://placeholder/boom_busters'

export function databaseUrlOrPlaceholder(): string {
  loadEnvFiles()
  return process.env['DATABASE_URL'] ?? OFFLINE_PLACEHOLDER_URL
}

/**
 * Pick the connection migrations should run on.
 *
 * DDL belongs on a direct connection rather than through a transaction-mode
 * pooler, so DATABASE_URL_UNPOOLED wins when it is present — Neon's Vercel
 * integration sets both, differing only in hostname.
 *
 * But the two must be the same database. A `DATABASE_URL` overridden in the
 * shell while a stale `DATABASE_URL_UNPOOLED` lingers in `.env.local` would
 * otherwise migrate one database and run the app against another, surfacing
 * later as a baffling "relation does not exist". Fail loudly instead.
 */
export function resolveMigrationUrl(databaseUrl: string, unpooledUrl?: string): string {
  if (!unpooledUrl || unpooledUrl.trim() === '') return databaseUrl

  const identity = (url: string) => {
    const parsed = new URL(url)
    return `${parsed.username}@${parsed.pathname}`
  }

  if (identity(databaseUrl) !== identity(unpooledUrl)) {
    throw new Error(
      'DATABASE_URL and DATABASE_URL_UNPOOLED point at different databases.\n' +
        'They must be the same database (Neon gives you two hostnames for one).\n' +
        'Migrating one while the app reads the other is never what you want.',
    )
  }

  return unpooledUrl
}

export function requireDatabaseUrl(): string {
  loadEnvFiles()
  const url = process.env['DATABASE_URL']
  if (!url || url === OFFLINE_PLACEHOLDER_URL) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill in your ' +
        'Neon or Supabase connection string.',
    )
  }
  return resolveMigrationUrl(url, process.env['DATABASE_URL_UNPOOLED'])
}

export function encryptionKeyOrEmpty(): string {
  loadEnvFiles()
  return process.env['SECRETS_ENCRYPTION_KEY'] ?? ''
}
