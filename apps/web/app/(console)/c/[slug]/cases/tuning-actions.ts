'use server'

import {
  applyResearchTuning,
  channelResearchThresholds,
  countedVideosForChannel,
  dismissSuggestion,
  resetResearchTuning,
  suggestionDismissals,
} from '@boom-busters/db'
import { DEFAULT_RESEARCH_THRESHOLDS, UlidSchema } from '@boom-busters/schemas'
import type { ResearchThresholds, Suggestion } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { channelWriteRefusal } from '@/lib/channel-lookup'
import { liveSuggestions } from './track-record-data'

/**
 * Threshold tuning from the Search track record panel. Every action re-checks
 * the session and the channel. Apply and Dismiss recompute the suggestions on
 * the server and act only on one that still stands.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

const GONE = 'That suggestion no longer stands.'

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

function isKey(key: string): key is keyof ResearchThresholds {
  return Object.prototype.hasOwnProperty.call(DEFAULT_RESEARCH_THRESHOLDS, key)
}

/** Null when the channel may be written to, else the refusal to return. */
async function refusalFor(channelId: string): Promise<ActionResult | null> {
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  return channelWriteRefusal(channelId)
}

async function standingSuggestion(
  channelId: string,
  key: string,
  direction: 'raise' | 'lower',
): Promise<Suggestion | null> {
  if (!isKey(key)) return null
  const [videos, current, dismissals] = await Promise.all([
    countedVideosForChannel(db, channelId),
    channelResearchThresholds(db, channelId),
    suggestionDismissals(db, channelId),
  ])
  return (
    liveSuggestions(videos, current, dismissals).find(
      (s) => s.key === key && s.direction === direction,
    ) ?? null
  )
}

export async function applySuggestionAction(
  channelId: string,
  key: string,
  direction: 'raise' | 'lower',
): Promise<ActionResult> {
  await requireOwner()
  const refusal = await refusalFor(channelId)
  if (refusal) return refusal
  const suggestion = await standingSuggestion(channelId, key, direction)
  if (!suggestion) return { ok: false, error: GONE }
  try {
    await applyResearchTuning(db, {
      channelId,
      key: suggestion.key,
      value: suggestion.to,
      evidence: suggestion.sentence,
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not apply that' }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

export async function dismissSuggestionAction(
  channelId: string,
  key: string,
  direction: 'raise' | 'lower',
): Promise<ActionResult> {
  await requireOwner()
  const refusal = await refusalFor(channelId)
  if (refusal) return refusal
  const suggestion = await standingSuggestion(channelId, key, direction)
  if (!suggestion) return { ok: false, error: GONE }
  await dismissSuggestion(db, {
    channelId,
    key: suggestion.key,
    direction: suggestion.direction,
    support: suggestion.support.length,
  })
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

export async function resetTuningAction(channelId: string, key: string): Promise<ActionResult> {
  await requireOwner()
  const refusal = await refusalFor(channelId)
  if (refusal) return refusal
  if (!isKey(key)) return { ok: false, error: 'Unknown threshold' }
  await resetResearchTuning(db, channelId, key)
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}
