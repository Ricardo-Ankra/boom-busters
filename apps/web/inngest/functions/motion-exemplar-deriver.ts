import { jobSpendUsd } from '@boom-busters/cost'
import {
  exemplarVersionById,
  finishDerivation,
  getChannelSettings,
  getDerivation,
  insertExemplarVersion,
  listMotionReferences,
  touchDerivation,
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
  ValidationError,
} from '@boom-busters/schemas'
import type {
  CriticReport,
  CriticVerify,
  ExemplarFrames,
  ExemplarPlan,
  MotionMetrics,
  PairwiseAnswer,
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
const CANCELLED_ID = 'motion-derivation-cancelled'
const VERIFY_BRIEF = 'The derivation is over; is it ready?'
const CANCELLED_OUTSIDE = 'Cancelled outside the app (the Inngest dashboard, or the API)'

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

/** A thrown call as the technique's reason, contained in its step so the other techniques still run (final review, issue 6). */
const failedWith = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 500)

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
/** What the loop reads of the derivation: a step's output is JSON, so no dates. */
type DerivationAsked = Pick<
  MotionDerivationRow,
  'id' | 'channelId' | 'techniques' | 'rounds' | 'capUsd'
>

async function deriveTechnique(
  step: StepTools,
  derivation: DerivationAsked,
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
    // The heartbeat: a row untouched for a quarter of an hour is dead (`runningDerivation`).
    await touchDerivation(db, derivation.id)
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
        return { failed: failedWith(error) }
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
          return { refused: failedWith(error) }
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

  // 3 to 6. The rounds. A critic and, unless it passed or asked nothing, a
  // fix in every round, the last included (spec 9.2, steps 4 to 6).
  let lastReport: CriticReport | null = null
  /** The frames of the code the last critic judged. */
  let lastFrames: ExemplarFrames | null = null
  /** The round before, for the pairwise question. */
  let previousFrames: ExemplarFrames | null = null
  let lastMetrics: MotionMetrics | null = null
  let noFrames: string | null = null
  let malformed: string | null = null
  /** A fix landed after the last critic: its frames are not yet taken, and the verify needs them. */
  let fixedAfterLastCritic = false

  const photograph = async (round: number) =>
    step.run(
      name(`frames-${round}`),
      async (): Promise<
        | { frames: ExemplarFrames; findings: string[]; metrics: MotionMetrics | null }
        | { none: string }
      > => {
        if (mock) return { none: 'mock providers' }
        if (!framesOn()) return { none: 'no frames to show' }
        const version = await exemplarVersionById(db, versionId)
        if (!version) return { none: 'the version is gone' }
        if (version.status !== 'draft') return { none: 'the owner decided on the version' }
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
        try {
          await updateExemplarDraft(db, versionId, {
            frames: photographed.frames,
            metrics: photographed.metrics,
          })
        } catch (error) {
          if (error instanceof ValidationError) return { none: 'the owner decided on the version' }
          throw error
        }
        return photographed
      },
    )

  for (let round = 1; round <= derivation.rounds; round += 1) {
    const shot = await photograph(round)
    if ('none' in shot && !mock) {
      noFrames = shot.none
      break
    }

    const judged = await step.run(
      name(`critic-${round}`),
      async (): Promise<
        | { report: CriticReport; pairwise: PairwiseAnswer | null }
        | { cap: string }
        | { malformed: string }
        | { failed: string }
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
            ...(lastFrames ? { previous: lastFrames } : {}),
            complete,
          })
          await updateExemplarDraft(db, versionId, { critique: report })
          return { report, pairwise }
        } catch (error) {
          if (error instanceof BudgetExceededError) return { cap: error.message }
          if (error instanceof ValidationError) return { malformed: error.message }
          return { failed: failedWith(error) }
        }
      },
    )
    if ('cap' in judged) return stopped(judged.cap, versionId)
    if ('failed' in judged) return { state: 'failed', reason: judged.failed, versionId }
    if ('malformed' in judged) {
      malformed = judged.malformed
      break
    }
    lastReport = judged.report
    fixedAfterLastCritic = false
    if (!('none' in shot)) {
      previousFrames = lastFrames
      lastFrames = shot.frames
      lastMetrics = shot.metrics
    }

    // The pairwise question again, swapped, in a step of its own (spec 9.2, step 4).
    if (judged.pairwise && previousFrames && lastFrames) {
      const first = judged.pairwise
      const current = lastFrames
      const before = previousFrames
      const swapped = await step.run(
        name(`pairwise-${round}`),
        async (): Promise<{ outcome: PairwiseOutcome } | { cap: string } | { skipped: string }> => {
          const cap = await overCap()
          if (cap) return { cap }
          const channel = await loopChannel(channelId)
          const version = await exemplarVersionById(db, versionId)
          if (!version) return { cap: 'the version is gone' }
          try {
            const answer = await pairwiseSwapped({
              channel,
              plan: criticPlanOf(version.code, derivedContext(entry, plan)),
              current,
              previous: before,
              complete,
            })
            const outcome = pairwiseOutcome(first, answer)
            await updateExemplarDraft(db, versionId, { pairwise: outcome })
            return { outcome }
          } catch (error) {
            if (error instanceof BudgetExceededError) return { cap: error.message }
            if (error instanceof ValidationError) return { skipped: error.message }
            return { skipped: failedWith(error) }
          }
        },
      )
      if ('cap' in swapped) return stopped(swapped.cap, versionId)
    }

    if (mock) break
    if (criticPasses(judged.report) && !(lastMetrics?.frozenCritical ?? false)) break
    if (judged.report.fixes.length === 0) break

    const fixed = await step.run(
      name(`fix-${round}`),
      async (): Promise<{ fixed: true } | { kept: string } | { cap: string }> => {
        const cap = await overCap()
        if (cap) return { cap }
        const version = await exemplarVersionById(db, versionId)
        if (!version) return { cap: 'the version is gone' }
        if (version.status !== 'draft') return { kept: 'the owner decided on the version' }
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
          return { kept: failedWith(error) }
        }
      },
    )
    if ('cap' in fixed) return stopped(fixed.cap, versionId)
    if ('kept' in fixed) break
    fixedAfterLastCritic = true
  }

  if (noFrames) return { state: 'no-frames', reason: noFrames, versionId }
  if (malformed) {
    return { state: 'failed', reason: `the critic's report was malformed: ${malformed}`, versionId }
  }

  // 7. The verify (step 7), on the frames of the code as it stands. A fix
  // after the last critic is photographed first; with nothing changed since
  // the last critic, its report is the verdict and no call is paid.
  if (!mock && fixedAfterLastCritic) {
    const finalShot = await photograph(derivation.rounds + 1)
    if ('none' in finalShot) return { state: 'no-frames', reason: finalShot.none, versionId }
    previousFrames = lastFrames
    lastFrames = finalShot.frames
    lastMetrics = finalShot.metrics
  }
  const framesForVerify = lastFrames
  const beforeVerify = previousFrames
  const metricsForVerify = lastMetrics
  const verified = await step.run(
    name('verify'),
    async (): Promise<
      { verify: CriticVerify } | { cap: string } | { malformed: string } | { failed: string }
    > => {
      const cap = await overCap()
      if (cap) return { cap }
      const version = await exemplarVersionById(db, versionId)
      if (!version) return { cap: 'the version is gone' }
      const channel = await loopChannel(channelId)
      const criticPlan = criticPlanOf(version.code, derivedContext(entry, plan))
      const prior = lastReport ?? mockCriticReport(criticPlan)
      if (mock) {
        const verify = mockCriticVerify(criticPlan, prior)
        await updateExemplarDraft(db, versionId, { verify })
        return { verify }
      }
      if (!fixedAfterLastCritic || !framesForVerify) {
        const passes = criticPasses(prior) && !(metricsForVerify?.frozenCritical ?? false)
        const verify: CriticVerify = {
          ...prior,
          priorDefects: prior.defects.map((_, index) => ({ index: index + 1, state: 'present' })),
          verdict: passes ? 'ready' : 'one-more-pass',
        }
        if (version.status === 'draft') await updateExemplarDraft(db, versionId, { verify })
        return { verify }
      }
      try {
        const { report } = await criticRound({
          channel,
          plan: criticPlan,
          slot: loopSlot(entry, plan),
          frames: framesForVerify,
          findings: [],
          metrics: metricsForVerify,
          references: [],
          ...(beforeVerify ? { previous: beforeVerify } : {}),
          verify: { prior, brief: VERIFY_BRIEF },
          strong: true,
          complete,
        })
        const verify = report as CriticVerify
        if (version.status === 'draft') {
          await updateExemplarDraft(db, versionId, { critique: verify, verify })
        }
        return { verify }
      } catch (error) {
        if (error instanceof BudgetExceededError) return { cap: error.message }
        if (error instanceof ValidationError) return { malformed: error.message }
        return { failed: failedWith(error) }
      }
    },
  )
  if ('cap' in verified) return stopped(verified.cap, versionId)
  if ('failed' in verified) return { state: 'failed', reason: verified.failed, versionId }
  if ('malformed' in verified) {
    return {
      state: 'failed',
      reason: `the critic's verify report was malformed: ${verified.malformed}`,
      versionId,
    }
  }
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
      // One technique's failure is its own (final review, issue 6): the rest still run.
      let outcome: TechniqueOutcome
      try {
        outcome = await deriveTechnique(step, derivation, technique)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        outcome = { state: 'failed', reason: reason.slice(0, 500), versionId: null }
      }
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

