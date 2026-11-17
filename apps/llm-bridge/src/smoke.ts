import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BRIDGE_COMPLETE_PATH,
  BRIDGE_HEALTH_PATH,
  signBridgeRequest,
  type BridgeCompleteRequest,
} from '@boom-busters/providers/llm'

/**
 * One tiny signed call through a running bridge, exactly as the deployed app
 * makes it (decision 469). Uses a few tokens of the Claude plan, nothing else.
 *
 *   pnpm --filter @boom-busters/llm-bridge smoke
 *   pnpm --filter @boom-busters/llm-bridge smoke -- --url https://your-pc.your-tailnet.ts.net
 *
 * Without --url it calls the bridge on this machine; with the Funnel address
 * it goes out and back in through Tailscale, the same road Vercel takes.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const secret = process.env['LLM_BRIDGE_SECRET']?.trim() ?? ''
if (secret === '') {
  process.stderr.write('Set LLM_BRIDGE_SECRET in apps/llm-bridge/.env first.\n')
  process.exit(1)
}
const base = (
  flag('--url') ?? `http://127.0.0.1:${process.env['LLM_BRIDGE_PORT'] || '8787'}`
).replace(/\/+$/, '')
const model = flag('--model') ?? 'claude-haiku-4-5-20251001'

const health = await fetch(`${base}${BRIDGE_HEALTH_PATH}`, {
  headers: signBridgeRequest(secret, { method: 'GET', path: BRIDGE_HEALTH_PATH, body: '' }),
}).catch((error: unknown) => error)
if (health instanceof Error || !(health as Response).ok) {
  process.stderr.write(
    `The bridge at ${base} did not answer its health check ` +
      `(${health instanceof Error ? health.message : (health as Response).status}). Is it running?\n`,
  )
  process.exit(1)
}

const payload: BridgeCompleteRequest = {
  model,
  request: {
    task: 'digest',
    system: 'You answer in one short sentence.',
    messages: [{ role: 'user', content: 'Say that the subscription bridge works.' }],
    maxTokens: 200,
  },
}
const body = JSON.stringify(payload)
const startedAt = Date.now()
const response = await fetch(`${base}${BRIDGE_COMPLETE_PATH}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...signBridgeRequest(secret, { method: 'POST', path: BRIDGE_COMPLETE_PATH, body }),
  },
  body,
})
const text = await response.text()
process.stdout.write(`${response.status} in ${Date.now() - startedAt} ms\n${text}\n`)
process.exit(response.ok ? 0 : 1)
