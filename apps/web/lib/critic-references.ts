import { listMotionReferences } from '@boom-busters/db'
import type { CriticReference } from '@boom-busters/providers'
import { db } from '@/lib/db'
import { imageForModel } from '@/lib/reference-images'
import { getObjectBytes, storageConfigured } from '@/lib/storage'

/**
 * What the critic is shown of the channel (spec 2026-11-04, sections 10.4
 * and 12.2): the first two live references tagged look, in the pack's
 * order, a clip by its dense sheet and a still by its original, each held to
 * the model width. A clip not yet read has no sheet and is passed over.
 * Plan 4 adds the references a channel's exemplar named for the technique.
 * Never throws: a reference that cannot be read is skipped with a warning,
 * so a missing object never stops a review.
 */

export const CRITIC_REFERENCES_MAX = 2

export async function criticReferencesFor(channelId: string): Promise<CriticReference[]> {
  if (!storageConfigured()) return []
  const rows = await listMotionReferences(db, channelId)
  const references: CriticReference[] = []
  for (const row of rows) {
    if (references.length >= CRITIC_REFERENCES_MAX) break
    if (row.purpose !== 'look') continue
    const key = row.kind === 'image' ? row.frames.dense[0]?.r2Key : row.denseSheetKey
    if (!key) continue
    try {
      references.push({
        title: row.title,
        purpose: row.purpose,
        carryOver: row.carryOver,
        image: await imageForModel(await getObjectBytes(key)),
      })
    } catch (error) {
      console.warn(
        `[graphics] the critic's reference "${row.title}" could not be read: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return references
}
