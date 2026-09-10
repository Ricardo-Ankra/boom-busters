import { getAsset } from '@boom-busters/db'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { presignGet } from '@/lib/storage'

/**
 * Where the visual board gets bytes it owns — generated stills and uploads.
 *
 * A redirect, not a proxy, same rule as the voice-take audio route: the
 * response is a 302 to a short-lived presigned R2 URL and the browser fetches
 * from R2 directly. Stock candidates never come through here at all — their
 * thumbnails load straight off the provider's CDN, and their full files stay
 * with the provider until the render side materialises them in M6.
 */

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const asset = await getAsset(db, id)
  if (!asset) return new Response('No such asset', { status: 404 })

  let signed: string
  try {
    signed = await presignGet(asset.r2Key)
  } catch (error) {
    // R2 unconfigured or unreachable used to escape as a raw 500 on every
    // thumbnail (audit, decision 238). Words instead.
    console.error('[assets] presign failed', error)
    return new Response('Object storage is not reachable. Check the R2 settings.', {
      status: 503,
    })
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: signed,
      /**
       * The browser may keep this redirect (decision 238): without it, every
       * screen refresh re-ran session + DB + presign per image. 2400 s stays
       * inside the presigned URL's remaining life, which is the 3600 s TTL
       * minus at most one 15 minute signing bucket. Private: session content.
       */
      'cache-control': 'private, max-age=2400',
    },
  })
}
