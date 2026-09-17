import {
  getProject,
  latestScriptParagraphSources,
  listCastMembers,
  listShotSlots,
  listVoiceTakes,
  slotNeedsResolution,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { BANNED_PROMPT_WORDS } from '@boom-busters/providers'
import {
  CANDIDATES_SHOWN,
  DirectorsBookSchema,
  latestTakes,
  castWarnings,
  planWarnings,
  ShotBriefSchema,
  SlotCandidateSchema,
  SlotRefusalSchema,
  SlotRetypeStateSchema,
  visualsApprovalBlockedReason,
  visualsCoverage,
} from '@boom-busters/schemas'
import type {
  DirectorsBook,
  ShotBrief,
  ShotSlotStatus,
  SlotCandidate,
  SlotRefusal,
  SlotRetypeState,
  VisualsCoverage,
} from '@boom-busters/schemas'
import { anchoredTimes, timedParagraphs } from '@/inngest/lib/shot-list'
import { stillsEstimateUsd } from './visual-assets'

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
  /**
   * A model-assisted re-type in flight (`drafting`) or declined (`refused`,
   * with the model's reason). Null when nothing is pending — which is always,
   * for mechanical conversions: those finish inside the button press.
   */
  retype: SlotRetypeState | null
  /** An image model declined this slot's prompt (decision 252). */
  refusal: SlotRefusal | null
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
  /** The Director's Book (decision 252), null before the visuals stage drafts one. */
  direction: DirectorsBook | null
  /** Craft notes from `planWarnings`, in screen order. */
  warnings: string[]
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
    direction: null,
    warnings: [],
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
  const [rows, sources, takes, project] = await Promise.all([
    listShotSlots(db, projectId),
    latestScriptParagraphSources(db, projectId),
    listVoiceTakes(db, projectId),
    getProject(db, projectId),
  ])

  /**
   * The scrubber's clock is the same clock the runner stamped the slots with:
   * `timedParagraphs` over the same chapters and takes. Recomputed here rather
   * than stored, so an edited script shows its drift instead of hiding it.
   */
  const paragraphs = timedParagraphs({ chapters: sources.chapters, takes })

  /**
   * And the slots are put on the words they cover, the same way and with the
   * same function the compiler uses (decision 255, amended). Recomputed for
   * the same reason: a project planned before the rule, or re-voiced since,
   * carries the planner's guessed seconds in its rows, and a card that seeks
   * to a different moment than the render cuts to is a card that lies.
   */
  const briefs = rows.map((row) => ShotBriefSchema.safeParse(row.brief))
  const times = anchoredTimes(
    rows.map((row, at) => {
      const brief = briefs[at]
      return {
        startMs: row.startMs,
        durationMs: row.durationMs,
        coversText: brief?.success === true ? brief.data.coversText : null,
      }
    }),
    paragraphs,
  )

  const slots: SlotView[] = rows.map((row, at) => {
    const parsed = briefs[at]!
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
      startMs: times[at]!.startMs,
      durationMs: times[at]!.durationMs,
      brief: parsed.success ? parsed.data : null,
      briefError: parsed.success
        ? undefined
        : 'This brief no longer matches its schema and cannot be rendered or re-fetched as is.',
      candidates: ordered.slice(0, CANDIDATES_SHOWN),
      extraCandidates: Math.max(0, ordered.length - CANDIDATES_SHOWN),
      needsFetch: slotNeedsResolution(row),
      retype: ((): SlotRetypeState | null => {
        const state = SlotRetypeStateSchema.safeParse(row.retype)
        return state.success ? state.data : null
      })(),
      refusal: ((): SlotRefusal | null => {
        const state = SlotRefusalSchema.safeParse(row.refusal)
        return state.success ? state.data : null
      })(),
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
  /**
   * Priced brief by brief, not slot count times a flat rate. Every brief is
   * written by the time this checkpoint is on screen, so which route each
   * still takes — and therefore what it costs — is known (decision 253,
   * amended). Quoting the dearer route for all of them made the number
   * useless the moment the two routes differed.
   */
  const fetchEstimateUsd = await stillsEstimateUsd(
    toFetch.flatMap((slot) => (slot.brief ? [slot.brief] : [])),
    projectId,
  )

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
    fetchEstimateUsd,
    direction: ((): DirectorsBook | null => {
      const parsed = DirectorsBookSchema.safeParse(project?.direction)
      return parsed.success ? parsed.data : null
    })(),
    // Craft notes (decision 252), in screen order; never a blocker. Plus
    // any cast member the book forgot (decision 253).
    warnings: [
      ...planWarnings(
        slots.flatMap((slot) => (slot.brief ? [{ brief: slot.brief }] : [])),
        BANNED_PROMPT_WORDS,
      ),
      ...castWarnings(
        DirectorsBookSchema.safeParse(project?.direction).data ?? null,
        (project ? await listCastMembers(db, project.id) : []).map((member) => member.name),
      ),
    ],
  }
}
