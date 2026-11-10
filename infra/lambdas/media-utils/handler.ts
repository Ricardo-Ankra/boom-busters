import { spawn } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import * as Sentry from '@sentry/aws-serverless'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { BROKER_SIGNATURE_HEADER, brokerSignature, MediaJobSchema } from '@boom-busters/schemas'
import type { LoudnormMeasurement, MediaJob, MediaJobCallback } from '@boom-busters/schemas'
import type { Context as LambdaContext } from 'aws-lambda'
import type { Readable } from 'node:stream'
import {
  buildQcReport,
  concatListText,
  joinArgs,
  loudnormApplyArgs,
  loudnormApplyVideoArgs,
  loudnormMeasureArgs,
  parseBlackFrames,
  parseDurationMs,
  redactUrls,
  parseFreezes,
  parseIntegratedLufs,
  parseLoudnormJson,
  parseSilences,
  qcArgs,
  toWhisperWavArgs,
  whisperArgs,
  whisperJsonToCaptions,
  youtubeInitBody,
} from './commands'
import { uploadStreamMultipart } from './multipart'
import { putInChunks, querySessionOffset } from './youtube-upload'

/**
 * The media-utils Lambda (build spec section 8): invoked ASYNCHRONOUSLY by
 * the broker with one MediaJob, runs FFmpeg (layer at /opt/bin) or
 * Whisper.cpp (binary + model pulled from S3 to /tmp on cold start), then
 * POSTs the HMAC-signed completion callback. Every path — success or
 * failure — ends in a callback: a job that dies silently strands an Inngest
 * run until its timeout.
 *
 * Storage convention: keys under the app prefix (`boom-busters/…`) live in
 * R2; anything else (Remotion's `renders/…` artefacts) lives in the render
 * bucket on S3. The two stores never share a prefix, so routing by key is
 * deterministic.
 */

function env(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`media-utils misconfigured: missing env ${name}`)
  }
  return value
}

const s3 = new S3Client({})
const r2 = new S3Client({
  region: 'auto',
  endpoint: env('R2_ENDPOINT'),
  credentials: {
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  },
})

const FFMPEG = process.env['FFMPEG_PATH'] ?? '/opt/bin/ffmpeg'
const APP_PREFIX = 'boom-busters/'

function clientFor(key: string): { client: S3Client; bucket: string } {
  return key.startsWith(APP_PREFIX)
    ? { client: r2, bucket: env('R2_BUCKET') }
    : { client: s3, bucket: env('RENDER_BUCKET') }
}

async function download(key: string, toPath: string): Promise<void> {
  const { client, bucket } = clientFor(key)
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!result.Body) throw new Error(`empty object ${key}`)
  await pipeline(result.Body as Readable, createWriteStream(toPath))
}

async function upload(key: string, fromPath: string, contentType: string): Promise<void> {
  const { client, bucket } = clientFor(key)
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: readFileSync(fromPath),
      ContentType: contentType,
    }),
  )
}

function run(command: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args)
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

/** FFmpeg's analysis passes exit 0; a non-zero code is a broken input. */
async function ffmpeg(args: string[]): Promise<string> {
  const { code, stderr } = await run(FFMPEG, args)
  if (code !== 0) {
    throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)
  }
  return stderr
}

