import {
  channelForProject,
  getLatestScript,
  getProject,
  insertTalkingPointSet,
  latestTalkingPointSet,
  scriptableClaims,
  setProjectStage,
} from '@boom-busters/db'
import {
  mockProvidersEnabled,
  mockTalkingPoints,
  tensionFromOutline,
} from '@boom-busters/providers'
import type { Repair, TalkingPointsRedo } from '@boom-busters/providers'
import {
  BudgetExceededError,
  newId,
  OutlineSchema,
  parseEventData,
  serialiseError,
  talkingPointSetIssues,
} from '@boom-busters/schemas'
import type { NoticeTarget, TalkingPoint, TalkingPointDraft } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { completeForProject } from '@/lib/answer-call'
import { recordRepairs, recordStop } from '@/lib/notices'
import { proposeTalkingPointsWith } from '@/lib/point-answers'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markStageFailed, type GateContext } from '../lib/gates'

/**
 * talking-points-runner (playbook Shorts design 3.1 to 3.3): `shorts/points.requested`
 * → one proposal call → a new version of the talking-point set → the Shorts
 * stage parked at `awaiting_review` with phase `points`. `all` proposes the
 * whole set again, `one` replaces a single point and keeps its order, `add`
 * appends one. Nothing is voiced or bought here; only the proposal call costs.
 *
 * One step does the whole of it, load to insert: Inngest replays a finished
 * step's result, so nothing a later step needs is read outside it, and the
 * paid call and the row it pays for are never separated by a retry.
 *
 * A second request while one runs queues behind it (the screen's actions refuse
 * first anyway): cancelling would throw away a paid answer.
 */

const FUNCTION_ID = 'talking-points-runner'

type Request = ReturnType<typeof parseEventData<'shorts/points.requested'>>

type Proposed =
  | { ok: true; version: number }
  | { ok: false; gate: Record<string, unknown> }
  | { ok: false; refused: string }

/** One deterministic stand-in for a redone or added point, so a merged mock set still validates. */
function mockSinglePoint(
  request: Request,
  current: readonly TalkingPoint[],
  chapters: readonly { index: number; title: string; contentMd: string }[],
): TalkingPointDraft {
  const base = mockTalkingPoints(chapters)[0]!
  if (request.mode === 'one') {
    const old = current.find((point) => point.id === request.pointId)!
    const { id: _id, ...fields } = old
    return {
      ...fields,
      title: `MOCK REPLACEMENT ${old.order}`,
      question: `MOCK REPLACEMENT QUESTION ${old.order}: what does this stand-in ask instead?`,
      payoff: `MOCK REPLACEMENT PAYOFF ${old.order}: the stand-in answer.`,
      hook: `MOCK REPLACEMENT HOOK ${old.order}: a stand-in first line.`,
    }
  }
  const order = current.length + 1
  // The chapter that leads the fewest points, so the added one never trips the two-per-chapter rule.
  const leads = (index: number) => current.filter((p) => p.sourceChapters[0] === index).length
  const lead = [...chapters].sort((a, b) => leads(a.index) - leads(b.index))[0]?.index ?? 0
  return {
    ...base,
    type: 'incomplete-mechanism',
    title: `MOCK ADDITION ${order}`,
    question: `MOCK ADDITION QUESTION ${order}: what does this extra stand-in ask?`,
    payoff: `MOCK ADDITION PAYOFF ${order}: the stand-in answer.`,
    hook: `MOCK ADDITION HOOK ${order}: a stand-in first line.`,
    sourceChapters: [lead],
    order,
  }
}

