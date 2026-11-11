import { graphicBrand } from '@boom-busters/compositions/graphic-code-pure'
import type { GraphicProps } from '@boom-busters/compositions/graphic-code-pure'
import { getChannel } from '@boom-busters/db'
import {
  buildCriticRequest,
  buildPairwiseRequest,
  exemplarFor,
  parseCriticReport,
  parseCriticVerify,
  parsePairwise,
  type CriticInput,
  type CriticPlan,
  type CriticReference,
  type Exemplar,
  type TechniqueEntry,
  type MsgImage,
  type ReviewFrame,
} from '@boom-busters/providers'
import {
  resolveBrandKit,
  resolveMotionIdentity,
  ValidationError,
  isHouseTechnique,
} from '@boom-busters/schemas'
import type {
  BibleInUse,
  CriticReport,
  CriticVerify,
  ExemplarFrames,
  ExemplarPlan,
  GraphicCode,
  MotionIdentity,
  MotionMetrics,
  PairwiseAnswer,
  TechniqueKey,
} from '@boom-busters/schemas'
import type { AnswerRetry } from '@/lib/answer'
import { db } from '@/lib/db'
import { derivedContext, derivedSlot, storyboardMoments } from '@/lib/exemplar-derive'
import { exemplarFrameKey, exemplarSheetKey } from '@/lib/exemplar-keys'
import type { GraphicFrames } from '@/lib/graphic-code/frames'
import {
  designGraphicWith,
  GRAPHIC_DESIGN_DEADLINE_MS,
  photographForCritic,
  type GraphicCompleteFn,
  type GraphicDesignResult,
} from '@/lib/graphic-design-core'
import { callLlm } from '@/lib/llm'
import { imageForModel } from '@/lib/reference-images'
import { getObjectBytes, putObject, storageConfigured } from '@/lib/storage'
import { requireCompleteBible } from './channel'

/**
 * The pieces the deriver and the refiner share (spec 2026-11-04, sections
 * 9.2 and 9.3): the channel as the loop reads it, the ledgered call with
 * the job's id in its meta, the build from a plan, the photograph stored
 * under the version's keys, and the critic's round read back from storage.
 */

/**
 * The critic's and the pairwise's abort: a call with images that answers
 * nothing in four minutes is lost. Each runs in a step of its own, so this
 * leaves a minute of the 300 s step for the reads around it. Four, not two,
 * since the critic may think over 16,000 tokens (decision 450).
 */
export const CRITIC_CALL_MS = 240_000
/** The rest shots a version keeps; the dense set lives on the sheets. */
const SHOTS_KEPT = 16

export interface LoopChannel {
  channelId: string
  motion: MotionIdentity
  bible: BibleInUse
  brand: GraphicProps['brand']
  log: (line: string) => void
}

export async function loopChannel(channelId: string): Promise<LoopChannel> {
  const channel = await getChannel(db, channelId)
  const inUse = requireCompleteBible(channel)
  return {
    channelId,
    motion: resolveMotionIdentity(channel.settings),
    bible: inUse,
    brand: graphicBrand(resolveBrandKit(channel.settings)),
    log: (line) => {
      const text = `[exemplars] ${channel.slug}: ${line}`
      if (/failed|without the browser/.test(line)) console.error(text)
      else console.warn(text)
    },
  }
}

/** The ledgered call for a job: the channel's spend, with the job and the technique in the row's meta. */
export function completeForJob(
  channelId: string,
  jobId: string,
  technique: TechniqueKey,
): GraphicCompleteFn {
  return (request, options) =>
    callLlm(request, { channelId, ...options, meta: { jobId, technique } })
}

/** The critic's slot for a plan: its words on the offset clock. */
export function loopSlot(entry: TechniqueEntry, plan: ExemplarPlan): CriticInput['slot'] {
  return {
    durationMs: entry.slot.durationMs,
    intent: plan.slot.intent,
    words: plan.slot.words.map((word) => ({ text: word.text, offsetMs: word.atMs })),
  }
}

/**
 * The build (spec 9.2, step 2) and the fix (step 5): the designer's call
 * and ladder on the plan's slot, the house exemplar pinned for mechanics,
 * the plan as the steer; with `current`, a redesign of that code.
 */
export async function buildFromPlan(input: {
  channel: LoopChannel
  entry: TechniqueEntry
  plan: ExemplarPlan
  current?: GraphicCode
  guidance: string
  complete: GraphicCompleteFn
  frames?: GraphicFrames
  /**
   * The exemplar to pin (spec 8.5): given, used as is (null for none);
   * absent, the house design for a house key, and none for a channel's own.
   */
  exemplar?: Exemplar | null
  /** One answer only, the retry it earns handed back (decision 461). */
  firstOnly?: boolean
  /** Only the retry an earlier step's first answer earned (decision 461). */
  resume?: AnswerRetry
}): Promise<GraphicDesignResult> {
  const { channel, entry, plan } = input
  const exemplar =
    input.exemplar !== undefined
      ? input.exemplar
      : isHouseTechnique(entry.technique)
        ? (exemplarFor(entry.technique) ?? null)
        : null
  const context = derivedContext(entry, plan)
  const slot = derivedSlot(entry, plan, context)
  const brief = input.current ? { ...slot.brief, code: input.current } : slot.brief
  return designGraphicWith(
    input.complete,
    context,
    { ...slot, brief },
    {
      bible: channel.bible,
      motion: channel.motion,
      guidance: input.guidance,
      exemplar,
      ...(input.current ? { redesign: true } : {}),
      ...(input.firstOnly ? { firstOnly: true } : {}),
      ...(input.resume ? { resume: input.resume } : {}),
      ...(input.frames ? { frames: input.frames } : {}),
      brand: channel.brand,
      log: channel.log,
    },
  )
}

