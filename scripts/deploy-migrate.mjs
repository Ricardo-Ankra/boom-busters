import { spawnSync } from 'node:child_process'

/**
 * Apply pending migrations during a production deploy.
 *
 * This exists because the alternative kept failing in the same way: a
 * milestone adds a column, the code ships, and every page that selects that
 * table 500s until a human remembers to run `pnpm db:migrate`. Twice in M3.
 * The schema and the code that reads it should arrive together.
 *
 * Guarded three ways, because a migration is the one build step that can
 * damage something:
 *
 *  1. **Production deploys only.** `VERCEL_ENV` is `preview` for branch
 *     deploys, and a preview of a half-finished branch must never apply its
 *     migrations to the database production is serving.
 *  2. **Never locally.** Outside Vercel this does nothing at all, so a
 *     `pnpm build` on a laptop cannot touch a remote database.
 *  3. **Fails the build.** Drizzle tracks what it has applied, so this is a
 *     no-op when there is nothing pending. If a migration genuinely fails,
 *     the deploy stops rather than shipping code against a schema that
 *     cannot support it.
 */

const env = process.env['VERCEL_ENV']

if (env !== 'production') {
  console.log(
    env
      ? `[deploy-migrate] VERCEL_ENV=${env}, so migrations are skipped. Only production deploys migrate.`
      : '[deploy-migrate] Not a Vercel build, so migrations are skipped.',
  )
  process.exit(0)
}

if (!process.env['DATABASE_URL']) {
  console.error('[deploy-migrate] VERCEL_ENV=production but DATABASE_URL is not set.')
  process.exit(1)
}

console.log('[deploy-migrate] Production deploy — applying pending migrations.')

const result = spawnSync('pnpm', ['--filter', '@boom-busters/db', 'migrate'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.status !== 0) {
  console.error('[deploy-migrate] Migrations failed. Stopping the build rather than shipping.')
  process.exit(result.status ?? 1)
}
