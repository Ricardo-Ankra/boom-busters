'use server'

import { addFormatKeyword, channelForProject, getProject } from '@boom-busters/db'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'

/**
 * The search report card's buttons (the publish screen). A 'use server'
 * module may only export async functions, so the result type is local.
 */

export interface SearchReportActionResult {
  ok: boolean
  /** The confirmation line on success, or the reason on failure. */
  message?: string
  error?: string
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

/**
 * Add a YouTube search term to the keywords of the project's format, as the
 * channel bible's next version. The term is trimmed and cut to the bible's 60
 * characters; a format that is gone falls back to the primary.
 */
export async function addTermToKeywordsAction(
  projectId: string,
  term: string,
): Promise<SearchReportActionResult> {
  await requireOwner()
  const cleaned = term.trim().slice(0, 60).trim()
  if (cleaned === '') return { ok: false, error: 'There is no term to add' }

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }
  const { channelId } = await channelForProject(db, projectId)
  const result = await addFormatKeyword(db, channelId, project.formatKey, cleaned)

  if (result.outcome === 'full') {
    return {
      ok: false,
      error: 'This format has 6 keywords already. Remove one in Settings first.',
    }
  }
  if (result.outcome === 'already') return { ok: true, message: 'Already a keyword.' }

  revalidatePath(`/projects/${projectId}`)
  return {
    ok: true,
    message: result.fellBack
      ? `That format no longer exists, so it went to the ${result.formatName} keywords.`
      : `Added to the ${result.formatName} keywords.`,
  }
}
