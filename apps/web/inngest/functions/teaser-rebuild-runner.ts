import { getShort, updateShort } from '@boom-busters/db'
import { parseEventData, teaserTextHash, TeaserScriptRecordSchema } from '@boom-busters/schemas'
import type { TeaserScriptRecord, TeaserVoiceRecord } from '@boom-busters/schemas'
import type { TeaserParagraphAudio } from '@boom-busters/timeline'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { inngest } from '../client'
import { events } from '../events'
import { voiceTeaserBeat, writeTeaserScript } from '../lib/teaser-build'

/**
 * teaser-rebuild-runner (decisions 227, 230): the teaser studio's "Voice the
 * script" button. Re-voices the stored (possibly edited) script — the
 * idempotency keys hash the text, so unchanged beats are re-served by the
 * vendor, not re-billed — and stores the voiced beats on the row. It stops
 * there on purpose: the cut is a separate act (`assembleTeaser`, a free
 * synchronous compile), so the human can hear the narration and pick shots
 * before anything is assembled.
 *
 * This is not a stage runner: the project may be sitting at shorts or at
 * publish while a teaser is reworked, so failures never touch the stage.
 * They notify and land in the run mirror, where the activity drawer shows
 * them.
 *
 * A teaser built before the studio existed has no stored script; the first
 * voicing regenerates one from the outline and stores it. The row's curated
 * title is never overwritten.
 */

const FUNCTION_ID = 'teaser-rebuild-runner'

export const teaserRebuildRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Teaser voice',
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
          title: 'The teaser voicing stopped',
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
      await fail('script-skipped', `Voicing stopped before it began: ${script.skipped}`)
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
        await fail('tts-skipped', `Voicing stopped mid-way: ${spoken.skipped}`)
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

    // Voice is stored, NOT cut (decision 230): the studio's acts are
    // separate so the human can hear the narration and pick shots before
    // the assemble. The compile itself is free and synchronous — it lives
    // in the `assembleTeaser` server action, not here.
    await step.run('store-voice', async () => {
      const record: TeaserVoiceRecord = {
        scriptVersion: script.record.scriptVersion,
        beats: voiced.map((beat) => ({
          textHash: teaserTextHash(beat.text),
          r2Key: beat.r2Key,
          durationMs: beat.durationMs,
          wordTimings: beat.wordTimings,
        })),
      }
      await updateShort(db, shortId, {
        teaserVoice: record as unknown as Record<string, unknown>,
      })
      await notify({
        kind: 'gate-auto',
        title: 'The teaser is voiced',
        body:
          `${voiced.length} beats are ready to hear in the teaser studio. ` +
          'Pick the shots, then Assemble & render.',
        href: `/projects/${projectId}?stage=shorts`,
      })
    })

    return { projectId, shortId, outcome: 'voiced' as const, beats: voiced.length }
  },
)
