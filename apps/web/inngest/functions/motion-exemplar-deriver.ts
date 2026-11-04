import { jobSpendUsd } from '@boom-busters/cost'
import {
  exemplarVersionById,
  finishDerivation,
  getChannelSettings,
  getDerivation,
  insertExemplarVersion,
  listMotionReferences,
  updateExemplarDraft,
  updateTechniqueProgress,
} from '@boom-busters/db'
import type { MotionDerivationRow } from '@boom-busters/db'
import {
  buildStoryboardRequest,
  DESIGNS,
  MANIFEST,
  mockCriticReport,
  mockCriticVerify,
  mockProvidersEnabled,
  mockStoryboardPlan,
  parseStoryboardPlan,
  STORYBOARD_OUTPUT_TOKENS,
  type ReadingForDraft,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  criticPasses,
  pairwiseOutcome,
  parseEventData,
  resolveBrandKit,
  serialiseError,
} from '@boom-busters/schemas'
import type {
  CriticReport,
  CriticVerify,
  ExemplarFrames,
  ExemplarPlan,
  MotionMetrics,
  PairwiseOutcome,
  Technique,
  TechniqueProgress,
} from '@boom-busters/schemas'
import type { GetStepTools } from 'inngest'
import { callForAnswer } from '@/lib/answer'
import { criticReferencesFor } from '@/lib/critic-references'
import { db } from '@/lib/db'
import { derivedContext, derivedSlot, planBounds, planSteer } from '@/lib/exemplar-derive'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import { browserFrames } from '@/lib/graphic-code/frames'
import { storageConfigured } from '@/lib/storage'
import { criticPlanOf, criticSteer } from '@/lib/graphic-design-core'
import { inngest } from '../client'
import { events } from '../events'
import {
  buildFromPlan,
  completeForJob,
  criticRound,
  loopChannel,
  loopSlot,
  pairwiseSwapped,
  photographVersion,
} from '../lib/exemplar-loop'

/**
 * motion-exemplar-deriver (spec 2026-11-04, section 9.2): one channel's
 * exemplars derived through the critic loop, a technique at a time and a
 * step per call so a parked run resumes without paying twice. Per
 * technique: the storyboard (the plan, the slot rewritten into the
 * channel's register), the build, then per round the frames, the critic
 * and the fix, stopping early at the bar; then the verify on the strong
 * route. The version is a draft the owner approves on the tab; nothing
 * here approves. Every paid step first sums this job's ledger rows against
 * the cap the owner typed; over it, the technique keeps what it has and
 * the rest stop at once. Mock mode stores the house design, checked under
 * the channel's identity, with the fixture report and a ready verdict.
 */

const FUNCTION_ID = 'motion-exemplar-deriver'
const VERIFY_BRIEF = 'The derivation is over; is it ready?'

type StepTools = GetStepTools<typeof inngest>

/** The browser, unless GRAPHIC_FRAMES=off (the runners' tests). */
const framesOn = () => process.env['GRAPHIC_FRAMES'] !== 'off'

/** The brand's colours and fonts as the storyboard reads them, one line each (as the identity draft does). */
function brandForPrompt(brand: ReturnType<typeof resolveBrandKit>): {
  colors: Record<string, string>
  fonts: Record<string, string>
} {
  return {
    colors: Object.fromEntries(
      Object.entries(brand.colors).flatMap(([role, value]) =>
        typeof value === 'string'
          ? [[role, value]]
          : Array.isArray(value)
            ? [[role, value.join(', ')]]
            : Object.entries(value).map(([inner, hex]) => [`${role} ${inner}`, hex]),
      ),
    ),
    fonts: Object.fromEntries(
      Object.entries(brand.typography).map(([role, face]) => [role, face.family]),
    ),
  }
}

const capReason = (capUsd: number, spent: number) =>
  `The cap of $${capUsd} was reached at $${spent.toFixed(2)}`

/** The channel's readings, as the storyboard reads them. */
async function readingsFor(channelId: string): Promise<ReadingForDraft[]> {
  const rows = await listMotionReferences(db, channelId)
  return rows.map((row) => ({
    title: row.title,
    purpose: row.purpose,
    negative: row.negative,
    carryOver: row.carryOver,
    avoid: row.avoid,
    reading: row.reading ?? null,
  }))
}