async function postCallback(url: string, payload: MediaJobCallback): Promise<void> {
  const body = JSON.stringify(payload)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [BROKER_SIGNATURE_HEADER]: brokerSignature(body, env('BROKER_TOKEN')),
    },
    body,
  })
  if (!response.ok) {
    console.error(JSON.stringify({ event: 'callback-failed', status: response.status }))
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

async function runQc(job: Extract<MediaJob, { kind: 'qc' }>) {
  const input = '/tmp/qc-input'
  await download(job.s3Key, input)
  const stderr = await ffmpeg(qcArgs(input))
  let loudnorm: LoudnormMeasurement | undefined
  if (job.withLoudnorm) {
    // A part's own measurement, taken on the download the QC pass just used.
    const measured = parseLoudnormJson(
      await ffmpeg(loudnormMeasureArgs(input, job.targetLufs, { audioOnly: true })),
    )
    if (!measured) throw new Error('loudnorm measurement produced no result')
    loudnorm = measured
  }
  // Only a part's report carries its length; a single render's stays as it was.
  const durationMs = job.withLoudnorm ? (parseDurationMs(stderr) ?? undefined) : undefined
  return buildQcReport({
    silences: parseSilences(stderr),
    blackFrames: parseBlackFrames(stderr),
    freezes: parseFreezes(stderr),
    integratedLufs: parseIntegratedLufs(stderr),
    targetLufs: job.targetLufs,
    offsetMs: job.offsetMs,
    loudnorm,
    durationMs,
  })
}

/**
 * Join a long render's parts into one fragmented MP4, streaming ffmpeg's
 * stdout into an S3 multipart upload so no disk ever holds the whole film.
 * The concat demuxer opens the parts over https, so each is presigned. A
 * failed ffmpeg must leave no object: completion is held back until ffmpeg
 * has exited cleanly, and the upload is aborted on any failure.
 */
/** How long before the invocation's own end the join gives up and cleans up. */
const JOIN_WATCHDOG_MARGIN_MS = 90_000

async function runJoin(job: Extract<MediaJob, { kind: 'join' }>, context?: LambdaContext) {
  const started = Date.now()
  const bucket = env('RENDER_BUCKET')
  const urls = await Promise.all(
    job.partS3Keys.map((key) =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: 24 * 3600,
      }),
    ),
  )
  const listPath = '/tmp/join-list.txt'
  writeFileSync(listPath, concatListText(urls))

  const child = spawn(FFMPEG, joinArgs(listPath, job.targetLufs, job.measured))
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const exit = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })
  // A join that outruns the invocation would be killed with its multipart
  // upload open and no callback posted. Killing ffmpeg a little early lets the
  // normal exit handling abort the upload and report the failure.
  let timedOut = false
  const watchdog =
    context === undefined
      ? undefined
      : setTimeout(
          () => {
            timedOut = true
            child.kill('SIGKILL')
          },
          Math.max(0, context.getRemainingTimeInMillis() - JOIN_WATCHDOG_MARGIN_MS),
        )
  // Awaited by the upload's complete step and below; this only stops an early
  // spawn error being reported as unhandled before either gets there.
  exit.catch(() => undefined)

  let uploadId: string | undefined
  let completed = false
  const abortUpload = async (id: string): Promise<void> => {
    await s3.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: job.outputS3Key, UploadId: id }),
    )
  }
  const upload = uploadStreamMultipart({
    stream: child.stdout,
    create: async () => {
      const created = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: job.outputS3Key,
          ContentType: 'video/mp4',
        }),
      )
      if (!created.UploadId) throw new Error('multipart upload returned no id')
      uploadId = created.UploadId
      return created.UploadId
    },
    uploadPart: async (id, partNumber, body) => {
      const part = await s3.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: job.outputS3Key,
          UploadId: id,
          PartNumber: partNumber,
          Body: body,
        }),
      )
      if (!part.ETag) throw new Error(`part ${partNumber} returned no etag`)
      return part.ETag
    },
    complete: async (id, parts) => {
      const code = await exit
      if (timedOut) throw new Error('the join ran out of time')
      if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${redactUrls(stderr).slice(-500)}`)
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: job.outputS3Key,
          UploadId: id,
          MultipartUpload: {
            Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      )
      completed = true
    },
    abort: abortUpload,
  })

  try {
    const [{ bytes }] = await Promise.all([upload, exit])
    return {
      outputS3Key: job.outputS3Key,
      integratedLufs: parseIntegratedLufs(stderr),
      bytes,
      elapsedMs: Date.now() - started,
    }
  } catch (error) {
    // A spawn error or a failure on either side: no completed object stays.
    child.kill()
    // uploadStreamMultipart aborts its own failures; this second abort only matters
    // when `exit` rejects (a spawn error) while the upload is still mid-stream.
    if (uploadId !== undefined && !completed) {
      await abortUpload(uploadId).catch((abortError: unknown) => {
        console.error(
          JSON.stringify({
            event: 'multipart-abort-failed',
            uploadId,
            key: job.outputS3Key,
            message: String(abortError),
          }),
        )
      })
    }
    throw error
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog)
  }
}

async function runLoudnorm(job: Extract<MediaJob, { kind: 'loudnorm' }>) {
  // Container-aware (decision 188): an .mp4 output keeps its video stream
  // (copied, not re-encoded) and may safely name the SAME key as its input
  // — the upload only happens after ffmpeg succeeded, so a failed pass
  // leaves the original untouched. Anything else is the original per-chunk
  // voice path: bare audio out as wav.
  const video = job.outputS3Key.endsWith('.mp4')
  const input = video ? '/tmp/loudnorm-input.mp4' : '/tmp/loudnorm-input'
  const output = video ? '/tmp/loudnorm-output.mp4' : '/tmp/loudnorm-output.wav'
  await download(job.s3Key, input)
  const measureStderr = await ffmpeg(loudnormMeasureArgs(input, job.targetLufs))
  const measured = parseLoudnormJson(measureStderr)
  if (!measured) throw new Error('loudnorm pass 1 produced no measurement')
  const applyStderr = await ffmpeg([
    '-y',
    ...(video
      ? loudnormApplyVideoArgs(input, output, job.targetLufs, measured)
      : loudnormApplyArgs(input, output, job.targetLufs, measured)),
  ])
  const outputLufs = parseIntegratedLufs(applyStderr) ?? job.targetLufs
  await upload(job.outputS3Key, output, video ? 'video/mp4' : 'audio/wav')
  return {
    outputS3Key: job.outputS3Key,
    inputLufs: Number(measured.input_i),
    outputLufs,
  }
}

/** Whisper binary + model land in /tmp on cold start (spec section 8). */
async function ensureWhisper(): Promise<{ binary: string; model: string }> {
  const binary = '/tmp/whisper-main'
  const model = '/tmp/whisper-model.bin'
  if (!existsSync(binary)) {
    const assetsBucket = env('WHISPER_BUCKET')
    const binaryResult = await s3.send(
      new GetObjectCommand({ Bucket: assetsBucket, Key: env('WHISPER_BINARY_KEY') }),
    )
    await pipeline(binaryResult.Body as Readable, createWriteStream(binary))
    chmodSync(binary, 0o755)
    const modelResult = await s3.send(
      new GetObjectCommand({ Bucket: assetsBucket, Key: env('WHISPER_MODEL_KEY') }),
    )
    await pipeline(modelResult.Body as Readable, createWriteStream(model))
  }
  return { binary, model }
}

async function runTranscribe(job: Extract<MediaJob, { kind: 'transcribe' }>) {
  const input = '/tmp/transcribe-input'
  const wav = '/tmp/transcribe.wav'
  const outBase = '/tmp/transcribe-out'
  // The schema guarantees exactly one of the two.
  const keys = job.audioS3Keys ?? [job.audioS3Key!]
  const { binary, model } = await ensureWhisper()
  const results: { audioS3Key: string; words: ReturnType<typeof whisperJsonToCaptions> }[] = []
  // One after another over the same temp paths: a batch is eight paragraphs
  // and /tmp is small.
  for (const audioS3Key of keys) {
    await download(audioS3Key, input)
    await ffmpeg(['-y', ...toWhisperWavArgs(input, wav)])
    const { code, stderr } = await run(binary, whisperArgs(model, wav, outBase))
    if (code !== 0) throw new Error(`whisper exited ${code}: ${stderr.slice(-500)}`)
    const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8')) as unknown
    results.push({ audioS3Key, words: whisperJsonToCaptions(json) })
  }
  return job.audioS3Keys ? { results } : { words: results[0]!.words }
}

/**
 * S3 → YouTube resumable upload (spec section 9): 8 MB chunks (256 KB
 * aligned), resume on 308. Token refresh mid-upload arrives with M7's
 * publish-runner; a token expiring here fails the job honestly and the app
 * retries with a fresh token.
 */
async function runUploadYoutube(job: Extract<MediaJob, { kind: 'upload-youtube' }>) {
  const { client, bucket } = clientFor(job.videoS3Key)
  // The length alone: the video is read a chunk at a time below, never whole.
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: job.videoS3Key }))
  const total = head.ContentLength
  if (total === undefined) throw new Error('video object has no length')

  // Both paths stop starting chunks at the deadline: the invocation ends at
  // 15 minutes, and a continuation picks the session up from its offset.
  // Only the parts-aware app sends `budgetMs`, and only it can read an
  // in-progress result; a job without one (an old app in the deploy window)
  // runs to the end as it always did.
  const deadlineAt = job.budgetMs === undefined ? undefined : Date.now() + job.budgetMs
  const readRange = async (start: number, endInclusive: number) => {
    const part = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: job.videoS3Key,
        Range: `bytes=${start}-${endInclusive}`,
      }),
    )
    const bytes = await part.Body?.transformToByteArray()
    if (!bytes) throw new Error('video object has no body')
    return bytes
  }

  if (job.resume) {
    const session = await querySessionOffset({
      uploadUrl: job.resume.uploadUrl,
      total,
      fetchImpl: fetch,
    })
    if (session.kind === 'done') return { videoId: session.videoId, status: session.status }
    return putInChunks({
      total,
      uploadUrl: job.resume.uploadUrl,
      fetchImpl: fetch,
      readRange,
      startOffset: session.offset,
      deadlineAt,
    })
  }

  const startResponse = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${job.accessToken}`,
        'content-type': 'application/json',
        'x-upload-content-length': String(total),
        'x-upload-content-type': 'video/mp4',
      },
      body: youtubeInitBody(job),
    },
  )
  if (!startResponse.ok) {
    throw new Error(`youtube resumable init failed: ${startResponse.status}`)
  }
  const uploadUrl = startResponse.headers.get('location')
  if (!uploadUrl) throw new Error('youtube resumable init returned no location')

  return putInChunks({ total, uploadUrl, fetchImpl: fetch, readRange, deadlineAt })
}

