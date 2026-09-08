import {
  getLatestScript,
  getProject,
  insertShort,
  latestShortsCandidates,
  latestScriptParagraphSources,
  latestTimeline,
  listShorts,
  MOCK_KEY_PREFIX,
  setProjectStage,
  setShortsCandidates,
} from '@boom-busters/db'
import {
  buildShortsRequest,
  buildTeaserRequest,
  mockProvidersEnabled,
  mockShortsCandidates,
  mockTeaser,
  parseShortsCandidates,
  parseTeaser,
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
import {
  compileShortTimeline,
  compileTeaserMaster,
  TEASER_CHAPTER_ID,
} from '@boom-busters/timeline'
import type { TeaserParagraphAudio } from '@boom-busters/timeline'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { putObject, takeStorage } from '@/lib/storage'
import { synthesise } from '@/lib/tts'
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
 * related-link ticks survive — and no new excerpt rows are made.
 * Re-rendering a Short against the new master is the card's explicit
 * button. The one additive exception is the teaser (decision 225): a
 * project with no teaser row gets one built, whatever else exists.
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

    // -------------------------------------------------------------------------
    // The teaser (decision 225): its own narration, the board's visuals
    // -------------------------------------------------------------------------

    /**
     * An excerpt slices what was said; the teaser says something new. Its
     * 25-40s narration is written for the funnel (cold open, escalation,
     * cliffhanger), synthesised fresh, and cut over slots lifted from the
     * master. A teaser failure SKIPS with its reason rather than failing the
     * stage: the excerpts above are complete deliverables, and a re-run
     * rebuilds the teaser (synthesis is idempotency-keyed, so paragraphs
     * already bought are re-served by the vendor, not re-billed).
     *
     * Re-entry keeps every EXISTING row exactly as curated, but a missing
     * teaser is additive and gets built: projects whose excerpts predate the
     * teaser feature (production, 2026-09-08 morning) would otherwise never
     * gain one, since their rows trip the guard on every re-run forever.
     */
    const teaserScript = await step.run(
      'write-teaser',
      async (): Promise<
        | {
            ok: true
            title: string
            paragraphs: { text: string; chapterIndex: number }[]
            scriptVersion: number
          }
        | { ok: false; gate: Record<string, unknown> }
        | { ok: false; skipped: string }
      > => {
        const rows = await listShorts(db, projectId)
        if (rows.some((row) => row.kind === 'teaser')) {
          return { ok: false, skipped: 'the teaser already exists — kept as curated' }
        }

        const latest = await getLatestScript(db, projectId)
        if (!latest) return { ok: false, skipped: 'there is no script to write a teaser from' }
        const chapterSources = latest.chapters.map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          contentMd: chapter.contentMd,
        }))
        const parsedOutline = OutlineSchema.safeParse(latest.script.outline)
        const tension = parsedOutline.success ? tensionFromOutline(parsedOutline.data) : undefined

        try {
          const project = await getProject(db, projectId)
          const teaser = mockProvidersEnabled()
            ? mockTeaser(chapterSources)
            : parseTeaser(
                (
                  await callLlm(
                    buildTeaserRequest({
                      caseTitle: project?.title ?? '',
                      chapters: chapterSources,
                      ...(tension ? { tension } : {}),
                    }),
                    { projectId },
                  )
                ).text,
              )
          return { ok: true, ...teaser, scriptVersion: latest.script.version }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false, gate: budgetGateData(error) }
          }
          return {
            ok: false,
            skipped: `the teaser script failed: ${String(serialiseError(error).message ?? 'unknown')}`,
          }
        }
      },
    )

    if (!teaserScript.ok && 'gate' in teaserScript) {
      await step.run('teaser-over-budget', () => markStageFailed(ctx, teaserScript.gate))
      return { projectId, outcome: 'over-budget' as const }
    }

    let teaserSkipped = teaserScript.ok ? null : teaserScript.skipped
    let teaserShortId: string | null = null

    if (teaserScript.ok) {
      const voiced: TeaserParagraphAudio[] = []
      for (const [index, paragraph] of teaserScript.paragraphs.entries()) {
        if (teaserSkipped) break
        const spoken = await step.run(
          `teaser-tts-${index}`,
          async (): Promise<
            | {
                ok: true
                r2Key: string
                durationMs: number
                wordTimings: TeaserParagraphAudio['wordTimings']
              }
            | { ok: false; gate: Record<string, unknown> }
            | { ok: false; skipped: string }
          > => {
            try {
              const narration = await synthesise({
                text: paragraph.text,
                // The teaser's own identity: same script version, same beat,
                // same text length re-serves the earlier synthesis.
                idempotencyKey: `teaser:${projectId}:${teaserScript.scriptVersion}:${index}:${paragraph.text.length}`,
                projectId,
              })
              const r2Key =
                takeStorage() === 'r2'
                  ? (
                      await putObject(
                        `boom-busters/voice/${projectId}/teaser/v${teaserScript.scriptVersion}-${index}.wav`,
                        narration.wav,
                        'audio/wav',
                      )
                    ).key
                  : `${MOCK_KEY_PREFIX}voice/teaser-${projectId}-${index}.wav`
              return {
                ok: true,
                r2Key,
                durationMs: narration.durationMs,
                wordTimings: narration.wordTimings ?? null,
              }
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                return { ok: false, gate: budgetGateData(error) }
              }
              return {
                ok: false,
                skipped: `beat ${index + 1} could not be synthesised: ${String(serialiseError(error).message ?? 'unknown')}`,
              }
            }
          },
        )

        if (!spoken.ok && 'gate' in spoken) {
          await step.run('teaser-tts-over-budget', () => markStageFailed(ctx, spoken.gate))
          return { projectId, outcome: 'over-budget' as const }
        }
        if (!spoken.ok) {
          teaserSkipped = spoken.skipped
          break
        }
        voiced.push({
          text: paragraph.text,
          chapterIndex: paragraph.chapterIndex,
          r2Key: spoken.r2Key,
          durationMs: spoken.durationMs,
          wordTimings: spoken.wordTimings,
        })
      }

      if (!teaserSkipped) {
        const assembled = await step.run(
          'assemble-teaser',
          async (): Promise<{ shortId: string } | { skipped: string }> => {
            const timelineRow = await latestTimeline(db, projectId)
            if (!timelineRow) return { skipped: 'there is no master timeline to lift visuals from' }
            try {
              const teaserTimeline = compileTeaserMaster({
                master: TimelineSchema.parse(timelineRow.json),
                paragraphs: voiced,
              })
              const short = await insertShort(db, {
                projectId,
                title: teaserScript.title,
                segmentRef: {
                  chapterId: TEASER_CHAPTER_ID,
                  fromParagraph: 0,
                  toParagraph: voiced.length - 1,
                },
                kind: 'teaser',
                sourceTimeline: teaserTimeline as unknown as Record<string, unknown>,
              })
              return { shortId: short.id }
            } catch (error) {
              if (error instanceof ValidationError) {
                return { skipped: `the teaser could not be assembled: ${error.message}` }
              }
              throw error
            }
          },
        )
        if ('shortId' in assembled) teaserShortId = assembled.shortId
        else teaserSkipped = assembled.skipped
      }
    }

    const toRender = [...outcome.created, ...(teaserShortId ? [teaserShortId] : [])]
    if (toRender.length > 0) {
      await step.sendEvent(
        'request-short-renders',
        toRender.map((shortId) => events.shortsRenderRequested.create({ projectId, shortId })),
      )
    }

    /**
     * A review over nothing is a dead end, not a gate: zero rows and
     * `awaiting_review` gives the human a screen that says "no shorts yet"
     * and no button that changes it. Fail the stage with the reasons instead
     * — Re-run stage is the recovery, and the marking step above makes that
     * re-run able to succeed.
     */
    if (outcome.reused === 0 && toRender.length === 0) {
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
      teaser: teaserShortId ?? (teaserSkipped ? `skipped: ${teaserSkipped}` : null),
    }
  },
)