type TechniqueOutcome = Pick<TechniqueProgress, 'state' | 'reason' | 'versionId'>

/** The whole loop for one technique; every paid step named `<technique>/<step>`. */
async function deriveTechnique(
  step: StepTools,
  derivation: MotionDerivationRow,
  technique: Technique,
): Promise<TechniqueOutcome> {
  const { channelId } = derivation
  const capUsd = Number(derivation.capUsd)
  const entry = MANIFEST.find((candidate) => candidate.technique === technique)
  if (!entry)
    return { state: 'failed', reason: `No catalogue entry for ${technique}`, versionId: null }
  const mock = mockProvidersEnabled()
  const complete = completeForJob(channelId, derivation.id, technique)
  const name = (part: string) => `${technique}/${part}`

  /** The cap, checked before every paid step: the reason when it is reached. */
  const overCap = async (): Promise<string | null> => {
    const spent = await jobSpendUsd(db, derivation.id)
    return spent >= capUsd ? capReason(capUsd, spent) : null
  }
  const stopped = (reason: string, versionId: string | null): TechniqueOutcome => ({
    state: 'stopped-at-cap',
    reason,
    versionId,
  })

  // 1. The storyboard.
  const planned = await step.run(
    name('storyboard'),
    async (): Promise<{ plan: ExemplarPlan } | { cap: string } | { failed: string }> => {
      const cap = await overCap()
      if (cap) return { cap }
      if (mock) return { plan: mockStoryboardPlan(entry) }
      const channel = await loopChannel(channelId)
      const brand = resolveBrandKit(await getChannelSettings(db, channelId))
      const house = DESIGNS[technique]
      const input = {
        motion: channel.motion,
        brand: brandForPrompt(brand),
        entry,
        house: house ? { title: house.title } : null,
        readings: await readingsFor(channelId),
      }
      try {
        const answer = await callForAnswer({
          request: buildStoryboardRequest(input),
          parse: (text, note) => parseStoryboardPlan(text, planBounds(entry), note),
          retryWithReason: (reason) => buildStoryboardRequest({ ...input, rejection: reason }),
          complete: (request, call) =>
            complete(request, {
              ...(call === 'answer'
                ? { estimateOutputTokens: STORYBOARD_OUTPUT_TOKENS }
                : { purpose: call }),
            } as Parameters<typeof complete>[1]),
        })
        return answer.ok ? { plan: answer.value } : { failed: answer.issue }
      } catch (error) {
        if (error instanceof BudgetExceededError) return { cap: error.message }
        throw error
      }
    },
  )
  if ('cap' in planned) return stopped(planned.cap, null)
  if ('failed' in planned) return { state: 'failed', reason: planned.failed, versionId: null }
  const { plan } = planned

  // 2. The build, stored as a draft.
  const built = await step.run(
    name('build'),
    async (): Promise<{ versionId: string } | { cap: string } | { refused: string }> => {
      const cap = await overCap()
      if (cap) return { cap }
      const channel = await loopChannel(channelId)
      let result: Awaited<ReturnType<typeof buildFromPlan>>
      if (mock) {
        const design = DESIGNS[technique]
        if (!design) return { refused: `No house design is stored for ${technique}` }
        const context = derivedContext(entry, plan)
        const slot = derivedSlot(entry, plan, context)
        const checked = graphicCodeIssue(
          { title: design.title, source: design.source, facts: design.facts },
          context,
          {
            brief: slot.brief,
            durationMs: slot.durationMs,
            words: plan.slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
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
            plan,
            guidance: planSteer(plan),
            complete,
            ...(framesOn() ? { frames: browserFrames() } : {}),
          })
        } catch (error) {
          if (error instanceof BudgetExceededError) return { cap: error.message }
          throw error
        }
      }
      if (!result.ok) return { refused: result.issue }
      const row = await insertExemplarVersion(db, {
        channelId,
        technique,
        plan,
        code: result.code,
        derivationId: derivation.id,
      })
      return { versionId: row.id }
    },
  )
  if ('cap' in built) return stopped(built.cap, null)
  if ('refused' in built) return { state: 'refused', reason: built.refused, versionId: null }
  const { versionId } = built

  // 3 to 6. The rounds.
  let lastReport: CriticReport | null = null
  let previous: ExemplarFrames | null = null
  let lastMetrics: MotionMetrics | null = null
  let noFrames: string | null = null
  for (let round = 1; round <= derivation.rounds; round += 1) {
    const shot = await step.run(
      name(`frames-${round}`),
      async (): Promise<
        | { frames: ExemplarFrames; findings: string[]; metrics: MotionMetrics | null }
        | { none: string }
      > => {
        if (mock) return { none: 'mock providers' }
        if (!framesOn()) return { none: 'no frames to show' }
        const version = await exemplarVersionById(db, versionId)
        if (!version) return { none: 'the version is gone' }
        const channel = await loopChannel(channelId)
        const photographed = await photographVersion({
          channel,
          entry,
          plan,
          versionId,
          round,
          code: version.code,
          frames: browserFrames(),
        })
        if (!photographed) {
          return {
            none: storageConfigured() ? 'no frames to show' : 'no storage to keep the frames',
          }
        }
        await updateExemplarDraft(db, versionId, {
          frames: photographed.frames,
          metrics: photographed.metrics,
        })
        return photographed
      },
    )
    if ('none' in shot && !mock) {
      noFrames = shot.none
      break
    }

    const judged = await step.run(
      name(`critic-${round}`),
      async (): Promise<
        { report: CriticReport; pairwise: PairwiseOutcome | null } | { cap: string }
      > => {
        const cap = await overCap()
        if (cap) return { cap }
        const version = await exemplarVersionById(db, versionId)
        if (!version) return { cap: 'the version is gone' }
        const channel = await loopChannel(channelId)
        const criticPlan = criticPlanOf(version.code, derivedContext(entry, plan))
        if (mock || 'none' in shot) {
          const report = mockCriticReport(criticPlan)
          await updateExemplarDraft(db, versionId, { critique: report })
          return { report, pairwise: null }
        }
        try {
          const { report, pairwise } = await criticRound({
            channel,
            plan: criticPlan,
            slot: loopSlot(entry, plan),
            frames: shot.frames,
            findings: shot.findings,
            metrics: shot.metrics,
            references: await criticReferencesFor(
              channelId,
              plan.leansOn.map((lean) => lean.title),
            ),
            ...(previous ? { previous } : {}),
            complete,
          })
          let outcome: PairwiseOutcome | null = null
          if (previous && pairwise) {
            const swapped = await pairwiseSwapped({
              channel,
              plan: criticPlan,
              current: shot.frames,
              previous,
              complete,
            })
            outcome = pairwiseOutcome(pairwise, swapped)
          }
          await updateExemplarDraft(db, versionId, {
            critique: report,
            ...(outcome ? { pairwise: outcome } : {}),
          })
          return { report, pairwise: outcome }
        } catch (error) {
          if (error instanceof BudgetExceededError) return { cap: error.message }
          throw error
        }
      },
    )
    if ('cap' in judged) return stopped(judged.cap, versionId)
    lastReport = judged.report
    if (!('none' in shot)) {
      previous = shot.frames
      lastMetrics = shot.metrics
    }
    if (mock) break
    if (criticPasses(judged.report) && !(lastMetrics?.frozenCritical ?? false)) break
    if (round === derivation.rounds || judged.report.fixes.length === 0) break

    const fixed = await step.run(
      name(`fix-${round}`),
      async (): Promise<{ fixed: true } | { kept: string } | { cap: string }> => {
        const cap = await overCap()
        if (cap) return { cap }
        const version = await exemplarVersionById(db, versionId)
        if (!version) return { cap: 'the version is gone' }
        const channel = await loopChannel(channelId)
        try {
          const result = await buildFromPlan({
            channel,
            entry,
            plan,
            current: version.code,
            guidance: criticSteer(judged.report.fixes, planSteer(plan)),
            complete,
            ...(framesOn() ? { frames: browserFrames() } : {}),
          })
          if (!result.ok) return { kept: result.issue }
          await updateExemplarDraft(db, versionId, { code: result.code })
          return { fixed: true }
        } catch (error) {
          if (error instanceof BudgetExceededError) return { cap: error.message }
          throw error
        }
      },
    )
    if ('cap' in fixed) return stopped(fixed.cap, versionId)
    if ('kept' in fixed) break
  }

  if (noFrames) return { state: 'no-frames', reason: noFrames, versionId }

  // 7. The verify.
  const verified = await step.run(
    name('verify'),
    async (): Promise<{ verify: CriticVerify } | { cap: string }> => {
      const cap = await overCap()
      if (cap) return { cap }
      const version = await exemplarVersionById(db, versionId)
      if (!version) return { cap: 'the version is gone' }
      const channel = await loopChannel(channelId)
      const criticPlan = criticPlanOf(version.code, derivedContext(entry, plan))
      const prior = lastReport ?? mockCriticReport(criticPlan)
      if (mock || !previous) {
        const verify = mockCriticVerify(criticPlan, prior)
        await updateExemplarDraft(db, versionId, { verify })
        return { verify }
      }
      try {
        const { report } = await criticRound({
          channel,
          plan: criticPlan,
          slot: loopSlot(entry, plan),
          frames: previous,
          findings: [],
          metrics: lastMetrics,
          references: [],
          verify: { prior, brief: VERIFY_BRIEF },
          strong: true,
          complete,
        })
        const verify = report as CriticVerify
        await updateExemplarDraft(db, versionId, { verify })
        return { verify }
      } catch (error) {
        if (error instanceof BudgetExceededError) return { cap: error.message }
        throw error
      }
    },
  )
  if ('cap' in verified) return stopped(verified.cap, versionId)
  return {
    state: verified.verify.verdict === 'ready' ? 'ready' : 'wants-pass',
    reason: null,
    versionId,
  }
}

