'use server'

/**
 * The Exemplars tab's and the Derive section's actions (spec 2026-11-04,
 * sections 9.1, 9.3, 9.4 and 11): a derivation launched with the cap the
 * owner typed, a refine from the approved version under a steer, approve,
 * keep the approved one, restore a retired version, and the copy of
 * another channel's motion. Every verdict the owner gives writes its row
 * to the preference ledger. A paid job starts only from these buttons.
 */

import {
  approveExemplarVersion,
  approvedExemplar,
  channelTechniquesFor,
  copyMotionFromChannel,
  createDerivation,
  exemplarVersionById,
  finishDerivation,
  getChannelSettings,
  getDerivation,
  latestDerivation,
  listChannelExemplars,
  recordVerdict,
  retireExemplarDrafts,
  runningDerivation,
  syncChannelTechniqueInUse,
  updateChannelSettings,
} from '@boom-busters/db'
import type { MotionDerivationRow } from '@boom-busters/db'
import {
  DeriveRequestSchema,
  ExemplarSteerSchema,
  UlidSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { DerivationProgress, DerivationProposal, DerivationState } from '@boom-busters/schemas'
import { jobSpendUsd } from '@boom-busters/cost'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { channelWriteRefusal, findChannel } from '@/lib/channel-lookup'
import { db } from '@/lib/db'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import type { ActionResult } from './actions'

const UNKNOWN_CHANNEL: ActionResult = { ok: false, error: 'Unknown channel' }
const UNKNOWN_VERSION: ActionResult = { ok: false, error: 'That version is gone.' }
const JOB_RUNNING: ActionResult = { ok: false, error: 'A derivation is running on this channel' }
const INNGEST_DOWN =
  'Could not reach Inngest. Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.'

/** What the tab shows of the latest derivation. */
export interface DerivationView {
  id: string
  state: DerivationState
  techniques: string[]
  rounds: number
  capUsd: number
  spentUsd: number
  progress: DerivationProgress
  /** "Propose a technique" was ticked (spec 8.5), and what the propose step did. */
  propose: boolean
  proposal: DerivationProposal | null
  error: string | null
  createdAt: string
  finishedAt: string | null
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

function refresh(): void {
  revalidatePath('/c/[slug]', 'layout')
}

/** The channel checks every action starts with, or the refusal. */
async function channelGate(channelId: string): Promise<ActionResult | null> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return UNKNOWN_CHANNEL
  return channelWriteRefusal(channelId)
}

/** The version the action names, when it belongs to the channel. */
async function ownVersion(channelId: string, id: string) {
  if (!UlidSchema.safeParse(id).success) return null
  const row = await exemplarVersionById(db, id)
  return row && row.channelId === channelId ? row : null
}

async function jobRunning(channelId: string): Promise<boolean> {
  return (await runningDerivation(db, channelId)) !== null
}

function derivationView(row: MotionDerivationRow): DerivationView {
  return {
    id: row.id,
    state: row.state,
    techniques: row.techniques,
    rounds: row.rounds,
    capUsd: Number(row.capUsd),
    spentUsd: Number(row.spentUsd),
    progress: row.progress,
    propose: row.propose,
    proposal: row.proposal,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

/** "Derive exemplars" (spec 9.1): the row, then the event; a failed send marks the row failed. */
export async function deriveExemplarsAction(
  channelId: string,
  input: unknown,
): Promise<ActionResult & { derivationId?: string }> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const parsed = DeriveRequestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Tick at least one technique, choose 1 to 5 rounds and type a cap.' }
  }
  if (await jobRunning(channelId)) return JOB_RUNNING
  const row = await createDerivation(db, { channelId, ...parsed.data })
  try {
    await inngest.send(events.motionExemplarsDerive.create({ channelId, derivationId: row.id }))
  } catch (error) {
    console.error('[exemplars] could not send the derivation', error)
    await finishDerivation(db, row.id, { state: 'failed', spentUsd: 0, error: INNGEST_DOWN })
    return { ok: false, error: INNGEST_DOWN }
  }
  refresh()
  return { ok: true, derivationId: row.id }
}

/** "Refine" (spec 9.3): the approved version, or the latest draft when none is approved. */
export async function refineExemplarAction(
  channelId: string,
  parentId: string,
  steer: unknown,
): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const parsedSteer = ExemplarSteerSchema.safeParse(steer)
  if (!parsedSteer.success) {
    return { ok: false, error: 'Write the steer in plain words, under 500 characters.' }
  }
  const parent = await ownVersion(channelId, parentId)
  if (!parent) return UNKNOWN_VERSION
  const approved = await approvedExemplar(db, channelId, parent.technique)
  if (approved && approved.id !== parent.id) {
    return { ok: false, error: 'Refine the approved version of this technique.' }
  }
  if (!approved) {
    const [latestDraft] = (await listChannelExemplars(db, channelId)).filter(
      (row) => row.technique === parent.technique && row.status === 'draft',
    )
    if (latestDraft && latestDraft.id !== parent.id) {
      return { ok: false, error: 'Refine the latest draft of this technique.' }
    }
  }
  if (await jobRunning(channelId)) return JOB_RUNNING
  await recordVerdict(db, {
    channelId,
    kind: 'steer',
    exemplarId: parent.id,
    steer: parsedSteer.data,
  })
  try {
    await inngest.send(
      events.motionExemplarRefine.create({
        channelId,
        parentId: parent.id,
        steer: parsedSteer.data,
      }),
    )
  } catch (error) {
    console.error('[exemplars] could not send the refine', error)
    return { ok: false, error: INNGEST_DOWN }
  }
  refresh()
  return { ok: true }
}

