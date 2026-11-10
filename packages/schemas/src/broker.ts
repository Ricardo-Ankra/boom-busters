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

export const RENDER_KINDS = ['master', 'short', 'draft'] as const
export const RenderKindSchema = z.enum(RENDER_KINDS)
export type RenderKind = z.infer<typeof RenderKindSchema>

/**
 * Remotion's `scale` per render kind. A draft is the moderation copy the
 * assembly stage produces automatically: half resolution (a quarter of the
 * pixels), because its job is judging the cut in a native video element,
 * not being published. Masters and shorts render at full scale.
 */
export const RENDER_SCALES: Record<RenderKind, number> = {
  master: 1,
  short: 1,
  draft: 0.5,
}

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
  /** One part of a long render: inclusive first and last frame. */
  frameRange: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .refine(([first, last]) => first <= last, { message: 'frameRange first must be <= last' })
    .optional(),
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
  /**
   * A playable URL for the finished master, presigned by the broker — the
   * only party holding AWS credentials for the render bucket. Completed
   * renders only; expires like any presign, so the UI fetches progress
   * again rather than storing it.
   */
  outputUrl: z.url().optional(),
  costUsd: z.number().min(0).optional(),
  message: z.string().optional(),
})
export type RenderProgress = z.infer<typeof RenderProgressSchema>

// ---------------------------------------------------------------------------
// Cost estimate
// ---------------------------------------------------------------------------

/**
 * A full master costs about $1.00 per 996 s (16.6 minutes), about $0.90 per
 * 900 s: Remotion reported $1.00 for each of renders u9pq9hoy9c and
 * ja7mt6pz2e (29,963 frames each). The spec section 8.1 figure of $0.25 per
 * 15 minutes ran about 3.6 times low.
 */
export const ESTIMATED_COST_PER_VIDEO_SECOND_USD = 1.0 / 996

/**
 * What a render is expected to cost, from its duration and kind. In the
 * contract package because two parties quote it: the preview screen's
 * render buttons (the real cancel point, section 8.1 — the number shown
 * BEFORE the click) and the broker's accept response. One formula, or the
 * confirm dialog and the invoice drift apart. Lambda's bill scales with
 * pixels painted, so a kind's cost factor is its scale squared — a
 * half-resolution draft is a quarter of the master's price.
 */
export function estimateRenderCostUsd(
  expectedDurationSec: number,
  kind: RenderKind = 'master',
): number {
  const scale = RENDER_SCALES[kind]
  return (
    Math.round(expectedDurationSec * ESTIMATED_COST_PER_VIDEO_SECOND_USD * scale * scale * 10_000) /
    10_000
  )
}

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

export const MEDIA_JOB_KINDS = ['qc', 'loudnorm', 'transcribe', 'upload-youtube', 'join'] as const
export const MediaJobKindSchema = z.enum(MEDIA_JOB_KINDS)
export type MediaJobKind = z.infer<typeof MediaJobKindSchema>

/** ffmpeg loudnorm first-pass measurement, as ffmpeg prints it (strings). */
export const LoudnormMeasurementSchema = z.object({
  input_i: z.string(),
  input_tp: z.string(),
  input_lra: z.string(),
  input_thresh: z.string(),
  target_offset: z.string(),
})
export type LoudnormMeasurement = z.infer<typeof LoudnormMeasurementSchema>

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
  /** A part's start within the film, added to the issue times it reports. */
  offsetMs: z.number().int().min(0).default(0),
  /** Also run the loudnorm first pass and return its measurement. */
  withLoudnorm: z.boolean().default(false),
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
export const TranscribeJobSchema = z
  .object({
    kind: z.literal('transcribe'),
    ...jobCommon,
    audioS3Key: z.string().min(1).optional(),
    audioS3Keys: z.array(z.string().min(1)).min(1).max(8).optional(),
  })
  .refine((job) => (job.audioS3Key === undefined) !== (job.audioS3Keys === undefined), {
    message: 'Provide exactly one of audioS3Key or audioS3Keys',
  })

