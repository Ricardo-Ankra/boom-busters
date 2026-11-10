import { getRender, updateRender } from '@boom-busters/db'
import { partsProgressPct } from '@boom-busters/schemas'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { brokerConfigured, fetchRenderProgress, presignRenderOutput } from '@/lib/broker'

/**
 * What the render screen polls at 2 s (build spec sections 8, 11.3).
 *
 * Live renders proxy the broker's `getRenderProgress` — Inngest relies on
 * the webhook, the UI on this poll, and the two never wait on each other.
 * Local renders read the row the runner is updating. Either way the answer
 * is the renders ROW plus whatever fresher truth the broker has, so the
 * screen never shows a percent the database has not seen.
 */

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const render = await getRender(db, id)
  if (!render) return new Response('No such render', { status: 404 })

  let status = render.status
  let progressPct = render.progressPct
  let outputUrl: string | undefined
  let message: string | undefined
  let error = render.error ?? null
  let partNote: string | undefined
  let failedNote: string | undefined

  const inFlight = render.status === 'invoking' || render.status === 'rendering'
  const parts = render.parts !== null && render.parts.length > 0 ? render.parts : null
  if (parts) {
    // A long master rendered in parts. The broker knows each part by its own
    // ULID, never the row's, so progress is the frame-weighted sum of the
    // parts' own. A part with no broker record yet (the row can lag its
    // submit) is left out and counts as nothing until the next poll.
    if (inFlight && brokerConfigured()) {
      const live: Record<string, number> = {}
      const failedOnBroker = new Set<number>()
      await Promise.all(
        parts
          .filter((part) => part.status === 'rendering')
          .map(async (part) => {
            try {
              const progress = await fetchRenderProgress(part.renderId)
              live[part.renderId] = progress.overallProgress
              if (progress.status === 'failed') failedOnBroker.add(part.index)
            } catch {
              // Not there yet, or the broker is briefly unreachable.
            }
          }),
      )
      progressPct = Math.max(progressPct, partsProgressPct(parts, live))
      if (progressPct > render.progressPct) {
        await updateRender(db, render.id, { progressPct })
      }
      // Unlike a single render, the row is left alone: the runner retries a
      // failed part once, so the note only warns that it is happening.
      const failedIndex = [...failedOnBroker].sort((a, b) => a - b)[0]
      if (failedIndex !== undefined) {
        failedNote = `Part ${failedIndex + 1} of ${parts.length} failed on Lambda; it is retried once`
      }
    }
    if (inFlight) {
      const current = parts
        .filter((part) => part.status === 'rendering')
        .sort((a, b) => a.index - b.index)[0]
      if (current) partNote = `Part ${current.index + 1} of ${parts.length}`
      if (failedNote) partNote = failedNote
    } else if (render.status === 'qc') {
      // Every part is rendered; the row stays at 100% while the parts are
      // measured one by one and then joined.
      partNote = parts.every((part) => part.qc !== undefined)
        ? `Joining ${parts.length} parts`
        : `Measuring ${parts.length} parts`
    } else if (
      render.status === 'done' &&
      brokerConfigured() &&
      render.outputS3Key?.startsWith('renders/')
    ) {
      try {
        outputUrl = await presignRenderOutput(render.outputS3Key)
      } catch {
        // No link this poll; the screen says it is fetching and asks again.
      }
    }
  } else if (brokerConfigured() && render.brokerRenderId) {
    try {
      const progress = await fetchRenderProgress(render.id)
      progressPct = Math.max(progressPct, Math.round(progress.overallProgress * 100))
      outputUrl = progress.outputUrl
      message = progress.message
      if (inFlight && progressPct > render.progressPct) {
        await updateRender(db, render.id, { progressPct })
      }
      // The broker knowing the render is dead beats a row still saying
      // 'rendering': surface it NOW, not when the runner's webhook wait
      // times out half an hour later. Idempotent against the runner's own
      // failure bookkeeping landing afterwards.
      if (inFlight && progress.status === 'failed') {
        status = 'failed'
        error = { message: progress.message ?? 'The render failed on Lambda.' }
        await updateRender(db, render.id, {
          status: 'failed',
          error,
          completedAt: new Date(),
        })
      }
    } catch {
      // The broker being briefly unreachable is a poll's problem, not the
      // render's — answer from the row and let the next poll try again.
    }
  } else if (render.outputS3Key?.startsWith('local://')) {
    outputUrl = `/api/renders/${render.id}/file`
  }

  return Response.json({
    id: render.id,
    status,
    progressPct,
    startedAt: render.startedAt,
    completedAt: render.completedAt,
    costUsd: render.costUsd,
    qcReport: render.qcReport ?? null,
    error,
    ...(outputUrl !== undefined ? { outputUrl } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(partNote !== undefined ? { partNote } : {}),
    ...(parts
      ? { parts: parts.map((part) => ({ index: part.index, startMs: part.startMs })) }
      : {}),
  })
}
