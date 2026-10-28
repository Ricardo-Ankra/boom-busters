import { globalPulse, projectPulse } from '@boom-busters/db'
import { UlidSchema } from '@boom-busters/schemas'
import { auth } from '@/auth'
import { db } from '@/lib/db'

/**
 * What LiveRefresh polls: an opaque change token, a few hundred bytes.
 * `?project=<ulid>` scopes it to one project's screen; `?channel=<ulid>`
 * answers the dashboard's variant over one channel's projects and runs. The full page re-render —
 * ~400 KB of Postgres reads — happens only when this token moves, which
 * is what keeps a 3-second poll from eating the month's Neon transfer.
 */

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const params = new URL(request.url).searchParams
  const project = params.get('project')
  const channel = params.get('channel')
  if (project !== null && !UlidSchema.safeParse(project).success) {
    return new Response('Unknown project', { status: 400 })
  }
  if (project === null && (channel === null || !UlidSchema.safeParse(channel).success)) {
    return new Response('Unknown channel', { status: 400 })
  }

  const pulse =
    project !== null ? await projectPulse(db, project) : await globalPulse(db, channel as string)
  return Response.json({ pulse }, { headers: { 'cache-control': 'no-store' } })
}
