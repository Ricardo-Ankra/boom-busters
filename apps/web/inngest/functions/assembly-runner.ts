import {
  getAsset,
  getProject,
  getSettings,
  insertTimeline,
  latestScriptParagraphSources,
  listMusicBeds,
  listShotSlots,
  listVoiceTakes,
  setProjectStage,
  setTimelineKey,
} from '@boom-busters/db'
import type { AssetRow } from '@boom-busters/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import {
  newId,
  parseEventData,
  resolveBrandKit,
  serialiseError,
  timelineDurationMs,
  TranscribeResultSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { WordTiming } from '@boom-busters/schemas'
import { compileTimeline } from '@boom-busters/timeline'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { brokerCallbackUrl, brokerConfigured, submitMediaJob } from '@/lib/broker'
import { ingestSlotStock, needsStockIngest } from '@/lib/stock-ingest'
import { storageConfigured, putObject } from '@/lib/storage'
import { inngest } from '../client'
import { events } from '../events'
import { closeReviewGate, markStageFailed, openReviewGate, type GateContext } from '../lib/gates'
import {
  assembleCaptions,
  evenlySpacedWords,
  narrationPlan,
  pickMusicBed,
  slotPlan,
  timelineKey,
} from '../lib/assembly'

/**
 * assembly-runner (build spec section 7.5).
 *
 * `gate/visuals.approved` → alignment (stored ElevenLabs timings when a
 * take has them — free; media-utils Whisper otherwise; evenly-spaced mock
 * timings in mock-provider mode) → snap to script → compile → validate →
 * timeline stored by key → Gate 5a.
 *
 * Gate 5a ALWAYS parks: whether the cut works is a judgment made in the
 * preview player, and the render button (M6.8) is the real spend decision.
 * Approving the preview triggers the render-runner; this function's wait
 * closes the gate so the pipeline's bookkeeping matches.
 */

const FUNCTION_ID = 'assembly-runner'

/** How long one chapter's whisper transcription may take, generously. */
const TRANSCRIBE_TIMEOUT = '30m'