// ---------------------------------------------------------------------------

// Error tracking (spec section 12): inert without a DSN. Job failures are
// already reported through the signed callback; Sentry catches what dies
// BEFORE a callback exists — init crashes, schema-level bugs, OOM aftermath.
if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    release: process.env['SENTRY_RELEASE'] ?? 'dev',
    environment: 'lambda',
    tracesSampleRate: 0,
  })
}

async function handleEvent(event: unknown, context?: LambdaContext): Promise<void> {
  const parsed = MediaJobSchema.safeParse(event)
  if (!parsed.success) {
    // No callbackUrl to report to — log and stop; the broker validated
    // before dispatch, so reaching this line means a config-level bug.
    console.error(JSON.stringify({ event: 'invalid-job', issues: parsed.error.issues }))
    return
  }
  const job = parsed.data
  console.log(JSON.stringify({ event: 'job-started', jobId: job.jobId, kind: job.kind }))

  const base = { source: 'media-utils' as const, jobId: job.jobId, projectId: job.projectId }
  let callback: MediaJobCallback
  try {
    switch (job.kind) {
      case 'qc':
        callback = { ...base, kind: 'qc', ok: true, result: await runQc(job) }
        break
      case 'loudnorm':
        callback = { ...base, kind: 'loudnorm', ok: true, result: await runLoudnorm(job) }
        break
      case 'transcribe':
        callback = { ...base, kind: 'transcribe', ok: true, result: await runTranscribe(job) }
        break
      case 'upload-youtube':
        callback = {
          ...base,
          kind: 'upload-youtube',
          ok: true,
          result: await runUploadYoutube(job),
        }
        break
      case 'join':
        callback = { ...base, kind: 'join', ok: true, result: await runJoin(job, context) }
        break
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'job-failed', jobId: job.jobId, message }))
    callback = { ...base, kind: job.kind, ok: false, error: message }
  }

  await postCallback(job.callbackUrl, callback)
  console.log(JSON.stringify({ event: 'job-finished', jobId: job.jobId, ok: callback.ok }))
}

/** Wrapped only when Sentry is live — without a DSN this IS `handleEvent`. */
export const handler = process.env['SENTRY_DSN'] ? Sentry.wrapHandler(handleEvent) : handleEvent
