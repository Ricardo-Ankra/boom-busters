import { getRender, updateRender } from '@boom-busters/db'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { brokerConfigured, fetchRenderProgress } from '@/lib/broker'

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

  let progressPct = render.progressPct
  let outputUrl: string | undefined
  let message: string | undefined

  const inFlight = render.status === 'invoking' || render.status === 'rendering'
  if (brokerConfigured() && render.brokerRenderId) {
    try {
      const progress = await fetchRenderProgress(render.id)
      progressPct = Math.max(progressPct, Math.round(progress.overallProgress * 100))
      outputUrl = progress.outputUrl
      message = progress.message
      if (inFlight && progressPct > render.progressPct) {
        await updateRender(db, render.id, { progressPct })
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
    status: render.status,
    progressPct,
    startedAt: render.startedAt,
    completedAt: render.completedAt,
    costUsd: render.costUsd,
    qcReport: render.qcReport ?? null,
    error: render.error ?? null,
    ...(outputUrl !== undefined ? { outputUrl } : {}),
    ...(message !== undefined ? { message } : {}),
  })
}