/**
 * A derivation cancelled outside the app (the Inngest dashboard, or a
 * second launch under the singleton) fires no failure handler, so its row
 * would stay running and the channel would wait forever (final review,
 * issue 1). Inngest emits `inngest/function.cancelled` with the triggering
 * event; the row is stopped with the spend so far.
 */
export const motionDerivationCancelled = inngest.createFunction(
  {
    id: CANCELLED_ID,
    name: 'A cancelled derivation is stopped',
    retries: 4,
    triggers: [{ event: 'inngest/function.cancelled' }],
  },
  async ({ event, step }) => {
    const data = (event.data ?? {}) as Record<string, unknown>
    const functionId = typeof data['function_id'] === 'string' ? data['function_id'] : ''
    if (!functionId.endsWith(FUNCTION_ID)) return { outcome: 'not-ours' as const }
    const original = data['event'] as { data?: Record<string, unknown> } | undefined
    const derivationId = original?.data?.['derivationId']
    if (typeof derivationId !== 'string') return { outcome: 'no-derivation' as const }
    const outcome = await step.run('stop', async () => {
      const row = await getDerivation(db, derivationId)
      if (!row) return 'unknown' as const
      if (row.state !== 'running') return 'already-closed' as const
      const spent = await jobSpendUsd(db, derivationId).catch(() => 0)
      await finishDerivation(db, derivationId, {
        state: 'stopped',
        spentUsd: spent,
        error: CANCELLED_OUTSIDE,
      })
      return 'stopped' as const
    })
    return { derivationId, outcome }
  },
)
