import {
  getLatestScript,
  getProject,
  insertShort,
  latestShortsCandidates,
  latestScriptParagraphSources,
  latestTimeline,
  listShorts,
  setProjectStage,
  setShortsCandidates,
} from '@boom-busters/db'
import {
  buildShortsRequest,
  mockProvidersEnabled,
  mockShortsCandidates,
  parseShortsCandidates,
  tensionFromOutline,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  OutlineSchema,
  parseEventData,
  resolveCandidateSegment,
  serialiseError,
  stripNarrationMarkup,
  TimelineSchema,
  ValidationError,
} from '@boom-busters/schemas'
import { compileShortTimeline } from '@boom-busters/timeline'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markStageFailed, type GateContext } from '../lib/gates'

/**
 * shorts-runner (build spec section 7.2 item 7): `project/master.ready` →
 * resolve each Shorts candidate to a paragraph range → a `shorts` row per
 * resolvable candidate → fan the renders out as one event per Short. The
 * candidates were approved with the script (they were on show in the Script
 * Studio when the gate was clicked); the CARDS are where the human curates
 * what actually gets scheduled.
 *
 * The renders happen in the short-render-runner, one Short per run,
 * concurrency-capped — not here. A parent that waited on N completion
 * events in sequence would miss any that fired before its wait started;
 * per-Short runs make each wait start before its own submit returns.
 *
 * Re-entry (the master re-rendered, `master.ready` fired again): existing
 * rows are kept exactly as the human edited them — titles, endings and
 * related-link ticks survive — and no new rows are made. Re-rendering a
 * Short against the new master is the card's explicit button.
 */

const FUNCTION_ID = 'shorts-runner'

/** A seeded title: the hook sentence, cut to fit a title field. */
export function seedTitle(startSentence: string): string {
  const words = stripNarrationMarkup(startSentence)
  return words.length <= 80 ? words : `${words.slice(0, 79).trimEnd()}…`
}

