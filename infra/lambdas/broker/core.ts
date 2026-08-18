import {
  canonicalTimelineIssues,
  CancelAcceptedSchema,
  MediaJobSchema,
  RemotionWebhookSchema,
  RenderRequestSchema,
  TimelineSchema,
} from '@boom-busters/schemas'
import type {
  MediaJob,
  RenderCallback,
  RenderKind,
  RenderProgress,
  RenderStatus,
  Timeline,
} from '@boom-busters/schemas'

/**
 * The broker's brain (build spec section 8), pure and dependency-injected:
 * every AWS surface — S3 state, R2 presigning, Remotion Lambda, async
 * media-utils dispatch, the signed callback into the app — arrives as an
 * interface, so the whole request lifecycle is unit-tested without a single
 * network call. `handler.ts` is the only file that knows AWS exists.
 */

// ---------------------------------------------------------------------------
// Injected surfaces
// ---------------------------------------------------------------------------

/** One render's durable state, keyed by the app's ULID. */
export interface RenderRecord {
  renderId: string
  projectId: string
  kind: RenderKind
  composition: string
  remotionRenderId: string
  /** Remotion's render bucket — progress and discard both need it. */
  bucketName: string
  status: RenderStatus
  outputS3Key?: string
  costUsd?: number
  message?: string
}

export interface BrokerStore {
  getRender(renderId: string): Promise<RenderRecord | null>
  putRender(record: RenderRecord): Promise<void>
  /** Renders currently believed to be running — the concurrency cap's input. */
  listRunning(): Promise<RenderRecord[]>
  findByRemotionId(remotionRenderId: string): Promise<RenderRecord | null>
  isTombstoned(renderId: string): Promise<boolean>
  tombstone(renderId: string): Promise<void>
}

export interface RemotionClient {
  render(input: {
    composition: string
    timeline: Timeline
    /** Forwarded so the webhook can be verified and routed back here. */
    renderId: string
  }): Promise<{ remotionRenderId: string; bucketName: string }>
  progress(
    remotionRenderId: string,
    bucketName: string,
  ): Promise<{
    done: boolean
    overallProgress: number
    outputFile: string | null
    costUsd: number | null
    fatalError: string | null
  }>
  /** deleteRender(): discard a tombstoned render's artefacts. */
  discard(remotionRenderId: string, bucketName: string): Promise<void>
}

export interface StorageClient {
  /** Read the canonical timeline JSON from app storage. */
  getJson(key: string): Promise<unknown>
  /** Write the materialised copy for audit: renders/<id>/timeline.json. */
  putJson(key: string, value: unknown): Promise<void>
  /** Fresh presigned GET (24 h) for a media storage key. */
  presign(key: string): Promise<string>
}

export interface BrokerDeps {
  token: string
  renderCap: number
  store: BrokerStore
  remotion: RemotionClient
  storage: StorageClient
  /** Fire-and-forget async invoke of the media-utils Lambda. */
  dispatchMediaJob(job: MediaJob): Promise<void>
  /** POST the HMAC-signed callback into the app. */
  postCallback(payload: RenderCallback): Promise<void>
  /** True when the webhook request really came from Remotion. */
  verifyRemotionSignature(body: string, headers: Record<string, string>): boolean
  log(entry: Record<string, unknown>): void
}

export interface BrokerRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: string
}

export interface BrokerResponse {
  status: number
  body: unknown
}

// ---------------------------------------------------------------------------
// Cost estimate
// ---------------------------------------------------------------------------

/** Spec section 8.1: a full master ≈ $0.25 for ~15 minutes of video. */
export const ESTIMATED_COST_PER_VIDEO_SECOND_USD = 0.25 / 900

export function estimateRenderCostUsd(expectedDurationSec: number): number {
  return Math.round(expectedDurationSec * ESTIMATED_COST_PER_VIDEO_SECOND_USD * 10_000) / 10_000
}

// ---------------------------------------------------------------------------
// Materialisation (spec section 8.2)
// ---------------------------------------------------------------------------

/**
 * Canonical timeline in, render-ready copy out: every storage key gains a
 * fresh presigned URL. Stable external URLs are already loadable and pass
 * through untouched. The canonical original is never mutated.
 */
