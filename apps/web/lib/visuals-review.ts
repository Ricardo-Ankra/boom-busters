import {
  latestScriptParagraphSources,
  listShotSlots,
  listVoiceTakes,
  slotNeedsResolution,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import {
  CANDIDATES_SHOWN,
  latestTakes,
  ShotBriefSchema,
  SlotCandidateSchema,
  visualsApprovalBlockedReason,
  visualsCoverage,
} from '@boom-busters/schemas'
import type {
  ShotBrief,
  ShotSlotStatus,
  SlotCandidate,
  VisualsCoverage,
} from '@boom-busters/schemas'
import { timedParagraphs } from '@/inngest/lib/shot-list'
import { stillSlotEstimateUsd } from './visual-assets'

/**
 * What the visual board shows, and what the visuals gate refuses on — one
 * model behind both, same rule as `lib/voice-review.ts` and for the same
 * reason: a disabled button and a server-side refusal that disagree are worse
 * than either alone.
 *
 * Briefs and candidates come out of jsonb through their schemas rather than
 * by cast. A brief that no longer parses renders as an ERROR CARD, never as a
 * chart — that is the spec's chart rule generalised: broken data must look
 * broken.
 */

export interface SlotView {
  id: string
  type: string
  status: ShotSlotStatus
  chapterIndex: number
  chapterTitle: string
  startMs: number
  durationMs: number
  /** `null` when the stored brief failed its schema — see `briefError`. */
  brief: ShotBrief | null
  briefError: string | undefined
  /** Top candidates, scored order, chosen first among equals. */
  candidates: SlotCandidate[]
  /** How many more were fetched than the strip shows. */
  extraCandidates: number
  /**
   * Whether the next fetch pass owes this slot work (staged-visuals design):
   * unresolved, or resolved for an older brief than the one it carries now.
   */
  needsFetch: boolean
}

export interface ChapterSlots {
  chapterIndex: number
  chapterTitle: string
  slots: SlotView[]
}

/** One paragraph of narration, for the scrubber: where it sits and what plays it. */
export interface NarrationSegment {
  takeId: string | null
  startMs: number
  durationMs: number
}

export interface VisualsReviewModel {
  chapters: ChapterSlots[]
  coverage: VisualsCoverage
  /**
   * Why Approve is refused, or `undefined` when it can proceed. Placeholders
   * deliberately do NOT appear here — they gate through the button's own
   * wording ("Approve with N placeholders"), which the action verifies by
   * count. This field is the unresolved-slots blocker only.
   */
  blockedReason: string | undefined
  /** Drives the approve button's explicit wording. */
  placeholders: number
  segments: NarrationSegment[]
  totalMs: number
  /**
   * Which visuals checkpoint the project sits at (staged-visuals design):
   * `plan` shows editable briefs and the Fetch button, `board` shows the
   * candidate strips, null means the stage has not run.
   */
  phase: 'plan' | 'board' | null
  /** How many slots the next fetch pass will actually touch. */
  toFetch: number
  /** The paid subset of `toFetch` — generated stills. */
  stillsToFetch: number
  /** What "Fetch visuals" will spend, in USD. Stills are the whole bill. */
  fetchEstimateUsd: number
}

/**
 * The shape for pages with no business paying visuals queries (decision 186):
 * the project page loads this instead of querying when neither the viewed
 * stage nor the project's own stage is `visuals`.
 */
export function emptyVisualsModel(): VisualsReviewModel {
  return {
    chapters: [],
    coverage: { slots: 0, resolved: 0, placeholder: 0, unresolved: 0 },
    blockedReason: undefined,
    placeholders: 0,
    segments: [],
    totalMs: 0,
    phase: null,
    toFetch: 0,
    stillsToFetch: 0,
    fetchEstimateUsd: 0,
  }
}

function parseCandidates(raw: unknown): SlotCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const parsed = SlotCandidateSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

export async function visualsReviewModel(
  db: Database,
  projectId: string,
  options: { phase?: 'plan' | 'board' | null } = {},
): Promise<VisualsReviewModel> {
  const [rows, sources, takes] = await Promise.all([
    listShotSlots(db, projectId),
    latestScriptParagraphSources(db, projectId),
    listVoiceTakes(db, projectId),
  ])

  const slots: SlotView[] = rows.map((row) => {
    const parsed = ShotBriefSchema.safeParse(row.brief)
    const candidates = parseCandidates(row.candidates)
    // Chosen first, then by score — the strip reads left to right as "what
    // will be used, then the alternatives, best first".
    const ordered = [...candidates].sort(
      (a, b) =>
        Number(b.chosen ?? false) - Number(a.chosen ?? false) || (b.score ?? -1) - (a.score ?? -1),
    )

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      chapterIndex: row.chapterIndex,
      chapterTitle: row.chapterTitle,
      startMs: row.startMs,
      durationMs: row.durationMs,
      brief: parsed.success ? parsed.data : null,
      briefError: parsed.success
        ? undefined
        : 'This brief no longer matches its schema and cannot be rendered or re-fetched as is.',
      candidates: ordered.slice(0, CANDIDATES_SHOWN),
      extraCandidates: Math.max(0, ordered.length - CANDIDATES_SHOWN),
      needsFetch: slotNeedsResolution(row),
    }
  })

  const chapters: ChapterSlots[] = []
  for (const slot of slots) {
    const group = chapters.find((chapter) => chapter.chapterIndex === slot.chapterIndex)
    if (group) group.slots.push(slot)
    else
      chapters.push({
        chapterIndex: slot.chapterIndex,
        chapterTitle: slot.chapterTitle,
        slots: [slot],
      })
  }

  /**
   * The scrubber's clock is the same clock the runner stamped the slots with:
   * `timedParagraphs` over the same chapters and takes. Recomputed here rather
   * than stored, so an edited script shows its drift instead of hiding it.
   */
  const paragraphs = timedParagraphs({ chapters: sources.chapters, takes })
  const current = latestTakes(takes)
  const takeByParagraph = new Map(
    current.map((take) => [`${take.chapterId}:${take.paragraphIndex}`, take]),
  )

  const segments: NarrationSegment[] = paragraphs.map((paragraph) => {
    const take = takeByParagraph.get(`${paragraph.chapterId}:${paragraph.index}`)
    return {
      takeId: take && take.r2Key !== null ? take.id : null,
      startMs: paragraph.startMs,
      durationMs: paragraph.durationMs,
    }
  })

  const coverage = visualsCoverage(slots)

  const toFetch = slots.filter((slot) => slot.needsFetch)
  const stillsToFetch = toFetch.filter((slot) => slot.type === 'still').length

  return {
    chapters,
    coverage,
    // Acknowledged := the actual count, so ONLY the unresolved blocker
    // surfaces here; the placeholder consent happens at the button.
    blockedReason: visualsApprovalBlockedReason(slots, coverage.placeholder),
    placeholders: coverage.placeholder,
    segments,
    totalMs: segments.reduce((total, segment) => total + segment.durationMs, 0),
    phase: options.phase ?? null,
    toFetch: toFetch.length,
    stillsToFetch,
    fetchEstimateUsd: stillsToFetch > 0 ? stillsToFetch * (await stillSlotEstimateUsd()) : 0,
  }
}
