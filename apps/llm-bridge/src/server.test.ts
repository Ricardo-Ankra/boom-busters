import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import {
  signBridgeRequest,
  type BridgeCompleteRequest,
  type BridgeCompleteResponse,
} from '@boom-busters/providers/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeCallError, createBridgeServer, type CompleteFn } from './server'

const SECRET = 'a-secret-that-is-long-enough-for-hmac-0123'

const body: BridgeCompleteRequest = {
  model: 'claude-opus-5',
  request: {
    task: 'research',
    system: 'You research collapses.',
    messages: [{ role: 'user', content: 'Enron' }],
    maxTokens: 1000,
  },
}

const answer: BridgeCompleteResponse = {
  text: 'an answer',
  usage: { inputTokens: 10, outputTokens: 5 },
  model: 'claude-opus-5',
  truncated: false,
}

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

async function start(complete: CompleteFn, concurrency = 3): Promise<string> {
  server = createBridgeServer({ secret: SECRET, concurrency, complete, log: () => {} })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function post(base: string, payload: unknown = body, secret = SECRET) {
  const text = JSON.stringify(payload)
  return fetch(`${base}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...signBridgeRequest(secret, { method: 'POST', path: '/complete', body: text }),
    },
    body: text,
  })
}

describe('the bridge server (decision 469)', () => {
  it('answers a signed health check, and refuses an unsigned one', async () => {
    const base = await start(vi.fn())
    const signed = await fetch(`${base}/health`, {
      headers: signBridgeRequest(SECRET, { method: 'GET', path: '/health', body: '' }),
    })
    expect(signed.status).toBe(200)

    const unsigned = await fetch(`${base}/health`)
    expect(unsigned.status).toBe(401)
    expect(await unsigned.json()).toMatchObject({ error: { kind: 'unauthorised' } })
  })

  it('runs a signed completion and returns the answer', async () => {
    const complete = vi.fn<CompleteFn>(async () => answer)
    const base = await start(complete)

    const response = await post(base)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(answer)
    expect(complete).toHaveBeenCalledWith(body, expect.any(AbortSignal))
  })

  it('never runs a completion signed with the wrong secret', async () => {
    const complete = vi.fn<CompleteFn>(async () => answer)
    const base = await start(complete)

    const response = await post(base, body, `${SECRET}-wrong`)

    expect(response.status).toBe(401)
    expect(complete).not.toHaveBeenCalled()
  })

  it('refuses a signed body that is not a valid request', async () => {
    const complete = vi.fn<CompleteFn>(async () => answer)
    const base = await start(complete)

    const response = await post(base, { model: 'x' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { kind: 'invalid' } })
    expect(complete).not.toHaveBeenCalled()
  })

  it('passes a named failure back with its kind', async () => {
    const base = await start(async () => {
      throw new BridgeCallError('plan-limit', 'five_hour limit is reached', 429)
    })

    const response = await post(base)

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({
      error: { kind: 'plan-limit', message: 'five_hour limit is reached', status: 429 },
    })
  })

  it('reports an unexpected failure as upstream, so the app retries', async () => {
    const base = await start(async () => {
      throw new Error('spawn failed')
    })

    const response = await post(base)

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { kind: 'upstream' } })
  })

  it('runs no more calls at once than it is allowed, queueing the rest', async () => {
    let running = 0
    let peak = 0
    const base = await start(async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 20))
      running -= 1
      return answer
    }, 2)

    const responses = await Promise.all([post(base), post(base), post(base), post(base)])

    expect(responses.every((r) => r.status === 200)).toBe(true)
    expect(peak).toBe(2)
  })

  it('answers 404 for anything else', async () => {
    const base = await start(vi.fn())
    expect((await fetch(`${base}/`)).status).toBe(404)
  })
})