export const shortsRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Shorts',
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
    triggers: [events.projectMasterReady],
  },
  async ({ event, step, runId }) => {
    const { projectId } = parseEventData('project/master.ready', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    /**
     * A script can arrive here with no candidates: the script-runner's
     * marking step deliberately swallows its own failures (the narration is
     * the script stage's deliverable, not the Shorts), and production did
     * exactly that on 2026-09-03 — the marking response failed to parse, an
     * empty list was stored, and this stage later sat "awaiting review" over
     * nothing. Marking here makes the stage self-healing: a re-run recovers
     * on its own, and a marking failure fails THIS stage loudly — picking
     * segments IS this stage's work.
     */
    const marking = await step.run('mark-missing-candidates', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      await setProjectStage(db, projectId, { stage: 'shorts', stageStatus: 'running' })

      if ((await listShorts(db, projectId)).length > 0) return { ok: true as const, marked: 0 }
      if ((await latestShortsCandidates(db, projectId)).length > 0) {
        return { ok: true as const, marked: 0 }
      }

      const latest = await getLatestScript(db, projectId)
      if (!latest) {
        throw new NonRetriableError('There is no script to pick Shorts segments from.')
      }
      const chapterSources = latest.chapters.map((chapter) => ({
        index: chapter.index,
        title: chapter.title,
        contentMd: chapter.contentMd,
      }))

      // The stored outline carries the tension fields the marking selects
      // by; a pre-decision-224 script has none, and the prompt degrades to
      // text-only. safeParse, not parse: a malformed stored outline must
      // cost the tension hints, never the marking.
      const parsedOutline = OutlineSchema.safeParse(latest.script.outline)
      const tension = parsedOutline.success ? tensionFromOutline(parsedOutline.data) : undefined

      let picked
      if (mockProvidersEnabled()) {
        picked = mockShortsCandidates(chapterSources)
      } else {
        try {
          picked = parseShortsCandidates(
            (
              await callLlm(
                buildShortsRequest({
                  chapters: chapterSources,
                  ...(tension ? { tension } : {}),
                }),
                { projectId },
              )
            ).text,
          )
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          // Retries, then onFailure -> markStageFailed. Never a silent [].
          throw error
        }
      }
      await setShortsCandidates(db, latest.script.id, picked)
      return { ok: true as const, marked: picked.length }
    })

    if (!marking.ok) {
      await step.run('marking-over-budget', () => markStageFailed(ctx, marking.gate))
      return { projectId, outcome: 'over-budget' as const }
    }

    const outcome = await step.run('resolve-candidates', async () => {
      // Re-entry guard: rows exist, the human may have curated them. Keep.
      const existing = await listShorts(db, projectId)
      if (existing.length > 0) {
        return { created: [] as string[], skipped: [] as string[], reused: existing.length }
      }

      const candidates = await latestShortsCandidates(db, projectId)
      if (candidates.length === 0) {
        return { created: [] as string[], skipped: [] as string[], reused: 0 }
      }

      const { chapters } = await latestScriptParagraphSources(db, projectId)
      const timelineRow = await latestTimeline(db, projectId)
      if (!timelineRow) {
        throw new NonRetriableError('master.ready fired but there is no compiled timeline')
      }
      const master = TimelineSchema.parse(timelineRow.json)

      const created: string[] = []
      const skipped: string[] = []
      for (const candidate of candidates) {
        const segmentRef = resolveCandidateSegment(candidate, chapters)
        if (!segmentRef) {
          skipped.push(`"${seedTitle(candidate.startSentence)}": anchors not found in the script`)
          continue
        }

        // Compile as validation only — the Short's real compile happens at
        // render time against its then-current ending and bed. This catches
        // the 180 s ceiling and broken segments before a row exists.
        try {
          compileShortTimeline({ master, segmentRef, ending: 'cta', music: null })
        } catch (error) {
          if (error instanceof ValidationError) {
            skipped.push(`"${seedTitle(candidate.startSentence)}": ${error.message}`)
            continue
          }
          throw error
        }

        const short = await insertShort(db, {
          projectId,
          title: seedTitle(candidate.startSentence),
          segmentRef,
        })
        created.push(short.id)
      }

      return { created, skipped, reused: 0 }
    })

    if (outcome.created.length > 0) {
      await step.sendEvent(
        'request-short-renders',
        outcome.created.map((shortId) =>
          events.shortsRenderRequested.create({ projectId, shortId }),
        ),
      )
    }

    /**
     * A review over nothing is a dead end, not a gate: zero rows and
     * `awaiting_review` gives the human a screen that says "no shorts yet"
     * and no button that changes it. Fail the stage with the reasons instead
     * — Re-run stage is the recovery, and the marking step above makes that
     * re-run able to succeed.
     */
    if (outcome.reused === 0 && outcome.created.length === 0) {
      await step.run('nothing-to-review', () =>
        markStageFailed(ctx, {
          message:
            outcome.skipped.length > 0
              ? `No Shorts could be cut — every segment was skipped: ${outcome.skipped.join(' · ')}`
              : 'The model picked no usable Shorts segments. Re-run the Shorts stage to try again.',
        }),
      )
      return {
        projectId,
        outcome: 'no-candidates' as const,
        created: 0,
        reused: 0,
        skipped: outcome.skipped,
      }
    }

    // The screen is where the human curates; the stage says so. Skipped
    // candidates are in the run result — the activity drawer shows it.
    await step.run('shorts-ready', () =>
      setProjectStage(db, projectId, { stage: 'shorts', stageStatus: 'awaiting_review' }),
    )

    return {
      projectId,
      // The empty outcome returned above, so one of these two is true here.
      outcome: outcome.reused > 0 ? ('reused-existing' as const) : ('shorts-created' as const),
      created: outcome.created.length,
      reused: outcome.reused,
      skipped: outcome.skipped,
    }
  },
)
