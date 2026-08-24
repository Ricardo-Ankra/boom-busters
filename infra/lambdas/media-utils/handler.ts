import { spawn } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { BROKER_SIGNATURE_HEADER, brokerSignature, MediaJobSchema } from '@boom-busters/schemas'
import type { MediaJob, MediaJobCallback } from '@boom-busters/schemas'
import type { Readable } from 'node:stream'
import {
  buildQcReport,
  loudnormApplyArgs,
  loudnormApplyVideoArgs,
  loudnormMeasureArgs,
  parseBlackFrames,
  parseFreezes,
  parseIntegratedLufs,
  parseLoudnormJson,
  parseSilences,
  qcArgs,
  toWhisperWavArgs,
  whisperArgs,
  whisperJsonToCaptions,
} from './commands'

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
  return buildQcReport({
    silences: parseSilences(stderr),
    blackFrames: parseBlackFrames(stderr),
    freezes: parseFreezes(stderr),
    integratedLufs: parseIntegratedLufs(stderr),
    targetLufs: job.targetLufs,
  })
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
  await download(job.audioS3Key, input)
  await ffmpeg(['-y', ...toWhisperWavArgs(input, wav)])
  const { binary, model } = await ensureWhisper()
  const outBase = '/tmp/transcribe-out'
  const { code, stderr } = await run(binary, whisperArgs(model, wav, outBase))
  if (code !== 0) throw new Error(`whisper exited ${code}: ${stderr.slice(-500)}`)
  const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8')) as unknown
  return { words: whisperJsonToCaptions(json) }
}

/**
 * S3 → YouTube resumable upload (spec section 9): 8 MB chunks (256 KB
 * aligned), resume on 308. Token refresh mid-upload arrives with M7's
 * publish-runner; a token expiring here fails the job honestly and the app
 * retries with a fresh token.
 */
async function runUploadYoutube(job: Extract<MediaJob, { kind: 'upload-youtube' }>) {
  const { client, bucket } = clientFor(job.videoS3Key)
  const head = await client.send(new GetObjectCommand({ Bucket: bucket, Key: job.videoS3Key }))
  const total = head.ContentLength
  if (total === undefined) throw new Error('video object has no length')
  const bytes = await head.Body?.transformToByteArray()
  if (!bytes) throw new Error('video object has no body')

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
      body: JSON.stringify({
        snippet: { title: job.title, description: job.description, tags: job.tags },
        status: {
          privacyStatus: job.privacyStatus,
          selfDeclaredMadeForKids: false,
          ...(job.publishAt !== undefined ? { publishAt: job.publishAt } : {}),
        },
      }),
    },
  )
  if (!startResponse.ok) {
    throw new Error(`youtube resumable init failed: ${startResponse.status}`)
  }
  const uploadUrl = startResponse.headers.get('location')
  if (!uploadUrl) throw new Error('youtube resumable init returned no location')

  const CHUNK = 8 * 1024 * 1024 // 256 KB-aligned
  let offset = 0
  for (;;) {
    const end = Math.min(offset + CHUNK, total)
    const chunk = bytes.subarray(offset, end)
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-length': String(chunk.length),
        'content-range': `bytes ${offset}-${end - 1}/${total}`,
      },
      body: chunk,
    })
    if (response.status === 308) {
      const range = response.headers.get('range')
      offset = range ? Number(range.split('-')[1]) + 1 : end
      continue
    }
    if (response.ok) {
      const uploaded = (await response.json()) as {
        id?: string
        status?: { uploadStatus?: string }
      }
      return {
        videoId: uploaded.id ?? 'unknown',
        status: uploaded.status?.uploadStatus ?? 'uploaded',
      }
    }
    throw new Error(`youtube upload failed with ${response.status}`)
  }
}

// ---------------------------------------------------------------------------

export async function handler(event: unknown): Promise<void> {
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'job-failed', jobId: job.jobId, message }))
    callback = { ...base, kind: job.kind, ok: false, error: message }
  }

  await postCallback(job.callbackUrl, callback)
  console.log(JSON.stringify({ event: 'job-finished', jobId: job.jobId, ok: callback.ok }))
}
