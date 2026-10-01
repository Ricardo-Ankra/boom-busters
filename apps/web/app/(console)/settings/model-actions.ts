'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { refreshModelCatalogue, type RefreshOutcome } from '@/lib/model-catalogue'

/**
 * Settings → Models → Refresh model lists (decision 287). Re-checks the
 * session: a server action is a POST endpoint of its own. A failing
 * provider is reported, never thrown, so one bad key cannot hide the rest.
 */
export async function refreshModelListsAction(): Promise<{
  ok: boolean
  results: RefreshOutcome[]
}> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
  const results = await refreshModelCatalogue()
  revalidatePath('/settings')
  return { ok: results.every((r) => r.ok || r.skipped), results }
}