/** "Approve this": a draft with a parent is a preference over it; else a plain approve. */
export async function approveExemplarVersionAction(
  channelId: string,
  versionId: string,
): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const version = await ownVersion(channelId, versionId)
  if (!version) return UNKNOWN_VERSION
  if (version.status === 'approved') return { ok: true }
  // A build the layout check refused is kept to refine, never to approve (decision 445).
  if (version.refusal) {
    return {
      ok: false,
      error: `The layout check refused this version (${version.refusal}). Refine it first.`,
    }
  }
  // The preference is against the version it was shown beside: the one
  // approved at this moment, else its parent (final review, issue 7).
  const shownAgainst =
    (await approvedExemplar(db, channelId, version.technique))?.id ?? version.parentId
  await approveExemplarVersion(db, version.id)
  // The other drafts waiting on it are settled too, or the next would take this one's place (decision 452).
  await retireExemplarDrafts(db, channelId, version.technique)
  // A channel's own technique is in use once approved (spec 8.5).
  await syncChannelTechniqueInUse(db, channelId, version.technique)
  await recordVerdict(db, {
    channelId,
    kind: version.parentId ? 'prefer' : 'approve',
    exemplarId: version.id,
    ...(version.parentId && shownAgainst ? { comparison: { a: version.id, b: shownAgainst } } : {}),
  })
  refresh()
  return { ok: true }
}

/** "Keep the approved one": the draft retires, the approved version stays. */
export async function keepApprovedAction(
  channelId: string,
  draftId: string,
): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const draft = await ownVersion(channelId, draftId)
  if (!draft) return UNKNOWN_VERSION
  if (draft.status !== 'draft') return { ok: false, error: 'Only a draft can be set aside.' }
  const approved = await approvedExemplar(db, channelId, draft.technique)
  // Every draft waiting on the technique, not only the one shown: refines pile up, and the
  // next one up looked like the same draft still waiting (decision 452).
  await retireExemplarDrafts(db, channelId, draft.technique)
  // A channel's own key leaves the techniques in use when no approved version remains (spec 8.5);
  // keep never puts back a key the owner unticked (final review, issue 1).
  await syncChannelTechniqueInUse(db, channelId, draft.technique, { mode: 'remove-only' })
  await recordVerdict(db, {
    channelId,
    kind: 'keep-approved',
    exemplarId: approved?.id ?? null,
    ...(approved ? { comparison: { a: approved.id, b: draft.id } } : {}),
  })
  refresh()
  return { ok: true }
}

