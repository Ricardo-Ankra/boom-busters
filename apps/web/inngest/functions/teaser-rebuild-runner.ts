import { getShort, latestTimeline, updateShort } from '@boom-busters/db'
import {
  parseEventData,
  TeaserScriptRecordSchema,
  TimelineSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { TeaserScriptRecord } from '@boom-busters/schemas'
import { compileTeaserMaster, TEASER_CHAPTER_ID } from '@boom-busters/timeline'
import type { TeaserParagraphAudio } from '@boom-busters/timeline'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { inngest } from '../client'
import { events } from '../events'
import { voiceTeaserBeat, writeTeaserScript } from '../lib/teaser-build'

/**
 * teaser-rebuild-runner (decision 227): the teaser studio's "Re-voice &
 * recut" button. Re-voices the stored (possibly edited) script — the
 * idempotency keys hash the text, so unchanged beats are re-served by the
 * vendor, not re-billed — recuts over the CURRENT master board, updates the
 * row in place and queues a fresh render.
 *
 * This is not a stage runner: the project may be sitting at shorts or at
 * publish while a teaser is reworked, so failures never touch the stage.
 * They notify and land in the run mirror, where the activity drawer shows
 * them.
 *
 * A teaser built before the studio existed has no stored script; the first
 * rebuild regenerates one from the outline and stores it. The row's curated
 * title is never overwritten — only the script, the cut and the render
 * pointer change.
 */

const FUNCTION_ID = 'teaser-rebuild-runner'

export const teaserRebuildRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Teaser rebuild',
    retries: 2,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    triggers: [events.teaserRebuildRequested],
  },
  async ({ event, step }) => {
    const { projectId, shortId } = parseEventData('teaser/rebuild.requested', event.data)

    const fail = async (stepName: string, body: string) => {
      await step.run(stepName, () =>
        notify({
          kind: 'run-failed',
          title: 'The teaser rebuild stopped',
          body,
          href: `/projects/${projectId}?stage=shorts`,
        }),
      )
    }

    const script = await step.run(
      'load-script',
      async (): Promise<
        | { ok: true; record: TeaserScriptRecord }
        | { ok: false; gate: Record<string, unknown> }
        | { ok: false; skipped: string }
      > => {
        const short = await getShort(db, shortId)
        if (!short) throw new NonRetriableError(`Short ${shortId} no longer exists`)
        if (short.kind !== 'teaser') {
          throw new NonRetriableError('Only a teaser can be rebuilt — excerpts re-render instead.')
        }

        const stored = TeaserScriptRecordSchema.safeParse(short.teaserScript)
        if (stored.success) return { ok: true, record: stored.data }

        // Pre-studio teaser: regenerate the script and store it so the next
        // open of the studio has something to edit.
        const written = await writeTeaserScript(projectId)
        if (!written.ok) return written
        const record: TeaserScriptRecord = {
          title: written.title,
          paragraphs: written.paragraphs,
          scriptVersion: written.scriptVersion,
        }
        await updateShort(db, shortId, {
          teaserScript: record as unknown as Record<string, unknown>,
        })
        return { ok: true, record }
      },
    )

    if (!script.ok && 'gate' in script) {
      await fail(
        'script-over-budget',
        `The teaser script hit the budget ceiling: ${String(script.gate['message'] ?? 'over budget')}`,
      )
      return { projectId, shortId, outcome: 'over-budget' as const }
    }
    if (!script.ok) {
      await fail('script-skipped', `Rebuilding stopped before voicing: ${script.skipped}`)
      return { projectId, shortId, outcome: 'skipped' as const, reason: script.skipped }
    }

    const voiced: TeaserParagraphAudio[] = []
    for (const [index, paragraph] of script.record.paragraphs.entries()) {
      const spoken = await step.run(`teaser-tts-${index}`, () =>
        voiceTeaserBeat({
          projectId,
          scriptVersion: script.record.scriptVersion,
          index,
          paragraph,
        }),
      )
      if (!spoken.ok && 'gate' in spoken) {
        await fail(
          'tts-over-budget',
          `Voicing beat ${index + 1} hit the budget ceiling: ${String(spoken.gate['message'] ?? 'over budget')}`,
        )
        return { projectId, shortId, outcome: 'over-budget' as const }
      }
      if (!spoken.ok) {
        await fail('tts-skipped', `Rebuilding stopped mid-voice: ${spoken.skipped}`)
        return { projectId, shortId, outcome: 'skipped' as const, reason: spoken.skipped }
      }
      voiced.push({
        text: paragraph.text,
        chapterIndex: paragraph.chapterIndex,
        r2Key: spoken.r2Key,
        durationMs: spoken.durationMs,
        wordTimings: spoken.wordTimings,
      })
    }

    const recut = await step.run(
      'recut',
      async (): Promise<{ ok: true } | { ok: false; skipped: string }> => {
        const timelineRow = await latestTimeline(db, projectId)
        if (!timelineRow) {
          return { ok: false, skipped: 'there is no master timeline to lift visuals from' }
        }
        try {
          const teaserTimeline = compileTeaserMaster({
            master: TimelineSchema.parse(timelineRow.json),
            paragraphs: voiced,
          })
          await updateShort(db, shortId, {
            sourceTimeline: teaserTimeline as unknown as Record<string, unknown>,
            segmentRef: {
              chapterId: TEASER_CHAPTER_ID,
              fromParagraph: 0,
              toParagraph: voiced.length - 1,
            },
            // The old render is a render of the old teaser.
            renderId: null,
          })
          return { ok: true }
        } catch (error) {
          if (error instanceof ValidationError) {
            return { ok: false, skipped: `the teaser could not be recut: ${error.message}` }
          }
          throw error
        }
      },
    )
    if (!recut.ok) {
      await fail('recut-skipped', `The voice is bought and kept, but ${recut.skipped}`)
      return { projectId, shortId, outcome: 'skipped' as const, reason: recut.skipped }
    }

    await step.sendEvent('request-render', [
      events.shortsRenderRequested.create({ projectId, shortId }),
    ])

    return { projectId, shortId, outcome: 'rebuilt' as const, beats: voiced.length }
  },
)
