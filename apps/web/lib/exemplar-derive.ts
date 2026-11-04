import type { ExemplarEntry, ScriptClaim } from '@boom-busters/providers'
import { mechanismName, type ExemplarPlan } from '@boom-busters/schemas'
import type { ChartBrief, DesignableBrief, GraphicBrief } from '@boom-busters/schemas'
import type { planIssue } from '@boom-busters/schemas'
import { EXEMPLAR_LOGO, EXEMPLAR_PROJECT_ID } from '@/lib/exemplar-translate'
import { DENSE_SHOTS_MAX, denseMoments } from '@/lib/graphic-code/frames'
import type { GraphicDesignContext, GraphicSlotTiming } from '@/lib/graphic-design-core'

/**
 * What a derivation designs against (spec 2026-11-04, section 9.2): the
 * plan's rewritten slot as a context, a brief and a slot, exactly as the
 * corpus does for the catalogue's own slot (`exemplar-translate.ts`), so
 * the designer's checks, the dry run and the browser read a derived
 * version as they read a stored one. Pure: no database, no network.
 */

/** A ULID-shaped id for the n-th derived claim. */
const claimId = (n: number) => `01J${String(n).padStart(23, '0')}`

/** One claim per figure the plan speaks and per charted point, as the corpus builds them. */
export function derivedContext(entry: ExemplarEntry, plan: ExemplarPlan): GraphicDesignContext {
  const texts: string[] = []
  for (const word of plan.slot.words) {
    const figure = word.text.replace(/^[^\d$€£]+|[^\w%]+$/g, '')
    if (/\d/.test(figure)) texts.push(`The figure is ${figure}.`)
  }
  for (const series of plan.slot.data?.series ?? []) {
    for (const point of series.points) {
      texts.push(`In ${point.x} the value was ${point.y} ${series.unit}.`)
    }
  }
  const claims: ScriptClaim[] = [...new Set(texts)].map((text, index) => ({
    id: claimId(index + 1),
    text,
    sourceUrl: null,
    confidence: 'high',
  }))
  return {
    projectId: EXEMPLAR_PROJECT_ID,
    caseTitle: 'Exemplar',
    claims,
    logos: [EXEMPLAR_LOGO],
    paragraphs: [],
    chapterTitle: entry.technique,
  }
}

/** The brief the checks run against: a chart brief for a chart technique with data, a graphic brief otherwise. */
export function derivedBrief(
  entry: ExemplarEntry,
  plan: ExemplarPlan,
  context: GraphicDesignContext,
): DesignableBrief {
  const coversText = plan.slot.words.map((word) => word.text).join(' ')
  const claimIds = context.claims.map((claim) => claim.id)
  if (entry.chart && plan.slot.data) {
    const chart: ChartBrief = {
      type: 'chart',
      coversText,
      description: entry.description,
      motion: { kind: 'static' },
      transition: 'cut',
      chartKind: entry.chart.kind,
      series: plan.slot.data.series,
      dataRefs: claimIds,
      takeaway: plan.slot.data.takeaway,
      reveal: 'draw-on',
      ...(plan.slot.data.annotations ? { annotations: plan.slot.data.annotations } : {}),
    }
    return chart
  }
  const graphic: GraphicBrief = {
    type: 'graphic',
    coversText,
    description: entry.description,
    motion: { kind: 'static' },
    transition: 'cut',
    intent: plan.slot.intent,
    intentClaimIds: claimIds,
  }
  return graphic
}

export function derivedSlot(
  entry: ExemplarEntry,
  plan: ExemplarPlan,
  context: GraphicDesignContext,
): GraphicSlotTiming & { brief: DesignableBrief } {
  return {
    chapterId: 'exemplar',
    startMs: 0,
    durationMs: entry.slot.durationMs,
    brief: derivedBrief(entry, plan, context),
  }
}

/** The bounds the storyboard's rewrite is held to (`planIssue`). */
export function planBounds(entry: ExemplarEntry): Parameters<typeof planIssue>[1] {
  const series = entry.chart && entry.slot.data ? entry.slot.data.series : null
  return {
    durationMs: entry.slot.durationMs,
    wordCount: entry.slot.words.length,
    ...(series ? { chart: { series: series.length, points: series[0]?.points.length ?? 0 } } : {}),
  }
}

/** A frame at 24 per second, as the spec counts the dense steps. */
const FRAME_MS = 1000 / 24
const STEPS_PER_MOMENT = 4

/**
 * The dense moments for a derivation (spec 9.2, step 3): four shots a frame
 * apart from each storyboard line's time, inside the slot, at most
 * `DENSE_SHOTS_MAX`; the even set when no line is timed.
 */
export function storyboardMoments(storyboard: readonly string[], durationMs: number): number[] {
  const times = storyboard
    .map((line) => /^\s*(\d+(?:\.\d+)?)\s*s\b/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Math.round(Number(match[1]) * 1000))
  if (times.length === 0) return denseMoments(durationMs)
  const moments = new Set<number>()
  for (const at of times) {
    for (let step = 0; step < STEPS_PER_MOMENT; step += 1) {
      const moment = Math.round(at + step * FRAME_MS)
      if (moment >= 0 && moment < durationMs) moments.add(moment)
    }
  }
  return [...moments].sort((a, b) => a - b).slice(0, DENSE_SHOTS_MAX)
}

/** The plan as the producer's steer: the build keeps to it. */
export function planSteer(plan: ExemplarPlan): string {
  const storyboard = plan.storyboard.map((line, index) => `${index + 1}. ${line}`).join(' ')
  const mechanisms =
    plan.mechanisms.length > 0 ? `; built on: ${plan.mechanisms.map(mechanismName).join(', ')}` : ''
  return `The plan to build, as agreed: concept ${plan.concept}. Storyboard: ${storyboard}${mechanisms}. Keep to it.`
}

/** The refine's steer: the owner's words first, then what is kept, then the plan. */
export function refineSteer(steer: string, plan: ExemplarPlan): string {
  return `The producer's steer: ${steer}\nWhat the steer does not name is kept exactly as it is.\n${planSteer(plan)}`
}
