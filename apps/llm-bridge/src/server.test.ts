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

describe('jobs (decision 472)', () => {
  /** A completion the test finishes by hand, and the signal it was given. */
  function held() {
    let finish!: (value: BridgeCompleteResponse | Error) => void
    let signal: AbortSignal | undefined
    const complete = vi.fn<CompleteFn>((_call, given) => {
      signal = given
      return new Promise((resolve, reject) => {
        finish = (value) => (value instanceof Error ? reject(value) : resolve(value))
      })
    })
    return {
      complete,
      finish: (value: BridgeCompleteResponse | Error) => finish(value),
      signal: () => signal,
    }
  }
  const job = (key: string, holdMs: number) => ({ ...body, job: { key, holdMs } })

  it('answers within the hold as a plain call would', async () => {
    const complete = vi.fn<CompleteFn>(async () => answer)
    const base = await start(complete)
    const response = await post(base, job('run-1:answer', 5000))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(answer)
  })

  it('says still running after the hold, keeps running, and hands the answer to the same key', async () => {
    const work = held()
    const base = await start(work.complete)

    const first = await post(base, job('run-1:answer', 50))
    expect(first.status).toBe(202)
    expect(await first.json()).toEqual({ pending: true })
    // The request ended; the job did not.
    expect(work.signal()?.aborted).toBe(false)

    work.finish(answer)
    const second = await post(base, job('run-1:answer', 5000))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(answer)
    // Collected, never asked twice.
    expect(work.complete).toHaveBeenCalledTimes(1)

    // A finished answer stays collectable, for a step Inngest retried.
    const again = await post(base, job('run-1:answer', 0))
    expect(again.status).toBe(200)
    expect(work.complete).toHaveBeenCalledTimes(1)
  })

  it('answers a request still holding the moment the job finishes', async () => {
    const work = held()
    const base = await start(work.complete)
    const pending = post(base, job('run-2:answer', 10_000))
    await vi.waitFor(() => expect(work.complete).toHaveBeenCalled())
    work.finish(answer)
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(answer)
  })

  it('runs different keys as different jobs', async () => {
    const complete = vi.fn<CompleteFn>(async () => answer)
    const base = await start(complete)
    await post(base, job('run-3:answer', 5000))
    await post(base, job('run-3:retry: refused', 5000))
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('hands a failure over once, then runs the call again for the same key', async () => {
    const complete = vi
      .fn<CompleteFn>()
      .mockRejectedValueOnce(new BridgeCallError('plan-limit', 'limit reached'))
      .mockResolvedValueOnce(answer)
    const base = await start(complete)

    const failed = await post(base, job('run-4:answer', 5000))
    expect(failed.status).toBe(429)
    expect(await failed.json()).toMatchObject({ error: { kind: 'plan-limit' } })

    const resumed = await post(base, job('run-4:answer', 5000))
    expect(resumed.status).toBe(200)
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('forgets a collected answer once its time to be collected is up', async () => {
    const complete = vi.fn<CompleteFn>(async () => answer)
    server = createBridgeServer({
      secret: SECRET,
      concurrency: 3,
      complete,
      log: () => {},
      resultTtlMs: 20,
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    await post(base, job('run-5:answer', 5000))
    await new Promise((resolve) => setTimeout(resolve, 60))
    await post(base, job('run-5:answer', 5000))
    expect(complete).toHaveBeenCalledTimes(2)
  })

  /** A server with a short idle limit, and completions that end when their signal aborts. */
  async function startIdle(idleAbandonMs: number, concurrency = 3) {
    const signals: AbortSignal[] = []
    const complete = vi.fn<CompleteFn>(
      (_call, signal) =>
        new Promise((_resolve, reject) => {
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    server = createBridgeServer({
      secret: SECRET,
      concurrency,
      complete,
      log: () => {},
      idleAbandonMs,
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    return {
      base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      complete,
      signals,
    }
  }

  it('stops a job nobody comes back for, freeing its slot', async () => {
    const { base, signals } = await startIdle(40)
    expect((await post(base, job('cancelled-run:answer', 10))).status).toBe(202)
    await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true))
  })

  it('keeps a job running while its run keeps coming back', async () => {
    const { base, signals } = await startIdle(80)
    expect((await post(base, job('live-run:answer', 10))).status).toBe(202)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect((await post(base, job('live-run:answer', 10))).status).toBe(202)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect((await post(base, job('live-run:answer', 10))).status).toBe(202)
    expect(signals[0]?.aborted).toBe(false)
  })

  it('never starts a queued job that was abandoned before its slot came', async () => {
    const { base, complete } = await startIdle(40, 1)
    // The one slot is taken by a job that stays wanted.
    const busy = post(base, job('busy:answer', 2_000))
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    // A second job queues, is asked about once, then abandoned.
    expect((await post(base, job('queued:answer', 10))).status).toBe(202)
    await new Promise((resolve) => setTimeout(resolve, 100))
    // The first job stops (abandoned once its own hold ends), the slot frees,
    // and the queued one is found stopped and never run.
    await busy
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('stops a job that runs past its limit and says so', async () => {
    const work = held()
    server = createBridgeServer({
      secret: SECRET,
      concurrency: 3,
      complete: (call, signal) => {
        signal.addEventListener('abort', () => work.finish(new Error('aborted')))
        return work.complete(call, signal)
      },
      log: () => {},
      jobTimeoutMs: 30,
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const response = await post(base, job('run-6:answer', 5000))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      error: { kind: 'upstream', message: expect.stringContaining('ran past 30 ms') },
    })
  })
})