/** The budget of one upload invocation; the Lambda and the publish runner both import it. */
export const UPLOAD_ROUND_BUDGET_MS = 720_000

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
  /**
   * YouTube's altered-content label (decision 252): set when a chosen still
   * or hero clip depicts a real person by likeness. Optional so a Lambda
   * built before the field ignores it rather than rejecting the job.
   */
  containsSyntheticMedia: z.boolean().optional(),
  /**
   * The channel bible's YouTube category and language. Each is sent only when
   * the bible sets it, so a channel that sets none uploads as it always did.
   */
  categoryId: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
  defaultLanguage: z.string().max(12).optional(),
  defaultAudioLanguage: z.string().max(12).optional(),
  /** Continue a started resumable upload from this byte offset. */
  resume: z.object({ uploadUrl: z.url(), offset: z.number().int().min(0) }).optional(),
  /** Time this invocation may spend uploading before it hands back progress. */
  budgetMs: z.number().int().positive().optional(),
})

/** Joins a long render's parts into one file with the combined loudness gain. */
export const JoinJobSchema = z.object({
  kind: z.literal('join'),
  ...jobCommon,
  partS3Keys: z.array(z.string().min(1)).min(2),
  outputS3Key: z.string().regex(/^renders\//),
  targetLufs: z.number().max(0).default(-14),
  measured: LoudnormMeasurementSchema,
})

export const MediaJobSchema = z.discriminatedUnion('kind', [
  QcJobSchema,
  LoudnormJobSchema,
  TranscribeJobSchema,
  UploadYoutubeJobSchema,
  JoinJobSchema,
])
export type MediaJob = z.infer<typeof MediaJobSchema>
/** What a caller sends: defaulted fields may be left out. */
export type MediaJobInput = z.input<typeof MediaJobSchema>

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
  /** On a part's report: its measurement, for the film-wide combination. */
  loudnorm: LoudnormMeasurementSchema.optional(),
  /** On a part's report: the part's measured duration. */
  durationMs: z.number().int().min(0).optional(),
})
export type QcReport = z.infer<typeof QcReportSchema>

export const LoudnormResultSchema = z.object({
  outputS3Key: z.string().min(1),
  inputLufs: z.number(),
  outputLufs: z.number(),
})
export type LoudnormResult = z.infer<typeof LoudnormResultSchema>

/** Whisper WORDS — text here is the transcript; the snap step swaps in script text. */
export const TranscribeResultSchema = z.union([
  z.object({ words: z.array(CaptionSchema) }),
  z.object({
    results: z.array(z.object({ audioS3Key: z.string().min(1), words: z.array(CaptionSchema) })),
  }),
])
export type TranscribeResult = z.infer<typeof TranscribeResultSchema>

export const UploadYoutubeResultSchema = z.union([
  z.object({ videoId: z.string().min(1), status: z.string().min(1) }),
  z.object({
    status: z.literal('in-progress'),
    uploadUrl: z.url(),
    offset: z.number().int().min(0),
    total: z.number().int().positive(),
  }),
])
export type UploadYoutubeResult = z.infer<typeof UploadYoutubeResultSchema>

export const JoinResultSchema = z.object({
  outputS3Key: z.string().regex(/^renders\//),
  integratedLufs: z.number().nullable(),
  bytes: z.number().int().min(0),
  elapsedMs: z.number().int().min(0),
})
export type JoinResult = z.infer<typeof JoinResultSchema>

/** POST /presign: a download URL for a render-bucket key. */
export const PresignRequestSchema = z.object({ key: z.string().regex(/^renders\/.+/) })
export const PresignResponseSchema = z.object({ url: z.url() })

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
  z.object({
    source: z.literal('media-utils'),
    kind: z.literal('join'),
    jobId: UlidSchema,
    projectId: UlidSchema,
    ok: z.boolean(),
    result: JoinResultSchema.optional(),
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
