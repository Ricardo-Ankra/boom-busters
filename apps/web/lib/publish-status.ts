import type { BadgeTone } from '@/components/ui/badge'

/**
 * How a publish record's status reads, once, for the calendar and the Publish
 * screen (decision 250). Two identical six-entry maps had been kept by hand
 * in two files; the day one gained a status the other would not have.
 */
export type PublishStatus = 'draft' | 'uploading' | 'uploaded' | 'scheduled' | 'live' | 'failed'

export const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  draft: 'Draft',
  uploading: 'Uploading',
  uploaded: 'Uploaded — finishing',
  scheduled: 'Scheduled',
  live: 'Live',
  failed: 'Failed',
}

export const PUBLISH_STATUS_TONES: Record<PublishStatus, BadgeTone> = {
  draft: 'neutral',
  uploading: 'warning',
  uploaded: 'warning',
  scheduled: 'success',
  live: 'success',
  failed: 'danger',
}

/** The two statuses still in motion, which carry a spinner beside the word. */
export function publishStatusInFlight(status: PublishStatus): boolean {
  return status === 'uploading' || status === 'uploaded'
}
