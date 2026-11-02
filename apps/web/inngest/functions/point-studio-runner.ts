import {
  approvedTalkingPointSet,
  getShort,
  latestTimeline,
  settlePointWork,
  updateShort,
} from '@boom-busters/db'
import {
  parseEventData,
  PointFetchesRecordSchema,
  PointScriptRecordSchema,
  PointVoiceRecordSchema,
  serialiseError,
  teaserTextHash,
  TimelineSchema,
} from '@boom-busters/schemas'
import type {
  PointFetchesRecord,
  PointScriptRecord,
  PointVoiceRecord,
  PointWork,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { recordRepairs } from '@/lib/notices'
import { inngest } from '../client'
import { events } from '../events'
import { fetchPendingShots, planPointShots, voiceOrReusePointParagraph } from '../lib/point-build'
import type { PendingOutcome } from '../lib/point-build'

/**
 * point-studio-runner (playbook Shorts design 6): the point Short studio's
 * Re-voice and Re-plan buttons, `shorts/point.studio.requested`.
 *
 * `op: 'voice'` re-voices the stored (possibly edited) script one paragraph a
 * step through the build's own reuse-or-voice function, so unchanged
 * paragraphs are re-served and only changed text is bought, then stores
 * `pointVoice`. `op: 'plan'` plans the shots again over the stored voice with
 * the owner's note, fetches the new pictures (each its own step), and stores
 * `pointPlan` with the pool, keeping the voice. Neither cuts: the cut is a
 * separate act (`assemblePoint`, free and synchronous), so the owner can hear
 * the narration and look at the shots first, as the teaser rebuild runner
 * leaves it.
 *
 * Not a stage runner: the project may sit at shorts or publish while a Short
 * is reworked, so failures never touch the stage. The action wins the Short's
 * slot of work (`claimPointWork`) before it sends; this runner gives the slot
 * back, as `null` when the work landed or as words the studio shows when it
 * stopped, with a notification for a studio that was closed meanwhile. One run
 * per Short at a time and two at once (`concurrency`: `skip` is banned and a
 * cancel would throw away paid work).
 */

const FUNCTION_ID = 'point-studio-runner'

const TITLES: Record<'voice' | 'plan', string> = {
  voice: 'The re-voice stopped',
  plan: 'The re-plan stopped',
}

async function giveUp(
  projectId: string,
  shortId: string,
  what: PointWork,
  reason: string,
): Promise<void> {
  await settlePointWork(db, shortId, { state: 'failed', what, reason })
  await notify({
    kind: 'run-failed',
    title: what === 'voice' || what === 'plan' ? TITLES[what] : 'The Short studio stopped',
    body: reason,
    href: `/projects/${projectId}?stage=shorts`,
  })
}

export const pointStudioRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Point Short studio',
    retries: 2,
    concurrency: [{ limit: 2 }, { key: 'event.data.shortId', limit: 1 }],
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      // A crash past the retries must say so, or the studio just spins until
      // its cooldown runs out.
      const data = event.data.event.data
      const projectId = data['projectId']
      const shortId = data['shortId']
      if (typeof projectId !== 'string' || typeof shortId !== 'string') return
      const what: PointWork = data['op'] === 'plan' ? 'plan' : 'voice'
      const message = String(serialiseError(event.data.error).message ?? 'Unknown error')
      await giveUp(projectId, shortId, what, `It stopped unexpectedly: ${message}`).catch(
        () => undefined,
      )
    },
    triggers: [events.shortsPointStudioRequested],
  },
  async ({ event, step }) => {
    const { projectId, shortId, op, note } = parseEventData(
      'shorts/point.studio.requested',
      event.data,
    )

    const loaded = await step.run('load-short', async () => {
      const short = await getShort(db, shortId)
      if (!short) throw new NonRetriableError(`Short ${shortId} no longer exists`)
      if (short.kind !== 'point' || !short.pointId) {
        throw new NonRetriableError('Only a point Short has this studio.')
      }
      const script = PointScriptRecordSchema.safeParse(short.pointScript)
      if (!script.success) throw new NonRetriableError('This Short has no stored script.')
      const voice = PointVoiceRecordSchema.safeParse(short.pointVoice)
      // The point's own chapters, for the planner to prefer; none if it was removed.
      const point = (await approvedTalkingPointSet(db, projectId))?.points.find(
        (candidate) => candidate.id === short.pointId,
      )
      return {
        pointId: short.pointId,
        script: script.data,
        voice: voice.success ? voice.data : null,
        sourceChapters: point?.sourceChapters ?? script.data.paragraphs.map((p) => p.chapterIndex),
      }
    })
    const script: PointScriptRecord = loaded.script

    const fail = async (stepName: string, what: PointWork, reason: string) => {
      await step.run(stepName, () => giveUp(projectId, shortId, what, reason))
    }
    const gateWords = (gate: Record<string, unknown>) =>
      `it hit the budget ceiling: ${String(gate['message'] ?? 'over budget')}`

    // -----------------------------------------------------------------------
    // Voice: one paragraph a step, so a retry re-serves what was already bought
    // -----------------------------------------------------------------------
    if (op === 'voice') {
      const voiced: PointVoiceRecord = { scriptVersion: script.scriptVersion, paragraphs: [] }
      for (const [index, paragraph] of script.paragraphs.entries()) {
        const spoken = await step.run(`tts-${index}`, () =>
          voiceOrReusePointParagraph({
            projectId,
            pointId: loaded.pointId,
            scriptVersion: script.scriptVersion,
            index,
            text: paragraph.text,
          }),
        )
        if (!spoken.ok && 'gate' in spoken) {
          await fail(
            'tts-over-budget',
            'voice',
            `Voicing paragraph ${index + 1}: ${gateWords(spoken.gate)}`,
          )
          return { projectId, shortId, outcome: 'over-budget' as const }
        }
        if (!spoken.ok) {
          await fail('tts-skipped', 'voice', `Voicing stopped mid-way: ${spoken.skipped}`)
          return { projectId, shortId, outcome: 'skipped' as const, reason: spoken.skipped }
        }
        voiced.paragraphs.push({
          textHash: teaserTextHash(paragraph.text),
          r2Key: spoken.r2Key,
          durationMs: spoken.durationMs,
          wordTimings: spoken.wordTimings,
        })
      }

      // Stored, not cut: the cut is a separate act.
      await step.run('store-voice', async () => {
        await updateShort(db, shortId, { pointVoice: voiced })
        await settlePointWork(db, shortId, null)
        await notify({
          kind: 'heads-up',
          title: 'The Short is voiced',
          body: `${voiced.paragraphs.length} paragraphs are ready. Re-plan the shots if the words changed, then Assemble and render.`,
          href: `/projects/${projectId}?stage=shorts`,
        })
      })
      return {
        projectId,
        shortId,
        outcome: 'voiced' as const,
        paragraphs: voiced.paragraphs.length,
      }
    }

    // -----------------------------------------------------------------------
    // Plan: new shots over the stored voice, new pictures, the voice kept
    // -----------------------------------------------------------------------
    const voice = loaded.voice
    if (!voice) {
      await fail('plan-no-voice', 'plan', 'The script is not voiced yet. Re-voice it first.')
      return { projectId, shortId, outcome: 'skipped' as const, reason: 'no voice' }
    }

    const planned = await step.run('plan-shots', async () => {
      const row = await latestTimeline(db, projectId)
      if (!row) throw new NonRetriableError('There is no compiled master timeline to plan from.')
      return planPointShots(projectId, {
        script,
        voice,
        master: TimelineSchema.parse(row.json),
        sourceChapters: loaded.sourceChapters,
        note,
      })
    })
    if (!planned.ok && 'gate' in planned) {
      await fail('plan-over-budget', 'plan', `Planning: ${gateWords(planned.gate)}`)
      return { projectId, shortId, outcome: 'over-budget' as const }
    }
    if (!planned.ok) {
      await fail('plan-skipped', 'plan', `Planning stopped: ${planned.skipped}`)
      return { projectId, shortId, outcome: 'skipped' as const, reason: planned.skipped }
    }

    const fetched = await fetchPendingShots(
      projectId,
      planned.plan,
      (name, fn) => step.run(name, fn) as Promise<PendingOutcome>,
    )
    if (!fetched.ok && 'gate' in fetched) {
      await fail('fetch-over-budget', 'plan', `New pictures: ${gateWords(fetched.gate)}`)
      return { projectId, shortId, outcome: 'over-budget' as const }
    }
    if (!fetched.ok) {
      await fail('fetch-skipped', 'plan', `New pictures stopped: ${fetched.skipped}`)
      return { projectId, shortId, outcome: 'skipped' as const, reason: fetched.skipped }
    }

    await step.run('store-plan', async () => {
      // What the owner already bought stays in the pool beside what this plan
      // fetched: paid pixels are never silently discarded.
      const current = PointFetchesRecordSchema.safeParse(
        (await getShort(db, shortId))?.pointFetches,
      )
      const seen = new Set<string>()
      const candidates = [
        ...(current.success ? current.data.candidates : []),
        ...fetched.fetches.candidates,
      ].filter((candidate) => !seen.has(candidate.id) && seen.add(candidate.id))
      const fetches: PointFetchesRecord = { candidates: candidates.slice(-60), state: null }
      await updateShort(db, shortId, { pointPlan: fetched.plan, pointFetches: fetches })
      await recordRepairs({ projectId, subject: 'short', subjectId: shortId }, [
        ...planned.repairs,
        ...fetched.repairs,
      ])
      await notify({
        kind: 'heads-up',
        title: 'The shots are re-planned',
        body: `${fetched.plan.shots.length} shots are ready in the studio. Look them over, then Assemble and render.`,
        href: `/projects/${projectId}?stage=shorts`,
      })
    })

    return {
      projectId,
      shortId,
      outcome: 'planned' as const,
      shots: fetched.plan.shots.length,
      fetched: fetched.fetched,
    }
  },
)