export const assemblyRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Assembly',
    retries: 4,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await markStageFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        serialiseError(event.data.error),
      )
    },
    triggers: [events.visualsApproved],
  },
  async ({ event, step, runId }) => {
    const { projectId } = parseEventData('gate/visuals.approved', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    // -----------------------------------------------------------------------
    // Load everything the compiler needs
    // -----------------------------------------------------------------------

    const setup = await step.run('load-assembly', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      await setProjectStage(db, projectId, { stage: 'assembly', stageStatus: 'running' })

      const sources = await latestScriptParagraphSources(db, projectId)
      const takes = await listVoiceTakes(db, projectId)
      const plan = narrationPlan({ chapters: sources.chapters, takes })

      const slots = await listShotSlots(db, projectId)
      const assetIds = [
        ...new Set(slots.map((slot) => slot.chosenAssetId).filter((id): id is string => !!id)),
      ]
      const assets: [string, AssetRow][] = []
      for (const id of assetIds) {
        const asset = await getAsset(db, id)
        if (asset) assets.push([id, asset])
      }

      const settings = await getSettings(db)
      const beds = await listMusicBeds(db)

      return {
        plan,
        slots,
        assets,
        brand: resolveBrandKit(settings),
        music: pickMusicBed(beds),
      }
    })

    if (setup.plan.missing.length > 0) {
      const first = setup.plan.missing[0]!
      await step.run('missing-narration', () =>
        markStageFailed(ctx, {
          message:
            `${setup.plan.missing.length} paragraph(s) have no usable take — first: ` +
            `"${first.chapterTitle}" paragraph ${first.paragraphIndex + 1}. Re-run the voice ` +
            'stage before assembling.',
        }),
      )
      return { projectId, outcome: 'failed' as const }
    }

    // -----------------------------------------------------------------------
    // Stock ingestion: chosen candidates become our bytes, never hotlinks
    // -----------------------------------------------------------------------

    const mocked = mockProvidersEnabled()

    // Provider download URLs expire (Pixabay's within a day), so the
    // timeline may only ever reference bytes in R2 (spec section 8.2). One
    // step per slot: each download is retried and checkpointed on its own,
    // and a failure skips that slot instead of hotlinking a dying URL.
    const ingested: Record<string, { r2Key: string; assetId?: string; previewR2Key?: string }> = {}
    const unusable: Record<string, string> = {}
    if (!mocked && storageConfigured()) {
      for (const slot of setup.slots.filter(needsStockIngest)) {
        const outcome = await step.run(`ingest-stock-${slot.id}`, () => ingestSlotStock(slot))
        if (outcome.ok) {
          ingested[slot.id] = {
            r2Key: outcome.r2Key,
            ...(outcome.assetId !== undefined ? { assetId: outcome.assetId } : {}),
            ...(outcome.previewR2Key !== undefined ? { previewR2Key: outcome.previewR2Key } : {}),
          }
        } else unusable[slot.id] = outcome.reason
      }
    }

    // The board rows were loaded before ingestion wrote keys back; patch
    // the in-memory copies so the compiler sees what the DB now holds.
    const slotsWithBytes = setup.slots.map((slot) => {
      const hit = ingested[slot.id]
      if (!hit) return slot
      return {
        ...slot,
        chosenAssetId: hit.assetId ?? slot.chosenAssetId,
        candidates: slot.candidates.map((candidate) =>
          candidate['chosen'] === true
            ? {
                ...candidate,
                r2Key: hit.r2Key,
                ...(hit.assetId !== undefined ? { assetId: hit.assetId } : {}),
                ...(hit.previewR2Key !== undefined ? { previewR2Key: hit.previewR2Key } : {}),
              }
            : candidate,
        ),
      }
    })

    // -----------------------------------------------------------------------
    // Alignment: stored timings are free; whisper covers the rest
    // -----------------------------------------------------------------------
    const aligned: ((typeof setup.plan.paragraphs)[number] & { words: WordTiming[] })[] = []

    for (const paragraph of setup.plan.paragraphs) {
      if (paragraph.timings && paragraph.timings.length > 0) {
        aligned.push({ ...paragraph, words: paragraph.timings })
        continue
      }

      if (mocked) {
        // Mock-provider mode: deterministic evenly-spaced words, so CI
        // exercises the same snap/offset path live audio does.
        const words = await step.run(
          `mock-align-${paragraph.chapterId}-${paragraph.paragraphIndex}`,
          () => evenlySpacedWords(paragraph.text, paragraph.durationMs),
        )
        aligned.push({ ...paragraph, words })
        continue
      }

      // Live: one whisper job per take, matched back by jobId.
      const jobId = await step.run(
        `transcribe-submit-${paragraph.chapterId}-${paragraph.paragraphIndex}`,
        async () => {
          const id = newId<'run'>()
          await submitMediaJob({
            kind: 'transcribe',
            jobId: id,
            projectId,
            callbackUrl: brokerCallbackUrl(),
            audioS3Key: paragraph.r2Key,
          })
          return id
        },
      )

      const completion = await step.waitForEvent(
        `transcribe-wait-${paragraph.chapterId}-${paragraph.paragraphIndex}`,
        {
          event: 'media/job.completed',
          timeout: TRANSCRIBE_TIMEOUT,
          if: `async.data.jobId == "${jobId}"`,
        },
      )

      if (!completion || completion.data.ok !== true) {
        await step.run(`transcribe-failed-${paragraph.chapterId}-${paragraph.paragraphIndex}`, () =>
          markStageFailed(ctx, {
            message:
              `Whisper transcription ${completion ? 'failed' : 'timed out'} for ` +
              `"${paragraph.chapterTitle}" paragraph ${paragraph.paragraphIndex + 1}` +
              (completion?.data.error ? `: ${completion.data.error}` : '.'),
          }),
        )
        return { projectId, outcome: 'failed' as const }
      }

      const words = TranscribeResultSchema.parse(completion.data.result).words.map((word) => ({
        text: word.text,
        startMs: word.startMs,
        endMs: word.endMs,
      }))
      aligned.push({ ...paragraph, words })
    }

    // -----------------------------------------------------------------------
    // Snap, compile, validate, store
    // -----------------------------------------------------------------------

    const compiled = await step.run('compile-timeline', async () => {
      const captions = assembleCaptions(aligned)
      const plan = slotPlan({
        slots: slotsWithBytes,
        assetsById: new Map(setup.assets),
        unusable,
      })

      try {
        const timeline = compileTimeline({
          brand: setup.brand,
          paragraphs: setup.plan.paragraphs,
          slots: plan.slots,
          music: setup.music,
          captions: { words: captions.words, style: 'karaoke' },
        })
        return {
          ok: true as const,
          timeline,
          gaps: captions.gaps.length,
          skipped: plan.skipped,
          slots: plan.slots.length,
        }
      } catch (error) {
        if (error instanceof ValidationError) {
          return { ok: false as const, message: error.message }
        }
        throw error
      }
    })

    if (!compiled.ok) {
      await step.run('compile-failed', () =>
        markStageFailed(ctx, {
          message: `The timeline would not compile: ${compiled.message}`,
        }),
      )
      return { projectId, outcome: 'failed' as const }
    }

    const stored = await step.run('store-timeline', async () => {
      const row = await insertTimeline(db, {
        projectId,
        json: compiled.timeline,
        // The key is versioned; write the row first to learn the version
        // would be circular, so compute it the same way insertTimeline does
        // — from the row we get back.
        s3Key: '',
      })
      const key = timelineKey(projectId, row.version)
      if (storageConfigured()) {
        await putObject(key, Buffer.from(JSON.stringify(compiled.timeline)), 'application/json')
      }
      await setTimelineKey(db, row.id, key)
      return { version: row.version, key }
    })

    // -----------------------------------------------------------------------
    // The draft: assembly's output is a watchable file, not only a timeline
    // -----------------------------------------------------------------------

    // Requested, not awaited: the draft-runner renders a half-resolution
    // copy (~a quarter of the master's price) while Gate 5a parks below,
    // and the preview screen shows its progress beside the live player.
    // Live-only — in mock mode the player is free and CI must not render.
    const draftRequested = !mocked && brokerConfigured() && storageConfigured()
    if (draftRequested) {
      await step.sendEvent('request-draft-render', [
        events.renderDraftRequested.create({ projectId }),
      ])
    }

    // -----------------------------------------------------------------------
    // Gate 5a — always parks; the preview player is the judgment seat
    // -----------------------------------------------------------------------

    const runtimeSec = Math.round(timelineDurationMs(compiled.timeline) / 1000)
    await step.run('open-gate', () =>
      openReviewGate(ctx, {
        stage: 'preview',
        projectStage: 'assembly',
        summary:
          `Preview ready · v${stored.version} · ${Math.floor(runtimeSec / 60)}m${String(
            runtimeSec % 60,
          ).padStart(2, '0')}s · ${compiled.slots} slots` +
          (compiled.skipped.length > 0 ? ` · ${compiled.skipped.length} skipped` : '') +
          (compiled.gaps > 0 ? ` · ${compiled.gaps} caption QC gap(s)` : '') +
          (draftRequested ? ' · draft rendering' : ''),
      }),
    )

    const approval = await step.waitForEvent('await-preview-gate', {
      event: 'gate/preview.approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!approval) {
      await step.run('gate-timed-out', () =>
        markStageFailed(ctx, { message: 'The preview gate went 30 days without a decision.' }),
      )
      return { projectId, outcome: 'gate-timeout' as const }
    }

    await step.run('close-gate', () =>
      closeReviewGate(ctx, { stage: 'preview', nextStage: 'assembly' }),
    )

    return {
      projectId,
      outcome: 'approved' as const,
      timelineVersion: stored.version,
      runtimeSec,
    }
  },
)
