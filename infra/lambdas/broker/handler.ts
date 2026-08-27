import * as Sentry from '@sentry/aws-serverless'
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  deleteRender,
  getRenderProgress,
  renderMediaOnLambda,
  validateWebhookSignature,
} from '@remotion/lambda/client'
import { BROKER_SIGNATURE_HEADER, brokerSignature } from '@boom-busters/schemas'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { handleBrokerRequest } from './core'
import type { BrokerDeps, BrokerStore, RenderRecord } from './core'

/**
 * The AWS face of the broker: a Lambda Function URL in front of `core.ts`.
 * Everything here is adapters — S3-backed state, R2 presigning, Remotion
 * Lambda calls, async media-utils dispatch and the HMAC-signed callback.
 * No decisions live in this file; the core owns them all and is tested.
 *
 * State layout in the state bucket:
 *   broker/renders/<renderId>.json                  RenderRecord
 *   broker/by-remotion/<remotionRenderId>           renderId (text)
 *   broker/tombstones/<renderId>                    empty marker (8.1)
 *   renders/<renderId>/timeline.json                materialised audit copy
 */

function env(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`broker misconfigured: missing env ${name}`)
  }
  return value
}

const region = () => env('AWS_REGION')

const s3 = new S3Client({})
const lambda = new LambdaClient({})
const r2 = new S3Client({
  region: 'auto',
  endpoint: env('R2_ENDPOINT'),
  credentials: {
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  },
})

const PRESIGN_TTL_SECONDS = 24 * 3600

async function readBody(bucket: string, key: string): Promise<string | null> {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return (await result.Body?.transformToString()) ?? null
  } catch {
    return null
  }
}

function s3Store(stateBucket: string): BrokerStore {
  return {
    async getRender(renderId) {
      const body = await readBody(stateBucket, `broker/renders/${renderId}.json`)
      return body ? (JSON.parse(body) as RenderRecord) : null
    },
    async putRender(record) {
      await s3.send(
        new PutObjectCommand({
          Bucket: stateBucket,
          Key: `broker/renders/${record.renderId}.json`,
          Body: JSON.stringify(record),
          ContentType: 'application/json',
        }),
      )
      await s3.send(
        new PutObjectCommand({
          Bucket: stateBucket,
          Key: `broker/by-remotion/${record.remotionRenderId}`,
          Body: record.renderId,
        }),
      )
    },
    async listRunning() {
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: stateBucket, Prefix: 'broker/renders/' }),
      )
      const records: RenderRecord[] = []
      for (const object of listed.Contents ?? []) {
        if (!object.Key) continue
        const body = await readBody(stateBucket, object.Key)
        if (!body) continue
        const record = JSON.parse(body) as RenderRecord
        if (record.status === 'running') records.push(record)
      }
      return records
    },
    async findByRemotionId(remotionRenderId) {
      const renderId = await readBody(stateBucket, `broker/by-remotion/${remotionRenderId}`)
      if (!renderId) return null
      return this.getRender(renderId)
    },
    async isTombstoned(renderId) {
      return (await readBody(stateBucket, `broker/tombstones/${renderId}`)) !== null
    },
    async tombstone(renderId) {
      await s3.send(
        new PutObjectCommand({
          Bucket: stateBucket,
          Key: `broker/tombstones/${renderId}`,
          Body: new Date().toISOString(),
        }),
      )
    },
  }
}