export const motionExemplarDeriver = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Motion exemplar deriver',
    retries: 1,
    // One derivation per channel at a time (spec 9.1). Cancel, not skip: a
    // stale lock must never swallow a relaunch (decision 233); the launch
    // action refuses while one runs, so nothing is cancelled by accident.
    singleton: { key: 'event.data.channelId', mode: 'cancel' },
    onFailure: async ({ event }) => {
      const derivationId = event.data.event.data['derivationId']
      if (typeof derivationId !== 'string') return
      const message = String(serialiseError(event.data.error)['message'] ?? 'The derivation failed')
      const spent = await jobSpendUsd(db, derivationId).catch(() => 0)
      await finishDerivation(db, derivationId, {
        state: 'failed',
        spentUsd: spent,
        error: message,
      }).catch(() => undefined)
    },
    triggers: [events.motionExemplarsDerive],
  },
  async ({ event, step }) => {
    const { derivationId } = parseEventData('motion/exemplars.derive', event.data)
    const derivation = await step.run('load', () => getDerivation(db, derivationId))
    if (!derivation) return { derivationId, outcome: 'gone' as const }

    let stoppedAtCap = false
    for (const technique of derivation.techniques) {
      const before = await step.run(`${technique}/start`, async () => {
        await updateTechniqueProgress(db, derivationId, technique, { state: 'running' })
        return jobSpendUsd(db, derivationId)
      })
      const outcome = await deriveTechnique(step, derivation, technique)
      await step.run(`${technique}/done`, async () => {
        const spent = await jobSpendUsd(db, derivationId)
        const costUsd = Math.max(0, Math.round((spent - before) * 10_000) / 10_000)
        await updateTechniqueProgress(db, derivationId, technique, { ...outcome, costUsd })
        if (outcome.versionId) {
          const version = await exemplarVersionById(db, outcome.versionId)
          if (version?.status === 'draft')
            await updateExemplarDraft(db, outcome.versionId, { costUsd })
        }
      })
      if (outcome.state === 'stopped-at-cap') stoppedAtCap = true
    }

    const outcome = await step.run('finish', async () => {
      const spent = await jobSpendUsd(db, derivationId)
      const state = stoppedAtCap ? ('stopped' as const) : ('done' as const)
      await finishDerivation(db, derivationId, { state, spentUsd: spent })
      return state
    })
    return { derivationId, outcome }
  },
)
