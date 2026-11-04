import { R2_PREFIX } from '@/lib/storage'

/**
 * Where a channel's motion references live (spec 2026-11-04, section 7.2):
 * the original under the channel and its content hash, the frames the
 * browser took under the hash by set and time, the two sheets beside them.
 * Every key is computed here from the fingerprint, never taken from the
 * caller, so a finalise verifies exactly the objects it issued URLs for.
 * Pure, so the reader and the actions share it and a `'use server'` module
 * exports no constant.
 */

export function referenceKey(input: { channelId: string; contentHash: string; ext: string }) {
  return `${R2_PREFIX}/references/${input.channelId}/${input.contentHash}.${input.ext}`
}

export function referenceFrameKey(input: {
  channelId: string
  contentHash: string
  set: 'dense' | 'overview'
  atMs: number
}) {
  return `${R2_PREFIX}/references/${input.channelId}/${input.contentHash}/${input.set}/${input.atMs}.jpg`
}

/**
 * The sheets are keyed by the reference, not the bytes: two references cut
 * from one clip have two windows and two sheets (final review, issue 2).
 */
export function referenceSheetKey(input: {
  channelId: string
  referenceId: string
  sheet: 'dense' | 'contact'
}) {
  return `${R2_PREFIX}/references/${input.channelId}/sheets/${input.referenceId}/${input.sheet}-sheet.jpg`
}
