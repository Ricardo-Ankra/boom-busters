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
}

const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024

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
