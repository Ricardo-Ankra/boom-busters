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

  return Response.redirect(await presignGet(asset.r2Key), 302)
}