export async function materialiseTimeline(
  timeline: Timeline,
  presign: (key: string) => Promise<string>,
): Promise<Timeline> {
  const copy = JSON.parse(JSON.stringify(timeline)) as Timeline
  for (const segment of copy.narration) {
    segment.url = await presign(segment.r2Key)
  }
  if (copy.music) {
    copy.music.url = await presign(copy.music.r2Key)
  }
  for (const slot of copy.slots) {
    if (slot.payload.kind === 'image' || slot.payload.kind === 'video') {
      const src = slot.payload.src
      if (src.r2Key !== undefined) {
        src.url = await presign(src.r2Key)
      } else if (src.externalUrl !== undefined) {
        src.url = src.externalUrl
      }
    }
  }
  return copy
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

const MEDIA_PATHS: Record<string, MediaJob['kind']> = {
  '/media/qc': 'qc',
  '/media/loudnorm': 'loudnorm',
  '/media/transcribe': 'transcribe',
  '/media/upload-youtube': 'upload-youtube',
}

export async function handleBrokerRequest(
  request: BrokerRequest,
  deps: BrokerDeps,
): Promise<BrokerResponse> {
  const path = request.path.replace(/\/+$/, '') || '/'

  // The Remotion webhook authenticates by signature, not bearer token.
  if (request.method === 'POST' && path === '/webhooks/remotion') {
    return handleRemotionWebhook(request, deps)
  }

  const auth = request.headers['authorization'] ?? ''
  if (auth !== `Bearer ${deps.token}`) {
    deps.log({ event: 'auth-rejected', path })
    return { status: 401, body: { error: 'invalid bearer token' } }
  }

  if (request.method === 'POST' && path === '/renders') {
    return handleCreateRender(request, deps)
  }

  const cancelMatch = /^\/renders\/([^/]+)\/cancel$/.exec(path)
  if (request.method === 'POST' && cancelMatch) {
    return handleCancel(cancelMatch[1]!, deps)
  }

  const progressMatch = /^\/renders\/([^/]+)$/.exec(path)
  if (request.method === 'GET' && progressMatch) {
    return handleProgress(progressMatch[1]!, deps)
  }

  const mediaKind = MEDIA_PATHS[path]
  if (request.method === 'POST' && mediaKind !== undefined) {
    return handleMediaDispatch(request, mediaKind, deps)
  }

  return { status: 404, body: { error: `no route for ${request.method} ${path}` } }
}

async function handleCreateRender(
  request: BrokerRequest,
  deps: BrokerDeps,
): Promise<BrokerResponse> {
  const parsed = RenderRequestSchema.safeParse(safeJson(request.body))
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'invalid render request', issues: issueList(parsed.error) },
    }
  }
  const render = parsed.data

  // Preventive runaway protection: the cap refuses before money moves.
  const running = await deps.store.listRunning()
  if (running.length >= deps.renderCap) {
    return {
      status: 409,
      body: {
        error: `render concurrency cap (${deps.renderCap}) reached — ${running.length} running`,
      },
    }
  }

  const rawTimeline = await deps.storage.getJson(render.timelineS3Key)
  const timelineParsed = TimelineSchema.safeParse(rawTimeline)
  if (!timelineParsed.success) {
    return {
      status: 422,
      body: { error: 'timeline does not validate', issues: issueList(timelineParsed.error) },
    }
  }
  const canonicalIssues = canonicalTimelineIssues(timelineParsed.data)
  if (canonicalIssues.length > 0) {
    // A stored timeline carrying URLs breaks "re-renderable forever" — the
    // broker refuses rather than rendering from something that will expire.
    return { status: 422, body: { error: 'timeline is not canonical', issues: canonicalIssues } }
  }

  const materialised = await materialiseTimeline(timelineParsed.data, (key) =>
    deps.storage.presign(key),
  )
  await deps.storage.putJson(`renders/${render.renderId}/timeline.json`, materialised)

  const { remotionRenderId, bucketName } = await deps.remotion.render({
    composition: render.composition,
    timeline: materialised,
    renderId: render.renderId,
  })

  await deps.store.putRender({
    renderId: render.renderId,
    projectId: render.projectId,
    kind: render.kind,
    composition: render.composition,
    remotionRenderId,
    bucketName,
    status: 'running',
  })

  deps.log({ event: 'render-started', renderId: render.renderId, remotionRenderId })
  return {
    status: 201,
    body: {
      brokerRenderId: render.renderId,
      remotionRenderId,
      estimatedCostUsd: estimateRenderCostUsd(render.expectedDurationSec),
    },
  }
}

async function handleCancel(renderId: string, deps: BrokerDeps): Promise<BrokerResponse> {
  const record = await deps.store.getRender(renderId)
  const wasRunning = record?.status === 'running'

  // Tombstone FIRST: even if the record write below races the webhook, the
  // tombstone is what guarantees no completion event ever fires (8.1).
  await deps.store.tombstone(renderId)
  if (record) {
    await deps.store.putRender({ ...record, status: 'cancelled' })
  }

  deps.log({ event: 'render-cancelled', renderId, wasRunning })
  return {
    status: 200,
    body: CancelAcceptedSchema.parse({ renderId, status: 'cancelled', wasRunning }),
  }
}

