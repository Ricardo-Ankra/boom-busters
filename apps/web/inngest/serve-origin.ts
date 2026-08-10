/**
 * The origin the app tells Inngest to call back on.
 *
 * Left to itself, the SDK infers its URL from the incoming request, which on
 * Vercel is the **per-deployment** hostname
 * (`boom-busters-xiheracsn-<team>.vercel.app`). Those sit behind Deployment
 * Protection and answer Inngest's sync with a 302 to an SSO page, so every
 * sync lands in "Unattached Syncs" with "we could not reach your URL" — while
 * the stable production alias is perfectly reachable.
 *
 * Vercel injects `VERCEL_PROJECT_PRODUCTION_URL` (the project's production
 * domain, no protocol) into every deployment, so the correct origin is
 * derivable without anyone configuring anything. `INNGEST_SERVE_ORIGIN` still
 * overrides, for a custom domain or a one-off.
 *
 * Only production advertises it. A preview deployment claiming the production
 * domain would register its own branch's functions against production, which
 * is a far worse failure than an unreachable preview.
 */
export function resolveServeOrigin(
  // Not `NodeJS.ProcessEnv`: Next augments it so `NODE_ENV` is required, which
  // would make every test fixture carry a field this function never reads.
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = env['INNGEST_SERVE_ORIGIN']?.trim()
  if (explicit) return explicit

  if (env['VERCEL_ENV'] !== 'production') return undefined

  const productionUrl = env['VERCEL_PROJECT_PRODUCTION_URL']?.trim()
  if (!productionUrl) return undefined

  return productionUrl.startsWith('http') ? productionUrl : `https://${productionUrl}`
}
