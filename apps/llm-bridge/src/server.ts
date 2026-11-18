import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  BRIDGE_COMPLETE_PATH,
  BRIDGE_ERROR_STATUS,
  BRIDGE_HEALTH_PATH,
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_TIMESTAMP_HEADER,
  BridgeCompleteRequestSchema,
  verifyBridgeSignature,
  type BridgeCompleteRequest,
  type BridgeCompleteResponse,
  type BridgeErrorBody,
  type BridgeErrorKind,
  type BridgeJob,
} from '@boom-busters/providers/llm'

/**
 * The bridge's HTTP face (decision 469).
 *
 * Listens on 127.0.0.1 only; Tailscale Funnel is what puts it on the
 * internet, so every request is treated as hostile until its signature
 * checks out. The signature is verified over the raw body before any JSON is
 * parsed. Logs say which task ran, how long it took and how it ended, never
 * a prompt, an answer or a credential.
 */

/** A failure the bridge can name, carried back to the app as `{ error: { kind } }`. */
export class BridgeCallError extends Error {
  readonly kind: BridgeErrorKind
  readonly status: number | undefined

  constructor(kind: BridgeErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'BridgeCallError'
    this.kind = kind
    this.status = status
  }
}

export type CompleteFn = (
  request: BridgeCompleteRequest,
  signal: AbortSignal,
) => Promise<BridgeCompleteResponse>

export interface BridgeServerOptions {
  secret: string
  /** How many calls run at once; the rest wait their turn. */
  concurrency: number
  complete: CompleteFn
  now?: () => number
  log?: (line: string) => void
  /** Base64 images make bodies large; anything past this is refused unread. */
  maxBodyBytes?: number
  /** How long a job's finished answer waits to be collected (decision 472). */
  resultTtlMs?: number
  /** The longest one job may run before it is stopped, counted from its creation. */
  jobTimeoutMs?: number
  /** How long a job may go with no request holding it before it is stopped. */
  idleAbandonMs?: number
}

const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024
const DEFAULT_RESULT_TTL_MS = 30 * 60 * 1000
const DEFAULT_JOB_TIMEOUT_MS = 15 * 60 * 1000

/**
 * How long a job may go with no request holding it before it is stopped. An
 * app step that comes back to collect arrives within seconds, or after it
 * queued behind the designer's concurrency limit (a step's 240 s at most), so
 * this is longer than both; a run cancelled or given up never comes back.
 */
const DEFAULT_IDLE_ABANDON_MS = 5 * 60 * 1000

/** A job's state: `settled` once it has an answer or a failure; `done` resolves then. */
interface Job {
  settled:
    { ok: true; answer: BridgeCompleteResponse } | { ok: false; error: BridgeCallError } | undefined
  done: Promise<void>
  abort: AbortController
  /** Why the bridge stopped it, when it did. */
  stopped: 'timeout' | 'abandoned' | undefined
  /** Requests holding it now. */
  holders: number
  /** Runs while no request holds it and the answer is not in. */
  idle: ReturnType<typeof setTimeout> | undefined
}

/** First come, first served; `release` must be called exactly once per `acquire`. */
function semaphore(limit: number) {
  let active = 0
  const waiting: Array<() => void> = []
  return {
    async acquire(): Promise<() => void> {
      if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
      active += 1
      return () => {
        active -= 1
        waiting.shift()?.()
      }
    },
  }
}

class BodyTooLarge extends Error {}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > limit) throw new BodyTooLarge()
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  response.end(text)
}

