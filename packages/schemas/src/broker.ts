import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { UlidSchema } from './ids'
import { CaptionSchema } from './timeline'

/**
 * The broker API contract (build spec section 8): every request and response
 * between the web app, the `boom-busters-broker` Lambda and the
 * `boom-busters-media-utils` Lambda is Zod-validated against THIS module on
 * both sides of the wire. The Lambdas import from schemas only — same rule
 * as compositions: infrastructure never touches the DB.
 *
 * Identity rule: the broker never invents IDs. The app creates a `renders`
 * row (or media job row) and sends its ULID; `brokerRenderId` in responses
 * is that same ULID echoed back, so every artefact, tombstone and callback
 * is keyed by an ID the database already knows.
 */

// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------

export const RENDER_KINDS = ['master', 'short'] as const
export const RenderKindSchema = z.enum(RENDER_KINDS)
export type RenderKind = z.infer<typeof RenderKindSchema>

/** POST /renders */
export const RenderRequestSchema = z.object({
  projectId: UlidSchema,
  /** The app's `renders` row — the broker keys everything by it. */
  renderId: UlidSchema,
  kind: RenderKindSchema,
  /** The CANONICAL timeline (keys only); the broker materialises a copy. */
  timelineS3Key: z.string().min(1),
  /** Composition id in the deployed site, e.g. 'DocumentaryMaster'. */
  composition: z.string().min(1),
  expectedDurationSec: z.number().positive(),
})
export type RenderRequest = z.infer<typeof RenderRequestSchema>

export const RenderAcceptedSchema = z.object({
  brokerRenderId: UlidSchema,
  remotionRenderId: z.string().min(1),
  estimatedCostUsd: z.number().min(0),
})
export type RenderAccepted = z.infer<typeof RenderAcceptedSchema>

export const RENDER_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const
export const RenderStatusSchema = z.enum(RENDER_STATUSES)
export type RenderStatus = z.infer<typeof RenderStatusSchema>

/** GET /renders/:id — proxied getRenderProgress, polled by the UI at 2 s. */
export const RenderProgressSchema = z.object({
  renderId: UlidSchema,
  status: RenderStatusSchema,
  /** 0..1. Remotion's overallProgress while running; 1 when done. */
  overallProgress: z.number().min(0).max(1),
  outputS3Key: z.string().min(1).optional(),
  costUsd: z.number().min(0).optional(),
  message: z.string().optional(),
})
export type RenderProgress = z.infer<typeof RenderProgressSchema>

/** POST /renders/:id/cancel — the section 8.1 honest contract. */
export const CancelAcceptedSchema = z.object({
  renderId: UlidSchema,
  status: z.literal('cancelled'),
  /** Whether a render was actually in flight (its spend is now sunk). */
  wasRunning: z.boolean(),
})
export type CancelAccepted = z.infer<typeof CancelAcceptedSchema>

/**
 * POST /webhooks/remotion — the fields the broker actually reads from
 * Remotion's webhook payload. Loose: Remotion may add fields; the broker
 * must never 4xx on extras (a stale webhook retry-storm is worse than an
 * ignored field).
 */
export const RemotionWebhookSchema = z.looseObject({
  type: z.enum(['success', 'error', 'timeout']),
  renderId: z.string().min(1),
  outputFile: z.string().nullish(),
  outputUrl: z.string().nullish(),
  costs: z.looseObject({ estimatedCost: z.number().optional() }).nullish(),
  errors: z.array(z.looseObject({ message: z.string().optional() })).nullish(),
})
export type RemotionWebhook = z.infer<typeof RemotionWebhookSchema>

// ---------------------------------------------------------------------------
// Media-utils jobs
// ---------------------------------------------------------------------------

export const MEDIA_JOB_KINDS = ['qc', 'loudnorm', 'transcribe', 'upload-youtube'] as const
export const MediaJobKindSchema = z.enum(MEDIA_JOB_KINDS)
export type MediaJobKind = z.infer<typeof MediaJobKindSchema>

const jobCommon = {
  /** The app's job row ULID — echoed in the completion callback. */
  jobId: UlidSchema,
  projectId: UlidSchema,
  /** Where the completion callback is POSTed (HMAC-signed, below). */
  callbackUrl: z.url(),
}

/** Full-master scan: silence, black frames, glitches, loudness (-14 LUFS). */
export const QcJobSchema = z.object({
  kind: z.literal('qc'),
  ...jobCommon,
  s3Key: z.string().min(1),
  /** Master delivery target (spec section 7.6): -14 LUFS integrated. */
  targetLufs: z.number().max(0).default(-14),
})

/** Per-chunk voice normalisation to the -16 LUFS mono reference. */
export const LoudnormJobSchema = z.object({
  kind: z.literal('loudnorm'),
  ...jobCommon,
  s3Key: z.string().min(1),
  outputS3Key: z.string().min(1),
  targetLufs: z.number().max(0).default(-16),
})

/** Whisper.cpp transcription of one chapter's audio (spec section 6). */
export const TranscribeJobSchema = z.object({
  kind: z.literal('transcribe'),
  ...jobCommon,
  audioS3Key: z.string().min(1),
})

/** S3 → YouTube resumable upload (spec section 9); finalised in M7. */
export const UploadYoutubeJobSchema = z.object({
  kind: z.literal('upload-youtube'),
  ...jobCommon,
  videoS3Key: z.string().min(1),
  /** Short-lived access token — the Lambda never sees the refresh token. */
  accessToken: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string().min(1)),
  privacyStatus: z.enum(['private', 'unlisted', 'public']),
  publishAt: z.iso.datetime().optional(),
})