/** "Restore" on a retired version: approved again, the current approved retires. */
export async function restoreExemplarVersionAction(
  channelId: string,
  versionId: string,
): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const version = await ownVersion(channelId, versionId)
  if (!version) return UNKNOWN_VERSION
  if (version.status !== 'retired')
    return { ok: false, error: 'Only a retired version is restored.' }
  await approveExemplarVersion(db, version.id)
  await syncChannelTechniqueInUse(db, channelId, version.technique)
  await recordVerdict(db, { channelId, kind: 'approve', exemplarId: version.id })
  refresh()
  return { ok: true }
}

/** "Copy motion from another channel" (spec 9.4): the identity, the references and the approved exemplars, a fork. */
export async function copyMotionFromChannelAction(
  channelId: string,
  sourceChannelId: string,
): Promise<ActionResult & { note?: string }> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  if (!UlidSchema.safeParse(sourceChannelId).success) return UNKNOWN_CHANNEL
  if (sourceChannelId === channelId) return { ok: false, error: 'Choose another channel' }
  const source = await findChannel(sourceChannelId)
  if (!source) return UNKNOWN_CHANNEL
  if (await jobRunning(channelId)) return JOB_RUNNING
  let copied: Awaited<ReturnType<typeof copyMotionFromChannel>>
  try {
    // The rows first: a refused copy leaves the identity as it was.
    copied = await copyMotionFromChannel(db, channelId, sourceChannelId)
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, error: error.message }
    throw error
  }
  const motion = (await getChannelSettings(db, sourceChannelId)).motion
  // The source's identity, with this channel's own techniques still in use
  // (spec 8.5): the copy retires only the techniques the source has, so the
  // target's approved versions of its own keep their place.
  const own = (await channelTechniquesFor(db, channelId)).map((entry) => entry.technique)
  const techniques = [
    ...motion.techniques,
    ...own.filter((key) => !motion.techniques.includes(key)),
  ]
  await updateChannelSettings(db, channelId, { motion: { ...motion, techniques } })
  refresh()
  return {
    ok: true,
    note: `Copied the identity, ${copied.references} references and ${copied.exemplars} exemplars`,
  }
}

/** The latest derivation, for the Derive section's poll. */
const NOT_RUNNING: ActionResult = { ok: false, error: 'That derivation is not running.' }
const STOPPED_HERE = 'Stopped from the Derive section'

/**
 * "Stop the derivation" (decision 445): the stop event cancels the run
 * between steps, so the call in flight finishes and is paid; then the row is
 * closed with the spend so far, which frees the channel for the next launch.
 * Drafts already stored stay. A stop that cannot be sent leaves it running.
 */
export async function stopDerivationAction(
  channelId: string,
  derivationId: string,
): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  if (!UlidSchema.safeParse(derivationId).success) return NOT_RUNNING
  const row = await getDerivation(db, derivationId)
  if (!row || row.channelId !== channelId || row.state !== 'running') return NOT_RUNNING
  try {
    await inngest.send(events.motionExemplarsDeriveStop.create({ channelId, derivationId }))
  } catch (error) {
    console.error('[exemplars] could not send the stop', error)
    return { ok: false, error: INNGEST_DOWN }
  }
  const spent = await jobSpendUsd(db, derivationId).catch(() => 0)
  await finishDerivation(db, derivationId, {
    state: 'stopped',
    spentUsd: spent,
    error: STOPPED_HERE,
  })
  refresh()
  return { ok: true }
}

export async function latestDerivationAction(
  channelId: string,
): Promise<ActionResult & { derivation?: DerivationView }> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return UNKNOWN_CHANNEL
  const row = await latestDerivation(db, channelId)
  return { ok: true, ...(row ? { derivation: derivationView(row) } : {}) }
}