function buildDeps(webhookUrl: string): BrokerDeps {
  const stateBucket = env('STATE_BUCKET')
  const r2Bucket = env('R2_BUCKET')
  const token = env('BROKER_TOKEN')
  const callbackUrl = env('CALLBACK_URL')

  return {
    token,
    renderCap: Number(process.env['RENDER_CAP'] ?? '2'),
    renderFanout: Number(process.env['RENDER_FANOUT'] ?? '150'),
    store: s3Store(stateBucket),
    remotion: {
      async render({ composition, timeline, renderId, scale, framesPerLambda }) {
        const { renderId: remotionRenderId, bucketName } = await renderMediaOnLambda({
          region: region() as never,
          functionName: env('REMOTION_FUNCTION_NAME'),
          serveUrl: env('REMOTION_SERVE_URL'),
          composition,
          inputProps: { timeline },
          codec: 'h264',
          scale,
          framesPerLambda,
          // Discovery calls s3:ListAllMyBuckets, which this role is not
          // allowed (found 2026-08-21: every POST /renders 502'd on it).
          forceBucketName: env('RENDER_BUCKET'),
          webhook: { url: webhookUrl, secret: token, customData: { renderId } },
        })
        return { remotionRenderId, bucketName }
      },
      async progress(remotionRenderId, bucketName) {
        const progress = await getRenderProgress({
          renderId: remotionRenderId,
          bucketName,
          functionName: env('REMOTION_FUNCTION_NAME'),
          region: region() as never,
        })
        return {
          done: progress.done,
          overallProgress: progress.overallProgress,
          outputFile: progress.outKey ?? null,
          costUsd: progress.costs?.accruedSoFar ?? null,
          fatalError: progress.fatalErrorEncountered
            ? (progress.errors[0]?.message ?? 'render failed')
            : null,
        }
      },
      async discard(remotionRenderId, bucketName) {
        await deleteRender({
          region: region() as never,
          bucketName,
          renderId: remotionRenderId,
        })
      },
    },
    storage: {
      async getJson(key) {
        const result = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }))
        const body = await result.Body?.transformToString()
        return body === undefined ? undefined : (JSON.parse(body) as unknown)
      },
      async putJson(key, value) {
        await s3.send(
          new PutObjectCommand({
            Bucket: stateBucket,
            Key: key,
            Body: JSON.stringify(value),
            ContentType: 'application/json',
          }),
        )
      },
      presign(key) {
        return getSignedUrl(r2, new GetObjectCommand({ Bucket: r2Bucket, Key: key }), {
          expiresIn: PRESIGN_TTL_SECONDS,
        })
      },
      presignRender(bucketName, key) {
        // The render's own bucket, not R2 — Remotion Lambda writes masters
        // where it was deployed, and the record carries the bucket name.
        return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName, Key: key }), {
          expiresIn: PRESIGN_TTL_SECONDS,
        })
      },
    },
    async dispatchMediaJob(job) {
      await lambda.send(
        new InvokeCommand({
          FunctionName: env('MEDIA_UTILS_FUNCTION_NAME'),
          InvocationType: 'Event',
          Payload: JSON.stringify(job),
        }),
      )
    },
    async postCallback(payload) {
      const body = JSON.stringify(payload)
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [BROKER_SIGNATURE_HEADER]: brokerSignature(body, token),
        },
        body,
      })
      if (!response.ok) {
        // Surface loudly in logs; the app's Inngest wait will time out and
        // the human sees a failed run rather than silence.
        console.error(
          JSON.stringify({ event: 'callback-failed', status: response.status, payload }),
        )
      }
    },
    verifyRemotionSignature(body, headers) {
      try {
        validateWebhookSignature({
          secret: token,
          body: JSON.parse(body),
          signatureHeader: headers['x-remotion-signature'] ?? '',
        })
        return true
      } catch {
        return false
      }
    },
    log(entry) {
      console.log(JSON.stringify(entry))
    },
  }
}

// Error tracking (spec section 12): inert without a DSN — init'd here at
// module scope so cold starts pay it once, wrapped below so unhandled
// throws are captured and flushed before the runtime freezes.
if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    release: process.env['SENTRY_RELEASE'] ?? 'dev',
    environment: 'lambda',
    tracesSampleRate: 0,
  })
}

async function handleEvent(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // The broker learns its own webhook URL from the request that reaches it —
  // no chicken-and-egg between the function URL and its configuration.
  const webhookUrl = `https://${event.requestContext.domainName}/webhooks/remotion`
  const deps = buildDeps(webhookUrl)

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value
  }
  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '')

  const response = await handleBrokerRequest(
    { method: event.requestContext.http.method, path: event.rawPath, headers, body },
    deps,
  )

  deps.log({
    event: 'response',
    method: event.requestContext.http.method,
    path: event.rawPath,
    status: response.status,
  })
  return {
    statusCode: response.status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(response.body),
  }
}

/** Wrapped only when Sentry is live — without a DSN this IS `handleEvent`. */
export const handler = process.env['SENTRY_DSN'] ? Sentry.wrapHandler(handleEvent) : handleEvent