async function handleProgress(renderId: string, deps: BrokerDeps): Promise<BrokerResponse> {
  const record = await deps.store.getRender(renderId)
  if (!record) return { status: 404, body: { error: `unknown render ${renderId}` } }

  if (record.status !== 'running') {
    const body: RenderProgress = {
      renderId,
      status: record.status,
      overallProgress: record.status === 'completed' ? 1 : 0,
      ...(record.outputS3Key !== undefined ? { outputS3Key: record.outputS3Key } : {}),
      ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
      ...(record.message !== undefined ? { message: record.message } : {}),
    }
    return { status: 200, body }
  }

  const progress = await deps.remotion.progress(record.remotionRenderId, record.bucketName)
  const body: RenderProgress = progress.fatalError
    ? { renderId, status: 'failed', overallProgress: 0, message: progress.fatalError }
    : progress.done
      ? {
          renderId,
          status: 'completed',
          overallProgress: 1,
          ...(progress.outputFile !== null ? { outputS3Key: progress.outputFile } : {}),
          ...(progress.costUsd !== null ? { costUsd: progress.costUsd } : {}),
        }
      : { renderId, status: 'running', overallProgress: progress.overallProgress }
  return { status: 200, body }
}

async function handleRemotionWebhook(
  request: BrokerRequest,
  deps: BrokerDeps,
): Promise<BrokerResponse> {
  if (!deps.verifyRemotionSignature(request.body, request.headers)) {
    // Signature failures are alarm-worthy (section 12): possible probe.
    deps.log({ event: 'signature-rejected', source: 'remotion' })
    return { status: 401, body: { error: 'bad signature' } }
  }

  const parsed = RemotionWebhookSchema.safeParse(safeJson(request.body))
  if (!parsed.success) {
    // Verified-but-unreadable: log loudly, 200 quietly — a 4xx would only
    // make Remotion retry a payload that will never parse.
    deps.log({ event: 'webhook-unparseable', issues: issueList(parsed.error) })
    return { status: 200, body: { ok: true } }
  }
  const webhook = parsed.data

  const record = await deps.store.findByRemotionId(webhook.renderId)
  if (!record) {
    deps.log({ event: 'webhook-unknown-render', remotionRenderId: webhook.renderId })
    return { status: 200, body: { ok: true } }
  }

  if (await deps.store.isTombstoned(record.renderId)) {
    // Cancelled mid-flight (8.1): acknowledge, discard artefacts, and emit
    // NOTHING — the Inngest run is already gone.
    await deps.remotion.discard(record.remotionRenderId, record.bucketName)
    await deps.store.putRender({ ...record, status: 'cancelled' })
    deps.log({ event: 'webhook-tombstoned', renderId: record.renderId })
    return { status: 200, body: { ok: true } }
  }

  if (webhook.type === 'success') {
    const outputS3Key = webhook.outputFile ?? `renders/${record.remotionRenderId}/out.mp4`
    const costUsd = webhook.costs?.estimatedCost ?? undefined
    await deps.store.putRender({
      ...record,
      status: 'completed',
      outputS3Key,
      ...(costUsd !== undefined ? { costUsd } : {}),
    })
    await deps.postCallback({
      source: 'broker',
      projectId: record.projectId,
      renderId: record.renderId,
      kind: record.kind,
      result: 'completed',
      outputS3Key,
      ...(costUsd !== undefined ? { costUsd } : {}),
    })
  } else {
    const reason = webhook.type === 'timeout' ? 'timeout' : 'error'
    const message = webhook.errors?.[0]?.message ?? `render ${reason}`
    await deps.store.putRender({ ...record, status: 'failed', message })
    await deps.postCallback({
      source: 'broker',
      projectId: record.projectId,
      renderId: record.renderId,
      kind: record.kind,
      result: 'failed',
      reason,
      message,
    })
  }

  deps.log({ event: 'webhook-normalised', renderId: record.renderId, type: webhook.type })
  return { status: 200, body: { ok: true } }
}

async function handleMediaDispatch(
  request: BrokerRequest,
  pathKind: MediaJob['kind'],
  deps: BrokerDeps,
): Promise<BrokerResponse> {
  const parsed = MediaJobSchema.safeParse(safeJson(request.body))
  if (!parsed.success) {
    return { status: 400, body: { error: 'invalid media job', issues: issueList(parsed.error) } }
  }
  if (parsed.data.kind !== pathKind) {
    return {
      status: 400,
      body: { error: `job kind ${parsed.data.kind} does not match route /media/${pathKind}` },
    }
  }
  await deps.dispatchMediaJob(parsed.data)
  deps.log({ event: 'media-dispatched', jobId: parsed.data.jobId, kind: parsed.data.kind })
  return {
    status: 202,
    body: { jobId: parsed.data.jobId, kind: parsed.data.kind, status: 'dispatched' },
  }
}

// ---------------------------------------------------------------------------

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function issueList(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}
