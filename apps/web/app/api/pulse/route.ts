import { globalPulse, projectPulse } from '@boom-busters/db'
import { UlidSchema } from '@boom-busters/schemas'
import { auth } from '@/auth'
import { db } from '@/lib/db'

/**
 * What LiveRefresh polls: an opaque change token, a few hundred bytes.
 * `?project=<ulid>` scopes it to one project's screen; without it the
 * dashboard's cross-project variant answers. The full page re-render —
 * ~400 KB of Postgres reads — happens only when this token moves, which
 * is what keeps a 3-second poll from eating the month's Neon transfer.
 */

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const project = new URL(request.url).searchParams.get('project')
  if (project !== null && !UlidSchema.safeParse(project).success) {
    return new Response('Unknown project', { status: 400 })
  }

  const pulse = project === null ? await globalPulse(db) : await projectPulse(db, project)
  return Response.json({ pulse }, { headers: { 'cache-control': 'no-store' } })
}
