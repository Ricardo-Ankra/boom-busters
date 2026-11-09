'use server'

import {
  addFormatKeyword,
  addRankCheck,
  channelForProject,
  currentBible,
  dismissSearchTerm,
  getProject,
  getPublishRecord,
} from '@boom-busters/db'
import { normaliseTerm } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { CapReached, rankFor } from '@/lib/case-evidence'
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

/** The rank check's result: where the video stands for the target keyword. */
export interface RankCheckResult extends SearchReportActionResult {
  /** 1-based place in the top 10, or null when it is not there. */
  position?: number | null
  keyword?: string
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

/**
 * One VidIQ search for the rank of the master for its researched target. The
 * target comes from the brief the project froze; the result is kept as a
 * manual check, so the card lists it and the day 28 report can reuse it.
 */
export async function checkRankAction(projectId: string): Promise<RankCheckResult> {
  await requireOwner()
  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }
  const target = project.searchBrief?.targetKeyword?.keyword.trim() ?? ''
  if (target === '') return { ok: false, error: 'This video has no researched target to check.' }
  const record = await getPublishRecord(db, 'master', projectId)
  const videoId = record?.youtubeVideoId
  if (!videoId) return { ok: false, error: 'This video is not on YouTube yet, so it has no rank.' }

  const { channelId } = await channelForProject(db, projectId)
  let position: number | null
  try {
    position = await rankFor(target, videoId, channelId)
  } catch (error) {
    if (error instanceof CapReached) {
      return { ok: false, error: 'The monthly VidIQ credit cap is reached.' }
    }
    return {
      ok: false,
      error: `The rank check failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  // The credits are spent: a failure to record is reported, not retried.
  try {
    await addRankCheck(db, { channelId, videoId, keyword: target, position })
  } catch (error) {
    return {
      ok: false,
      error: `The rank was checked but not saved: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  revalidatePath(`/projects/${projectId}`)
  return { ok: true, position, keyword: target }
}

/**
 * Marks a search term as not for this channel. The key is the term's words
 * normalised in the language the video was researched in, so "the Enron
 * collapse" and "collapse enron 2001" are one dismissal.
 */
export async function dismissTermAction(
  projectId: string,
  term: string,
): Promise<SearchReportActionResult> {
  await requireOwner()
  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }
  const { channelId } = await channelForProject(db, projectId)
  const language =
    project.searchBrief?.language ||
    (await currentBible(db, channelId).then(
      (current) => current.bible.language || undefined,
      () => undefined,
    ))
  const key = normaliseTerm(term, language).join(' ')
  if (key === '') return { ok: false, error: 'There is no term to dismiss' }
  await dismissSearchTerm(db, channelId, key)
  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}
