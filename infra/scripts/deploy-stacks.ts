import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Deploys the broker + media-utils stacks with the real configuration,
 * replacing the manual export dance in infra/README.md step 2. Reads the
 * R2 credentials and the owner email from the repo-root .env.local (the
 * same file the app loads), the broker token from BROKER_TOKEN or
 * ~/.boom-busters-broker-token, and the Remotion outputs from the
 * environment — those come from deploy-remotion.ts and change with every
 * Remotion version, so they must be stated per deploy, never defaulted.
 *
 *   AWS_PROFILE=... AWS_REGION=eu-west-1 \
 *   REMOTION_FUNCTION_NAME=... REMOTION_SERVE_URL=... RENDER_BUCKET=... \
 *   pnpm deploy:stacks
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    const [, key, raw] = match
    out[key!] = raw!.replace(/^"/, '').replace(/"$/, '')
  }
  return out
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const dotenv = parseEnvFile(path.join(repoRoot, '.env.local'))

const brokerToken =
  process.env['BROKER_TOKEN'] ??
  (() => {
    const tokenFile = path.join(os.homedir(), '.boom-busters-broker-token')
    return fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : undefined
  })()
if (!brokerToken) {
  fail(
    'BROKER_TOKEN is not set and ~/.boom-busters-broker-token does not exist (openssl rand -hex 32)',
  )
}

const accountId = dotenv['R2_ACCOUNT_ID']
if (!accountId) fail('R2_ACCOUNT_ID missing from .env.local')

const required = (name: string): string =>
  process.env[name] ?? fail(`${name} must be exported (printed by deploy-remotion.ts)`)

const config: Record<string, string> = {
  BROKER_TOKEN: brokerToken,
  CALLBACK_URL:
    process.env['CALLBACK_URL'] ?? 'https://boom-busters-web-rho.vercel.app/api/hooks/broker',
  // The same endpoint shape the app builds in apps/web/lib/storage.ts.
  R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
  R2_ACCESS_KEY_ID: dotenv['R2_ACCESS_KEY_ID'] ?? fail('R2_ACCESS_KEY_ID missing from .env.local'),
  R2_SECRET_ACCESS_KEY:
    dotenv['R2_SECRET_ACCESS_KEY'] ?? fail('R2_SECRET_ACCESS_KEY missing from .env.local'),
  R2_BUCKET: dotenv['R2_BUCKET'] ?? fail('R2_BUCKET missing from .env.local'),
  REMOTION_FUNCTION_NAME: required('REMOTION_FUNCTION_NAME'),
  REMOTION_SERVE_URL: required('REMOTION_SERVE_URL'),
  RENDER_BUCKET: required('RENDER_BUCKET'),
  ALERT_EMAIL: process.env['ALERT_EMAIL'] ?? dotenv['OWNER_EMAIL'] ?? '',
}

console.log(
  `deploying with CALLBACK_URL=${config['CALLBACK_URL']}, ALERT_EMAIL=${config['ALERT_EMAIL']}`,
)

const result = spawnSync(
  'pnpm',
  ['exec', 'cdk', 'deploy', '--all', '--require-approval', 'never'],
  {
    cwd: path.join(here, '..'),
    env: { ...process.env, ...config },
    stdio: 'inherit',
    shell: true,
  },
)
process.exit(result.status ?? 1)
