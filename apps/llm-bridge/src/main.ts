import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { completeOnSubscription } from './agent'
import { BridgeConfigError, readBridgeEnv } from './env'
import { createBridgeServer } from './server'

/**
 * Start the subscription bridge (decision 469): `pnpm --filter
 * @boom-busters/llm-bridge start`, on the owner's PC, behind Tailscale Funnel.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

let config
try {
  config = readBridgeEnv(process.env)
} catch (error) {
  if (error instanceof BridgeConfigError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}

// Claude Code keeps its own config here, apart from the owner's ~/.claude, so
// nothing from day-to-day Claude Code use (CLAUDE.md, skills, hooks, MCP
// servers) can reach a call the bridge makes.
const configDir = path.join(homedir(), '.boom-busters-llm-bridge', 'claude')
mkdirSync(configDir, { recursive: true })
const workDir = mkdtempSync(path.join(tmpdir(), 'boom-busters-llm-bridge-'))

const server = createBridgeServer({
  secret: config.secret,
  concurrency: config.concurrency,
  complete: (request, signal) =>
    completeOnSubscription(
      { query, token: config.token, workDir, configDir, baseEnv: process.env },
      request,
      signal,
    ),
})

// Loopback only. Tailscale Funnel is the one door in from the internet.
server.listen(config.port, '127.0.0.1', () => {
  process.stdout.write(
    `[bridge] listening on http://127.0.0.1:${config.port}, ${config.concurrency} calls at a time. ` +
      `Expose it with: tailscale funnel --bg ${config.port}\n`,
  )
})

const stop = () => server.close(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