/**
 * The frames (spec 9.2, step 3): the rest shots and the dense moments four
 * a frame apart from each storyboard line, both sheets, stored under the
 * version's round. Without them, the reason (decision 445): no storage to
 * keep them, or the browser's own.
 */
export async function photographVersion(input: {
  channel: LoopChannel
  entry: TechniqueEntry
  plan: ExemplarPlan
  versionId: string
  round: number
  code: GraphicCode
  frames: GraphicFrames
}): Promise<
  { frames: ExemplarFrames; findings: string[]; metrics: MotionMetrics | null } | { none: string }
> {
  if (!storageConfigured()) return { none: 'no storage to keep the frames' }
  const { channel, entry, plan } = input
  const context = derivedContext(entry, plan)
  const slot = derivedSlot(entry, plan, context)
  const shot = await photographForCritic(context, slot, input.code, {
    frames: input.frames,
    brand: channel.brand,
    log: channel.log,
    motion: channel.motion,
    dense: storyboardMoments(plan.storyboard, entry.slot.durationMs),
    deadline: Date.now() + GRAPHIC_DESIGN_DEADLINE_MS,
  })
  if ('none' in shot) return shot
  const { photographed, metrics } = shot
  const keyInput = { channelId: channel.channelId, versionId: input.versionId, round: input.round }
  const shots: ExemplarFrames['shots'] = []
  for (const frame of photographed.shots.slice(0, SHOTS_KEPT)) {
    const key = exemplarFrameKey({ ...keyInput, orientation: frame.orientation, atMs: frame.atMs })
    await putObject(key, Buffer.from(frame.jpeg, 'base64'), 'image/jpeg')
    shots.push({ orientation: frame.orientation, atMs: frame.atMs, r2Key: key })
  }
  const sheets: ExemplarFrames['sheets'] = {}
  for (const orientation of ['landscape', 'portrait'] as const) {
    const sheet = photographed.sheets[orientation]
    if (!sheet) continue
    const key = exemplarSheetKey({ ...keyInput, orientation })
    await putObject(key, Buffer.from(sheet, 'base64'), 'image/jpeg')
    sheets[orientation] = key
  }
  return { frames: { shots, sheets, round: input.round }, findings: photographed.findings, metrics }
}

const image = async (key: string): Promise<MsgImage> => imageForModel(await getObjectBytes(key))

async function sheetImages(frames: ExemplarFrames): Promise<CriticInput['sheets']> {
  return {
    ...(frames.sheets.landscape ? { landscape: await image(frames.sheets.landscape) } : {}),
    ...(frames.sheets.portrait ? { portrait: await image(frames.sheets.portrait) } : {}),
  }
}

const frameLabel = (shot: ExemplarFrames['shots'][number]) =>
  `${shot.orientation === 'landscape' ? '16:9' : '9:16'} at ${(shot.atMs / 1000).toFixed(1)} s`

/**
 * One critic round (spec 9.2, steps 4 and 7): the images read back from
 * storage, the previous round's sheets when given (with the pairwise
 * question), the verify ask when given, the strong route when asked.
 */
export async function criticRound(input: {
  channel: LoopChannel
  plan: CriticPlan
  slot: CriticInput['slot']
  frames: ExemplarFrames
  findings: readonly string[]
  metrics: MotionMetrics | null
  references: readonly CriticReference[]
  previous?: ExemplarFrames
  verify?: CriticInput['verify']
  strong?: boolean
  complete: GraphicCompleteFn
}): Promise<{ report: CriticReport | CriticVerify; pairwise: PairwiseAnswer | null }> {
  const frames: ReviewFrame[] = []
  for (const shot of input.frames.shots) {
    frames.push({ label: frameLabel(shot), image: await image(shot.r2Key) })
  }
  const request = buildCriticRequest({
    motion: input.channel.motion,
    plan: input.plan,
    slot: input.slot,
    metrics: input.metrics,
    findings: input.findings,
    sheets: await sheetImages(input.frames),
    frames,
    references: input.references,
    ...(input.previous
      ? {
          previous: {
            sheets: await sheetImages(input.previous),
            label: `round ${input.previous.round}`,
          },
        }
      : {}),
    ...(input.verify ? { verify: input.verify } : {}),
    ...(input.strong ? { strong: true } : {}),
  })
  const reply = await input.complete(request, {
    signal: AbortSignal.timeout(CRITIC_CALL_MS),
    purpose: input.verify ? 'verify' : 'critic',
  })
  const report = input.verify ? parseCriticVerify(reply.text) : parseCriticReport(reply.text)
  let pairwise: PairwiseAnswer | null = null
  if (input.previous) {
    try {
      pairwise = parsePairwise(reply.text)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      input.channel.log(`the critic answered no pairwise preference: ${error.message}`)
    }
  }
  return { report, pairwise }
}

/** The pairwise question asked again with the order swapped: A the previous version, B the current. */
export async function pairwiseSwapped(input: {
  channel: LoopChannel
  plan: CriticPlan
  current: ExemplarFrames
  previous: ExemplarFrames
  complete: GraphicCompleteFn
}): Promise<PairwiseAnswer> {
  const request = buildPairwiseRequest({
    motion: input.channel.motion,
    plan: input.plan,
    a: await sheetImages(input.previous),
    b: await sheetImages(input.current),
  })
  const reply = await input.complete(request, {
    signal: AbortSignal.timeout(CRITIC_CALL_MS),
    purpose: 'pairwise',
  })
  return parsePairwise(reply.text)
}
