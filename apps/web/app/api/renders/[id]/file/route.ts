import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { getRender } from '@boom-busters/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { localRenderPath } from '@/lib/local-render'

/**
 * Where a LOCALLY rendered master plays from. `local://` keys only, and only
 * in mock-provider mode — a live deployment's masters live in S3, and their
 * playable URL is the broker-presigned `outputUrl` on the progress response,
 * never this route. Minimal single-range support so the player can seek.
 */

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const render = await getRender(db, id)
  if (!render?.outputS3Key) return new Response('No such render output', { status: 404 })

  const filePath = localRenderPath(render.outputS3Key)
  if (!filePath) {
    return new Response(
      'This master lives in S3 — play it from the presigned outputUrl on the progress response.',
      { status: 409 },
    )
  }
  if (!mockProvidersEnabled()) {
    // A local:// key on a live deployment is a leftover from mock runs, not
    // something to serve bytes for.
    return new Response('Local renders are only served in mock-provider mode.', { status: 409 })
  }

  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return new Response('The local render file is gone — render again.', { status: 404 })
  }

  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    }
    return new Response(
      Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream,
      {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
        },
      },
    )
  }

  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    status: 200,
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(size),
      'accept-ranges': 'bytes',
    },
  })
}