function sendError(
  response: ServerResponse,
  kind: BridgeErrorKind,
  message: string,
  status?: number,
): void {
  const body: BridgeErrorBody = {
    error: { kind, message, ...(status === undefined ? {} : { status }) },
  }
  sendJson(response, BRIDGE_ERROR_STATUS[kind], body)
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export function createBridgeServer(options: BridgeServerOptions): Server {
  const now = options.now ?? Date.now
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`))
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const resultTtlMs = options.resultTtlMs ?? DEFAULT_RESULT_TTL_MS
  const jobTimeoutMs = options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS
  const idleAbandonMs = options.idleAbandonMs ?? DEFAULT_IDLE_ABANDON_MS
  const slots = semaphore(options.concurrency)

  function authorised(request: IncomingMessage, path: string, body: string): boolean {
    return (
      verifyBridgeSignature(
        options.secret,
        {
          method: request.method ?? 'GET',
          path,
          body,
          timestamp: header(request, BRIDGE_TIMESTAMP_HEADER),
          signature: header(request, BRIDGE_SIGNATURE_HEADER),
        },
        now(),
      ) === 'ok'
    )
  }

  /**
   * Jobs (decision 472): a call that runs to its end on the PC whatever
   * happens to the request that started it. The app's step holds a request
   * open only as long as Vercel lets it, so an answer that takes longer is
   * collected by the same key from a later step. A finished answer is kept
   * for `resultTtlMs`; a failure is handed over once and then forgotten, so a
   * Resume after a spent plan or a refused token runs the call again.
   */
  const jobs = new Map<string, Job>()

  function startJob(key: string, call: BridgeCompleteRequest): Job {
    const job: Job = {
      settled: undefined,
      done: Promise.resolve(),
      abort: new AbortController(),
      stopped: undefined,
      holders: 0,
      idle: undefined,
    }
    const { signal } = job.abort
    // Counted from creation, so a job queued for a slot is bounded too.
    const cap = setTimeout(() => stop(job, 'timeout'), jobTimeoutMs)
    cap.unref?.()
    job.done = (async () => {
      const release = await slots.acquire()
      const startedAt = now()
      try {
        // Given up while it queued: never start a Claude process for it.
        if (signal.aborted) throw new Error('stopped before it started')
        const answer = await options.complete(call, signal)
        job.settled = { ok: true, answer }
        log(
          `[bridge] job ${call.request.task} on ${call.model}: ok in ${now() - startedAt} ms ` +
            `(${answer.usage.inputTokens} in, ${answer.usage.outputTokens} out)`,
        )
      } catch (error) {
        const failure =
          error instanceof BridgeCallError && !signal.aborted
            ? error
            : new BridgeCallError(
                'upstream',
                job.stopped === 'timeout'
                  ? `the job ran past ${jobTimeoutMs} ms and was stopped`
                  : job.stopped === 'abandoned'
                    ? `no request asked for the job for ${idleAbandonMs} ms, so it was stopped`
                    : error instanceof Error
                      ? error.message
                      : String(error),
              )
        job.settled = { ok: false, error: failure }
        log(`[bridge] job ${call.request.task}: ${failure.kind} (${failure.message})`)
      } finally {
        clearTimeout(cap)
        if (job.idle) clearTimeout(job.idle)
        release()
        // An abandoned job is nobody's: forget it now. Any other result waits
        // to be collected.
        if (job.stopped === 'abandoned') {
          if (jobs.get(key) === job) jobs.delete(key)
        } else {
          const expiry = setTimeout(() => {
            if (jobs.get(key) === job) jobs.delete(key)
          }, resultTtlMs)
          expiry.unref?.()
        }
      }
    })()
    return job
  }

  function stop(job: Job, why: 'timeout' | 'abandoned'): void {
    if (job.settled || job.stopped) return
    job.stopped = why
    job.abort.abort()
  }

  /**
   * A request stopped holding the job. When none is left and the answer is
   * not in, the app has `idleAbandonMs` to come back for it (its next step
   * may queue behind the concurrency limit for a while); a run that was
   * cancelled or gave up never does, and its job then stops, freeing its slot.
   */
  function letGo(job: Job): void {
    job.holders -= 1
    if (job.holders > 0 || job.settled) return
    if (job.idle) clearTimeout(job.idle)
    job.idle = setTimeout(() => stop(job, 'abandoned'), idleAbandonMs)
    job.idle.unref?.()
  }

  async function answerJob(
    call: BridgeCompleteRequest,
    spec: BridgeJob,
    response: ServerResponse,
  ): Promise<void> {
    let job = jobs.get(spec.key)
    if (!job) {
      job = startJob(spec.key, call)
      jobs.set(spec.key, job)
    }
    job.holders += 1
    if (job.idle) {
      clearTimeout(job.idle)
      job.idle = undefined
    }
    try {
      if (!job.settled) {
        let timer: ReturnType<typeof setTimeout> | undefined
        let onClose: (() => void) | undefined
        await Promise.race([
          job.done,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, spec.holdMs)
            // The app stopped listening: stop holding for it.
            onClose = resolve
            response.on('close', onClose)
          }),
        ])
        clearTimeout(timer)
        if (onClose) response.off('close', onClose)
      }
    } finally {
      letGo(job)
    }
    // The app stopped listening; the job carries on for the next request.
    if (response.destroyed || response.writableEnded) return
    const settled = job.settled
    if (!settled) {
      sendJson(response, 202, { pending: true })
      return
    }
    if (settled.ok) {
      sendJson(response, 200, settled.answer)
      return
    }
    // A failure is handed over once: the next request with this key starts afresh.
    if (jobs.get(spec.key) === job) jobs.delete(spec.key)
    sendError(response, settled.error.kind, settled.error.message, settled.error.status)
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://bridge').pathname

    if (request.method === 'GET' && path === BRIDGE_HEALTH_PATH) {
      if (!authorised(request, path, '')) {
        sendError(response, 'unauthorised', 'signature missing, stale or wrong')
        return
      }
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method !== 'POST' || path !== BRIDGE_COMPLETE_PATH) {
      sendJson(response, 404, { error: { kind: 'invalid', message: 'not found' } })
      return
    }

    let body: string
    try {
      body = await readBody(request, maxBodyBytes)
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        sendError(response, 'invalid', `request body is over ${maxBodyBytes} bytes`)
        return
      }
      throw error
    }

    if (!authorised(request, path, body)) {
      sendError(response, 'unauthorised', 'signature missing, stale or wrong')
      return
    }

    let parsed: BridgeCompleteRequest
    try {
      const result = BridgeCompleteRequestSchema.safeParse(JSON.parse(body))
      if (!result.success) {
        sendError(response, 'invalid', result.error.issues[0]?.message ?? 'invalid request')
        return
      }
      parsed = result.data
    } catch {
      sendError(response, 'invalid', 'request body is not JSON')
      return
    }

    if (parsed.job) {
      await answerJob(parsed, parsed.job, response)
      return
    }

    // The app gave up (its step was cancelled or timed out): stop the
    // Claude Code process instead of finishing an answer nobody will read.
    const abort = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) abort.abort()
    })

    const release = await slots.acquire()
    const startedAt = now()
    try {
      if (abort.signal.aborted) return
      const answer = await options.complete(parsed, abort.signal)
      sendJson(response, 200, answer)
      log(
        `[bridge] ${parsed.request.task} on ${parsed.model}: ok in ${now() - startedAt} ms ` +
          `(${answer.usage.inputTokens} in, ${answer.usage.outputTokens} out)`,
      )
    } catch (error) {
      if (abort.signal.aborted) {
        log(`[bridge] ${parsed.request.task}: abandoned by the app after ${now() - startedAt} ms`)
        return
      }
      if (error instanceof BridgeCallError) {
        log(`[bridge] ${parsed.request.task}: ${error.kind} (${error.message})`)
        sendError(response, error.kind, error.message, error.status)
        return
      }
      log(
        `[bridge] ${parsed.request.task}: failed (${error instanceof Error ? error.message : String(error)})`,
      )
      sendError(response, 'upstream', error instanceof Error ? error.message : String(error))
    } finally {
      release()
    }
  }

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      log(`[bridge] unhandled: ${error instanceof Error ? error.message : String(error)}`)
      if (!response.headersSent) sendError(response, 'upstream', 'the bridge hit an internal error')
      else response.end()
    })
  })
}