export const talkingPointsRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Talking points',
    retries: 4,
    // One live run per project, queued rather than cancelled or skipped: a
    // second request waits and is proposed from the set the first one wrote.
    // A singleton would cancel paid work, and `skip` is banned (a cancelled
    // run keeps its lock and swallows every later request, decision 233).
    concurrency: [{ key: 'event.data.projectId', limit: 1 }],
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
    triggers: [events.shortsPointsRequested],
  },
  async ({ event, step, runId }) => {
    const request = parseEventData('shorts/points.requested', event.data)
    const { projectId } = request
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }
    const target: NoticeTarget = { projectId, subject: 'points', subjectId: null }

    const proposed = await step.run('propose-talking-points', async (): Promise<Proposed> => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      await setProjectStage(db, projectId, {
        stage: 'shorts',
        stageStatus: 'running',
        shortsPhase: 'points',
      })

      const latest = await getLatestScript(db, projectId)
      if (!latest) throw new NonRetriableError('There is no script to propose talking points from.')
      const chapterSources = latest.chapters.map((chapter) => ({
        index: chapter.index,
        title: chapter.title,
        contentMd: chapter.contentMd,
      }))
      const current = (await latestTalkingPointSet(db, projectId))?.points ?? []

      if (request.mode === 'one' && !current.some((point) => point.id === request.pointId)) {
        return { ok: false, refused: 'that talking point is no longer in the set' }
      }

      // safeParse, not parse: a missing or malformed stored outline must cost
      // the tension hints, never the proposal (design 3.5).
      const parsedOutline = OutlineSchema.safeParse(latest.script.outline)
      const tension = parsedOutline.success ? tensionFromOutline(parsedOutline.data) : undefined

      let drafts: TalkingPointDraft[]
      let repairs: Repair[] = []
      if (mockProvidersEnabled()) {
        drafts =
          request.mode === 'all'
            ? mockTalkingPoints(chapterSources)
            : [mockSinglePoint(request, current, chapterSources)]
      } else {
        const redo: TalkingPointsRedo | undefined =
          request.mode === 'all'
            ? current.length > 0
              ? { mode: 'all', note: request.note, current }
              : undefined
            : request.mode === 'one'
              ? { mode: 'one', pointId: request.pointId, note: request.note, current }
              : { mode: 'add', note: request.note, current }
        try {
          const answered = await proposeTalkingPointsWith(
            completeForProject(projectId),
            {
              bible: await channelForProject(db, projectId),
              caseTitle: project.title,
              chapters: chapterSources,
              claims: (await scriptableClaims(db, projectId)).map((claim) => claim.text),
              ...(tension ? { tension } : {}),
              ...(redo ? { redo } : {}),
            },
            request.mode === 'all' ? 'set' : 'single',
            chapterSources.length,
          )
          drafts = answered.points
          repairs = answered.repairs
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false, gate: budgetGateData(error) }
          }
          // A bad answer has had its two calls and stops the stage with its reason (decision 292); a provider error retries, then onFailure.
          throw error
        }
      }

      const merged: TalkingPoint[] =
        request.mode === 'all'
          ? drafts.map((draft) => ({ id: newId(), ...draft }))
          : request.mode === 'one'
            ? current.map((point) =>
                point.id === request.pointId
                  ? { id: newId(), ...drafts[0]!, order: point.order }
                  : point,
              )
            : [...current, { id: newId(), ...drafts[0]!, order: current.length + 1 }]

      const issues = talkingPointSetIssues(merged, chapterSources.length)
      if (issues.length > 0) return { ok: false, refused: issues.join('; ') }

      const row = await insertTalkingPointSet(db, {
        projectId,
        scriptVersion: latest.script.version,
        points: merged,
        note: request.note,
      })
      await recordRepairs(target, repairs)
      return { ok: true, version: row.version }
    })

    if (!proposed.ok && 'gate' in proposed) {
      await step.run('points-over-budget', () => markStageFailed(ctx, proposed.gate))
      return { projectId, outcome: 'over-budget' as const }
    }

    if (!proposed.ok) {
      // Nothing was saved; the set the owner had is still the one to review.
      await step.run('points-refused', async () => {
        await recordStop(
          target,
          'stopped',
          `The talking points were not changed: ${proposed.refused}.`,
        )
        await setProjectStage(db, projectId, {
          stage: 'shorts',
          stageStatus: 'awaiting_review',
          shortsPhase: 'points',
        })
      })
      return { projectId, outcome: 'refused' as const, reason: proposed.refused }
    }

    await step.run('points-ready', () =>
      setProjectStage(db, projectId, {
        stage: 'shorts',
        stageStatus: 'awaiting_review',
        shortsPhase: 'points',
      }),
    )
    return { projectId, outcome: 'proposed' as const, version: proposed.version }
  },
)
