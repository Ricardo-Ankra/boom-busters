import { R2_PREFIX } from '@/lib/storage'

/**
 * Where a version's frames live (spec 2026-11-04, section 9.2, step 3):
 * under the channel and the version, a folder per round so the pairwise
 * question can show the round before.
 */

export function exemplarFrameKey(input: {
  channelId: string
  versionId: string
  round: number
  orientation: 'landscape' | 'portrait'
  atMs: number
}): string {
  return `${R2_PREFIX}/exemplars/${input.channelId}/${input.versionId}/round-${input.round}/${input.orientation}-${input.atMs}.jpg`
}

export function exemplarSheetKey(input: {
  channelId: string
  versionId: string
  round: number
  orientation: 'landscape' | 'portrait'
}): string {
  return `${R2_PREFIX}/exemplars/${input.channelId}/${input.versionId}/round-${input.round}/${input.orientation}-sheet.jpg`
}
