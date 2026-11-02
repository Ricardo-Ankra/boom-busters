import { z } from 'zod'
import { UlidSchema } from './ids'
import { TeaserFetchStateSchema } from './script'
import {
  CropFocusSchema,
  PointShotMotionSchema,
  SHORT_PHASES,
  SHORT_RULES,
  ShortPhaseSchema,
  ShortTypeSchema,
} from './short-rules'
import { TimelineSlotSchema } from './timeline'
import { SlotCandidateSchema } from './visuals'
import { WordTimingSchema } from './voice'

/**
 * Talking points and the per-point records a playbook Short keeps (spec
 * sections 2, 3.2 and 4). A point is a question the approved script already
 * answers; its Short pays that answer off and bridges to chapters the long
 * form actually contains.
 */

const talkingPointFields = {
  type: ShortTypeSchema,
  title: z.string().min(3).max(90),
  question: z.string().min(10).max(300),
  payoff: z.string().min(10).max(400),
  bridge: z.string().min(10).max(400),
  bridgeChapters: z.array(z.number().int().min(0)).min(1),
  sourceChapters: z.array(z.number().int().min(0)).min(1),
  hook: z.string().min(5).max(300),
  order: z.number().int().min(1),
}

/** What a model returns: a point before it has an identity. */
export const TalkingPointDraftSchema = z.object(talkingPointFields)
export type TalkingPointDraft = z.infer<typeof TalkingPointDraftSchema>

export const TalkingPointSchema = z.object({ id: UlidSchema, ...talkingPointFields })
export type TalkingPoint = z.infer<typeof TalkingPointSchema>

function normaliseQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Empty when the set is a usable proposal; otherwise one plain sentence per problem. */
export function talkingPointSetIssues(
  points: readonly TalkingPointDraft[],
  chapterCount: number,
): string[] {
  const issues: string[] = []
  const n = points.length
  if (n < SHORT_RULES.pointsMin || n > SHORT_RULES.pointsMax) {
    issues.push(
      `${n} talking points; the set needs ${SHORT_RULES.pointsMin} to ${SHORT_RULES.pointsMax}`,
    )
  }
  if (
    points.some((p) => [...p.sourceChapters, ...p.bridgeChapters].some((c) => c >= chapterCount))
  ) {
    issues.push(`a chapter index points past the last chapter (${chapterCount} chapters)`)
  }
  if (new Set(points.map((p) => p.type)).size < 2) {
    issues.push('the points need at least two different types')
  }
  const questions = points.map((p) => normaliseQuestion(p.question))
  if (new Set(questions).size < questions.length) {
    issues.push('two points ask the same question')
  }
  const leads = new Map<number, number>()
  for (const p of points) {
    const lead = p.sourceChapters[0]
    if (lead !== undefined) leads.set(lead, (leads.get(lead) ?? 0) + 1)
  }
  if ([...leads.values()].some((count) => count > 2)) {
    issues.push('one chapter leads more than two points')
  }
  const orders = points.map((p) => p.order).sort((a, b) => a - b)
  if (orders.some((order, i) => order !== i + 1)) {
    issues.push(`order values must be exactly 1 to ${n}`)
  }
  return issues
}

export const PointScriptParagraphSchema = z.object({
  phase: ShortPhaseSchema,
  text: z.string().min(10).max(400),
  chapterIndex: z.number().int().min(0),
})
export type PointScriptParagraph = z.infer<typeof PointScriptParagraphSchema>

export const PointScriptSchema = z.object({
  title: z.string().min(3).max(90),
  paragraphs: z.array(PointScriptParagraphSchema).min(5).max(12),
})
export type PointScript = z.infer<typeof PointScriptSchema>

export function pointScriptIssues(script: PointScript, chapterCount: number): string[] {
  const issues: string[] = []
  const present = new Set(script.paragraphs.map((p) => p.phase))
  for (const phase of SHORT_PHASES) {
    if (!present.has(phase)) issues.push(`the script has no ${phase} paragraph`)
  }
  let last = -1
  let ordered = true
  for (const p of script.paragraphs) {
    const at = SHORT_PHASES.indexOf(p.phase)
    if (at < last) ordered = false
    last = Math.max(last, at)
  }
  if (!ordered) issues.push(`paragraphs must run in order: ${SHORT_PHASES.join(', ')}`)
  if (script.paragraphs.some((p) => p.chapterIndex >= chapterCount)) {
    issues.push(`a paragraph cites a chapter past the last chapter (${chapterCount} chapters)`)
  }
  return issues
}

export const PointScriptRecordSchema = PointScriptSchema.extend({
  scriptVersion: z.number().int().min(1),
  pointId: UlidSchema,
})
export type PointScriptRecord = z.infer<typeof PointScriptRecordSchema>

export const PointVoiceParagraphSchema = z.object({
  /** teaserTextHash of the paragraph text: the digest the TTS key carries. */
  textHash: z.string().regex(/^[0-9a-f]{12}$/),
  r2Key: z.string().min(1),
  durationMs: z.number().int().positive(),
  wordTimings: z.array(WordTimingSchema).nullable(),
})
export type PointVoiceParagraph = z.infer<typeof PointVoiceParagraphSchema>

export const PointVoiceRecordSchema = z.object({
  scriptVersion: z.number().int().min(1),
  paragraphs: z.array(PointVoiceParagraphSchema).min(1).max(12),
})
export type PointVoiceRecord = z.infer<typeof PointVoiceRecordSchema>

export const PointPendingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stock'), query: z.string().min(2).max(200) }),
  z.object({ kind: z.literal('still'), prompt: z.string().min(4).max(2000) }),
])
export type PointPending = z.infer<typeof PointPendingSchema>

export const PointPlanShotSchema = z
  .object({
    startWord: z.number().int().min(0),
    crop: CropFocusSchema,
    motion: PointShotMotionSchema,
    slot: TimelineSlotSchema.nullable(),
    pending: PointPendingSchema.nullable(),
  })
  .refine((shot) => (shot.slot === null) !== (shot.pending === null), {
    message: 'a shot carries exactly one of slot and pending',
    path: ['slot'],
  })
export type PointPlanShot = z.infer<typeof PointPlanShotSchema>

export const PointPlanRecordSchema = z.object({
  shots: z.array(PointPlanShotSchema).min(1).max(40),
  plannedFor: z.object({
    scriptVersion: z.number().int(),
    voiceHash: z.string(),
  }),
})
export type PointPlanRecord = z.infer<typeof PointPlanRecordSchema>

export const PointFetchesRecordSchema = z.object({
  candidates: z.array(SlotCandidateSchema).max(60),
  state: TeaserFetchStateSchema.nullable(),
})
export type PointFetchesRecord = z.infer<typeof PointFetchesRecordSchema>
