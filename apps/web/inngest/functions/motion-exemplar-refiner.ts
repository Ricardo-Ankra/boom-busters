import { jobSpendUsd } from '@boom-busters/cost'
import { exemplarVersionById, insertExemplarVersion, updateExemplarDraft } from '@boom-busters/db'
import {
  MANIFEST,
  mockCriticReport,
  mockCriticVerify,
  mockProvidersEnabled,
} from '@boom-busters/providers'
import { BudgetExceededError, CRITIC_AXES, CRITIC_BAR, parseEventData } from '@boom-busters/schemas'
import type { CriticReport, CriticVerify, PairwiseOutcome } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { derivedContext, derivedSlot, refineSteer } from '@/lib/exemplar-derive'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import { browserFrames } from '@/lib/graphic-code/frames'
import { criticPlanOf } from '@/lib/graphic-design-core'
import { notify } from '@/lib/notify'
import { inngest } from '../client'
import { events } from '../events'
import {
  buildFromPlan,
  completeForJob,
  criticRound,
  loopChannel,
  loopSlot,
  photographVersion,
} from '../lib/exemplar-loop'

/**
 * motion-exemplar-refiner (spec 2026-11-04, section 9.3): one build from
 * the parent version under the owner's steer, with the plan and the
 * instruction that what the steer does not name is kept; its frames; one
 * critic round told to verify against the parent with the steer as the
 * brief; the result a new draft with `parentId` and `steer`, shown beside
 * the parent on the Exemplars tab. A steer never runs the full loop. A
 * refused build inserts nothing and leaves a heads-up with the reason.
 */

const FUNCTION_ID = 'motion-exemplar-refiner'

const framesOn = () => process.env['GRAPHIC_FRAMES'] !== 'off'

/** A parent reviewed before the critic stored a report: five eights and no defect, so the verify has a prior. */
const emptyReport = (): CriticReport => ({
  scores: Object.fromEntries(
    CRITIC_AXES.map((axis) => [axis, { score: CRITIC_BAR, line: 'no report was stored' }]),
  ) as CriticReport['scores'],
  defects: [],
  fixes: [],
  mechanisms: [],
  keep: true,
})

/** A refine's pairwise is read from the one ask, no swap: A is the new version. */
function pairwiseFromOne(answer: Record<string, 'A' | 'B' | 'same'>): PairwiseOutcome {
  return Object.fromEntries(
    CRITIC_AXES.map((axis) => [
      axis,
      answer[axis] === 'A' ? 'new' : answer[axis] === 'B' ? 'previous' : 'tie',
    ]),
  ) as PairwiseOutcome
}

