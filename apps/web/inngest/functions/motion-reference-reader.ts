import {
  getChannelSettings,
  motionReferenceById,
  setReferenceReading,
  setReferenceReadState,
  setReferenceSheets,
} from '@boom-busters/db'
import type { MotionReferenceRow } from '@boom-busters/db'
import {
  buildReferenceReadingRequest,
  mockProvidersEnabled,
  mockReferenceReading,
  parseReferenceReading,
  READING_OUTPUT_TOKENS,
} from '@boom-busters/providers'
import type { ReferenceForReading } from '@boom-busters/providers'
import { BudgetExceededError, parseEventData, serialiseError } from '@boom-busters/schemas'
import { callForAnswer } from '@/lib/answer'
import { completeForChannel } from '@/lib/answer-call'
import { db } from '@/lib/db'
import { imageForModel } from '@/lib/reference-images'
import { renderSheets } from '@/lib/reference-sheets'
import { getObjectBytes, storageConfigured } from '@/lib/storage'
import { inngest } from '../client'
import { events } from '../events'

/**
 * motion-reference-reader (spec 2026-11-04, section 7.3): one reference's
 * window read into a one-page reading. Two steps, so a parked run resumes
 * without paying twice: the sheets, rendered in the app's Chromium and
 * stored beside the frames; then one vision call on the graphics route
 * shown the dense sheet and a few single frames. The row carries the
 * state the card shows (reading, read, failed with its reason). A channel
 * job: there is no project to park, so a budget stop marks the row failed
 * with the budget's own words, as the bible drafter records a unit's error.
 */

const FUNCTION_ID = 'motion-reference-reader'

/** The single frames the reader is shown: four spread across the dense set, a still's one. */
export function framesToShow(dense: MotionReferenceRow['frames']['dense']): number[] {
  const n = dense.length
  if (n === 0) return []
  const picks = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]
  return [...new Set(picks)]
}

function referenceForReading(row: MotionReferenceRow): ReferenceForReading {
  return {
    title: row.title,
    purpose: row.purpose,
    negative: row.negative,
    carryOver: row.carryOver,
    avoid: row.avoid,
    windowMs:
      row.windowStartMs !== null && row.windowEndMs !== null
        ? row.windowEndMs - row.windowStartMs
        : null,
  }
}

export const motionReferenceReader = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Motion reference reader',
    retries: 1,
    // One read per reference at a time; a re-mark or a second Read while
    // one runs cancels the older run, so the later window's reading lands.
    singleton: { key: 'event.data.referenceId', mode: 'cancel' },
    onFailure: async ({ event }) => {
      const referenceId = event.data.event.data['referenceId']
      if (typeof referenceId !== 'string') return
      const message = String(serialiseError(event.data.error)['message'] ?? 'The read failed')
      await setReferenceReadState(db, referenceId, 'failed', message).catch(() => undefined)
    },
    triggers: [events.motionReferenceIngested],
  },
  async ({ event, step }) => {
    const { channelId, referenceId } = parseEventData('motion/reference.ingested', event.data)

    const sheets = await step.run('sheets', async () => {
      const row = await motionReferenceById(db, referenceId)
      if (!row || row.archivedAt !== null) return { gone: true as const }
      if (row.kind === 'image') return { skipped: 'no sheets for a still' }
      if (!storageConfigured()) return { skipped: 'no storage' }
      const result = await renderSheets({ channelId, referenceId, frames: row.frames })
      await setReferenceSheets(db, referenceId, {
        contactSheetKey: result.contactSheetKey,
        denseSheetKey: result.denseSheetKey,
      })
      return result
    })
    if ('gone' in sheets) return { referenceId, outcome: 'gone' as const }

    const outcome = await step.run('read', async () => {
      const row = await motionReferenceById(db, referenceId)
      if (!row || row.archivedAt !== null) return 'gone' as const
      const reference = referenceForReading(row)
      const now = new Date().toISOString()

      if (mockProvidersEnabled()) {
        await setReferenceReading(db, referenceId, {
          ...mockReferenceReading(reference),
          readAt: now,
          model: 'mock/reading',
        })
        return 'read' as const
      }

      try {
        // Every image is held to the model width: a still's one frame is its
        // original, stored up to 8 MB, and the API refuses images over 5 MB.
        const denseSheet = row.denseSheetKey
          ? await imageForModel(await getObjectBytes(row.denseSheetKey))
          : null
        const frames = await Promise.all(
          framesToShow(row.frames.dense).map(async (index) => {
            const frame = row.frames.dense[index]!
            return {
              atMs: frame.atMs,
              image: await imageForModel(await getObjectBytes(frame.r2Key)),
            }
          }),
        )
        const answer = await callForAnswer({
          request: buildReferenceReadingRequest(reference, { denseSheet, frames }),
          parse: (text) => parseReferenceReading(text),
          complete: completeForChannel(channelId, {
            estimateOutputTokens: READING_OUTPUT_TOKENS,
          }),
        })
        if (!answer.ok) {
          await setReferenceReadState(db, referenceId, 'failed', answer.issue)
          return 'failed' as const
        }
        const route = (await getChannelSettings(db, channelId)).modelRouting.graphics
        await setReferenceReading(db, referenceId, {
          ...answer.value,
          readAt: now,
          model: `${route.provider}/${route.model}`,
        })
        return 'read' as const
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          await setReferenceReadState(db, referenceId, 'failed', error.message)
          return 'failed' as const
        }
        throw error
      }
    })

    return { referenceId, outcome }
  },
)