export const MediaJobSchema = z.discriminatedUnion('kind', [
  QcJobSchema,
  LoudnormJobSchema,
  TranscribeJobSchema,
  UploadYoutubeJobSchema,
])
export type MediaJob = z.infer<typeof MediaJobSchema>

/** 202 body for every /media/* dispatch. */
export const MediaJobAcceptedSchema = z.object({
  jobId: UlidSchema,
  kind: MediaJobKindSchema,
  status: z.literal('dispatched'),
})
export type MediaJobAccepted = z.infer<typeof MediaJobAcceptedSchema>

// Job results, per kind ------------------------------------------------------

export const QC_ISSUE_KINDS = ['silence', 'black-frames', 'glitch', 'loudness'] as const
export const QcIssueSchema = z.object({
  kind: z.enum(QC_ISSUE_KINDS),
  atMs: z.number().int().min(0),
  durationMs: z.number().int().min(0).optional(),
  detail: z.string().min(1),
})
export const QcReportSchema = z.object({
  passed: z.boolean(),
  integratedLufs: z.number(),
  issues: z.array(QcIssueSchema),
})
export type QcReport = z.infer<typeof QcReportSchema>

export const LoudnormResultSchema = z.object({
  outputS3Key: z.string().min(1),
  inputLufs: z.number(),
  outputLufs: z.number(),
})
export type LoudnormResult = z.infer<typeof LoudnormResultSchema>

/** Whisper WORDS — text here is the transcript; the snap step swaps in script text. */
export const TranscribeResultSchema = z.object({
  words: z.array(CaptionSchema),
})
export type TranscribeResult = z.infer<typeof TranscribeResultSchema>

export const UploadYoutubeResultSchema = z.object({
  videoId: z.string().min(1),
  status: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Completion callbacks (HMAC-signed, into the web app)
// ---------------------------------------------------------------------------

/**
 * Everything asynchronous flows back through ONE app route: the broker's
 * normalised render outcome and every media-utils job completion POST to the
 * app's broker-hook endpoint, HMAC-signed with the broker token. The app
 * verifies and emits the matching Inngest event — the Lambdas never hold
 * Inngest credentials.
 */
export const RenderCallbackSchema = z.object({
  source: z.literal('broker'),
  projectId: UlidSchema,
  renderId: UlidSchema,
  kind: RenderKindSchema,
  result: z.enum(['completed', 'failed']),
  outputS3Key: z.string().min(1).optional(),
  costUsd: z.number().min(0).optional(),
  reason: z.enum(['error', 'timeout']).optional(),
  message: z.string().optional(),
})
export type RenderCallback = z.infer<typeof RenderCallbackSchema>

export const MediaJobCallbackSchema = z.discriminatedUnion('kind', [
  z.object({
    source: z.literal('media-utils'),
    kind: z.literal('qc'),
    jobId: UlidSchema,
    projectId: UlidSchema,
    ok: z.boolean(),
    result: QcReportSchema.optional(),
    error: z.string().optional(),
  }),
  z.object({
    source: z.literal('media-utils'),
    kind: z.literal('loudnorm'),
    jobId: UlidSchema,
    projectId: UlidSchema,
    ok: z.boolean(),
    result: LoudnormResultSchema.optional(),
    error: z.string().optional(),
  }),
  z.object({
    source: z.literal('media-utils'),
    kind: z.literal('transcribe'),
    jobId: UlidSchema,
    projectId: UlidSchema,
    ok: z.boolean(),
    result: TranscribeResultSchema.optional(),
    error: z.string().optional(),
  }),
  z.object({
    source: z.literal('media-utils'),
    kind: z.literal('upload-youtube'),
    jobId: UlidSchema,
    projectId: UlidSchema,
    ok: z.boolean(),
    result: UploadYoutubeResultSchema.optional(),
    error: z.string().optional(),
  }),
])
export type MediaJobCallback = z.infer<typeof MediaJobCallbackSchema>

export const BrokerCallbackSchema = z.union([RenderCallbackSchema, MediaJobCallbackSchema])
export type BrokerCallback = z.infer<typeof BrokerCallbackSchema>

// ---------------------------------------------------------------------------
// Alignment (provider-layer interface, spec section 6)
// ---------------------------------------------------------------------------

export const AlignmentRequestSchema = z.object({
  audioUrl: z.url(),
  scriptText: z.string().min(1),
})
export type AlignmentRequest = z.infer<typeof AlignmentRequestSchema>

// ---------------------------------------------------------------------------
// Webhook signing (spec section 12)
// ---------------------------------------------------------------------------

/** Header carrying the hex HMAC on every callback and every broker request. */
export const BROKER_SIGNATURE_HEADER = 'x-boom-busters-signature'

/** Hex HMAC-SHA256 of the raw request body under the broker token. */
export function brokerSignature(body: string, token: string): string {
  return createHmac('sha256', token).update(body, 'utf8').digest('hex')
}

/** Constant-time verification — reject-and-log on mismatch (section 12). */
export function verifyBrokerSignature(body: string, token: string, signature: string): boolean {
  const expected = Buffer.from(brokerSignature(body, token), 'hex')
  let provided: Buffer
  try {
    provided = Buffer.from(signature, 'hex')
  } catch {
    return false
  }
  if (provided.length !== expected.length) return false
  return timingSafeEqual(expected, provided)
}