export const motionExemplarRefiner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Motion exemplar refiner',
    retries: 1,
    // One refine per channel at a time (spec 9.3); cancel, not skip, as the deriver (decision 233).
    singleton: { key: 'event.data.channelId', mode: 'cancel' },
    triggers: [events.motionExemplarRefine],
  },
  async ({ event, step, runId }) => {
    const { channelId, parentId, steer } = parseEventData('motion/exemplar.refine', event.data)
    const mock = mockProvidersEnabled()
    const jobId = runId

    const built = await step.run(
      'build',
      async (): Promise<{ versionId: string } | { gone: true } | { refused: string }> => {
        const parent = await exemplarVersionById(db, parentId)
        if (!parent || parent.channelId !== channelId) return { gone: true }
        const entry = MANIFEST.find((candidate) => candidate.technique === parent.technique)
        if (!entry) return { refused: `No catalogue entry for ${parent.technique}` }
        const channel = await loopChannel(channelId)
        const guidance = refineSteer(steer, parent.plan)
        let result: Awaited<ReturnType<typeof buildFromPlan>>
        if (mock) {
          const context = derivedContext(entry, parent.plan)
          const slot = derivedSlot(entry, parent.plan, context)
          const checked = graphicCodeIssue(
            {
              title: `[mock] Refined: ${steer}`.slice(0, 80).trim(),
              source: parent.code.source,
              facts: parent.code.facts.map((fact) => ({
                text: fact.text,
                claim: context.claims.findIndex((claim) => claim.id === fact.claimId) + 1,
              })),
            },
            context,
            {
              brief: slot.brief,
              durationMs: slot.durationMs,
              words: parent.plan.slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
            },
            { motion: channel.motion },
          )
          result =
            'issue' in checked
              ? { ok: false, issue: checked.issue }
              : { ok: true, code: checked.code }
        } else {
          try {
            result = await buildFromPlan({
              channel,
              entry,
              plan: parent.plan,
              current: parent.code,
              guidance,
              complete: completeForJob(channelId, jobId, parent.technique),
              ...(framesOn() ? { frames: browserFrames() } : {}),
            })
          } catch (error) {
            if (error instanceof BudgetExceededError) return { refused: error.message }
            throw error
          }
        }
        if (!result.ok) {
          await notify({
            kind: 'heads-up',
            title: 'Refine refused',
            body: `${parent.technique}: ${result.issue}`,
            href: `/c/${channelId}/settings?tab=exemplars`,
          })
          return { refused: result.issue }
        }
        const row = await insertExemplarVersion(db, {
          channelId,
          technique: parent.technique,
          plan: parent.plan,
          code: result.code,
          parentId,
          steer,
        })
        return { versionId: row.id }
      },
    )
    if ('gone' in built) return { parentId, outcome: 'gone' as const }
    if ('refused' in built) return { parentId, outcome: 'refused' as const, reason: built.refused }
    const { versionId } = built

    const shot = await step.run('frames', async () => {
      if (mock || !framesOn()) return null
      const version = await exemplarVersionById(db, versionId)
      const parent = await exemplarVersionById(db, parentId)
      if (!version || !parent) return null
      const entry = MANIFEST.find((candidate) => candidate.technique === parent.technique)
      if (!entry) return null
      const channel = await loopChannel(channelId)
      const photographed = await photographVersion({
        channel,
        entry,
        plan: parent.plan,
        versionId,
        round: 1,
        code: version.code,
        frames: browserFrames(),
      })
      if (!photographed) return null
      await updateExemplarDraft(db, versionId, {
        frames: photographed.frames,
        metrics: photographed.metrics,
      })
      return photographed
    })

    await step.run('verify', async () => {
      const version = await exemplarVersionById(db, versionId)
      const parent = await exemplarVersionById(db, parentId)
      if (!version || !parent) return
      const entry = MANIFEST.find((candidate) => candidate.technique === parent.technique)
      if (!entry) return
      const channel = await loopChannel(channelId)
      const plan = criticPlanOf(version.code, derivedContext(entry, parent.plan))
      const prior = parent.critique ?? emptyReport()
      if (mock || !shot) {
        const verify = mockCriticVerify(plan, prior)
        await updateExemplarDraft(db, versionId, { critique: mockCriticReport(plan), verify })
        return
      }
      try {
        const { report, pairwise } = await criticRound({
          channel,
          plan,
          slot: loopSlot(entry, parent.plan),
          frames: shot.frames,
          findings: shot.findings,
          metrics: shot.metrics,
          references: [],
          ...(parent.frames ? { previous: parent.frames } : {}),
          verify: { prior, brief: `The producer's steer: ${steer}` },
          complete: completeForJob(channelId, jobId, parent.technique),
        })
        const verify = report as CriticVerify
        await updateExemplarDraft(db, versionId, {
          critique: verify,
          verify,
          ...(pairwise ? { pairwise: pairwiseFromOne(pairwise) } : {}),
        })
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          channel.log(`the refine's verify stopped on the budget: ${error.message}`)
          return
        }
        throw error
      }
    })

    await step.run('done', async () => {
      const spent = await jobSpendUsd(db, jobId)
      const version = await exemplarVersionById(db, versionId)
      if (version?.status === 'draft') await updateExemplarDraft(db, versionId, { costUsd: spent })
    })

    return { parentId, versionId, outcome: 'refined' as const }
  },
)
