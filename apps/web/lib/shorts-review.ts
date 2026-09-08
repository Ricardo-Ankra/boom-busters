import {
  getRender,
  latestScriptParagraphSources,
  latestTimeline,
  listShorts,
  MOCK_KEY_PREFIX,
} from '@boom-busters/db'
import type { Database, RenderRow } from '@boom-busters/db'
import {
  estimateRenderCostUsd,
  TeaserScriptRecordSchema,
  TimelineSchema,
} from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'

/**
 * What the Shorts screen (build spec section 11.3) needs in one read: every
 * Short's row, its segment's place in the script (chapter title, paragraph
 * range, sliced runtime), the render of its current configuration, and what
 * a render would cost.
 */

export interface ShortRenderProp {
  id: string
  status: RenderRow['status']
  progressPct: number
  costUsd: string
  error: { message?: string } | null
}

/** One spoken beat, as the teaser studio shows it (decision 227). */
export interface TeaserBeatProp {
  text: string
  chapterIndex: number
  /** The chapter whose visuals the beat is cut over, by name. */
  chapterTitle: string | null
  /** Presigned URL of the beat's current audio; null in mock mode or unvoiced. */
  audioUrl: string | null
  durationMs: number | null
}

/** The teaser studio's model — present on teaser cards only. */
export interface TeaserStudioModel {
  /**
   * False for teasers built before the script was stored (pre-decision-227):
   * the studio then offers only the rebuild, which regenerates and stores one.
   */
  hasScript: boolean
  beats: TeaserBeatProp[]
}

export interface ShortCardModel {
  id: string
  title: string
  description: string
  ending: 'loop' | 'cta'
  relatedLinkChecked: boolean
  /** An excerpt slices the master; a teaser speaks its own narration. */
  kind: 'excerpt' | 'teaser'
  chapterTitle: string | null
  fromParagraph: number
  toParagraph: number
  /** The segment's runtime, from the master's narration. Null: no master. */
  durationMs: number | null
  estimatedCostUsd: number
  render: ShortRenderProp | null
  /** The studio's data — teaser cards only, null on excerpts. */
  teaser: TeaserStudioModel | null
}

export interface ShortsModel {
  shorts: ShortCardModel[]
}

export function emptyShortsModel(): ShortsModel {
  return { shorts: [] }
}

function segmentDurationMs(
  master: Timeline | null,
  segmentRef: { chapterId: string; fromParagraph: number; toParagraph: number },
): number | null {
  if (!master) return null
  const segments = master.narration.filter(
    (segment) =>
      segment.chapterId === segmentRef.chapterId &&
      segment.paragraphIndex >= segmentRef.fromParagraph &&
      segment.paragraphIndex <= segmentRef.toParagraph,
  )
  if (segments.length === 0) return null
  return segments.reduce((total, segment) => total + segment.durationMs, 0)
}

export async function shortsModel(
  db: Database,
  projectId: string,
  options: {
    /** Presigner for the studio's per-beat audio; null when R2 is absent. */
    presign?: ((key: string) => Promise<string>) | null
  } = {},
): Promise<ShortsModel> {
  const rows = await listShorts(db, projectId)
  if (rows.length === 0) return emptyShortsModel()

  const [timelineRow, sources] = await Promise.all([
    latestTimeline(db, projectId),
    latestScriptParagraphSources(db, projectId),
  ])
  const master = timelineRow ? TimelineSchema.parse(timelineRow.json) : null
  const chapterTitles = new Map(sources.chapters.map((chapter) => [chapter.id, chapter.title]))

  /** The studio's model (decision 227): beats from the stored script, each
   *  paired positionally with its narration segment for the audio link. */
  const teaserModel = async (
    row: { teaserScript: unknown },
    source: Timeline | null,
  ): Promise<TeaserStudioModel> => {
    const stored = TeaserScriptRecordSchema.safeParse(row.teaserScript)
    if (!stored.success) return { hasScript: false, beats: [] }

    const narration = source ? [...source.narration].sort((a, b) => a.startMs - b.startMs) : []
    const beats: TeaserBeatProp[] = []
    for (const [index, paragraph] of stored.data.paragraphs.entries()) {
      const segment = narration[index]
      const r2Key = segment?.r2Key
      beats.push({
        text: paragraph.text,
        chapterIndex: paragraph.chapterIndex,
        chapterTitle: sources.chapters[paragraph.chapterIndex]?.title ?? null,
        audioUrl:
          r2Key && !r2Key.startsWith(MOCK_KEY_PREFIX) && options.presign
            ? await options.presign(r2Key)
            : null,
        durationMs: segment?.durationMs ?? null,
      })
    }
    return { hasScript: true, beats }
  }

  const shorts: ShortCardModel[] = []
  for (const row of rows) {
    const render = row.renderId ? await getRender(db, row.renderId) : undefined
    // A teaser's runtime lives in its own mini master, not the project's.
    const sourceParsed =
      row.kind === 'teaser' && row.sourceTimeline
        ? TimelineSchema.safeParse(row.sourceTimeline)
        : null
    const durationMs = segmentDurationMs(
      sourceParsed?.success ? sourceParsed.data : master,
      row.segmentRef,
    )
    shorts.push({
      id: row.id,
      title: row.title,
      description: row.description,
      ending: row.ending,
      relatedLinkChecked: row.relatedLinkChecked,
      kind: row.kind,
      chapterTitle: chapterTitles.get(row.segmentRef.chapterId) ?? null,
      fromParagraph: row.segmentRef.fromParagraph,
      toParagraph: row.segmentRef.toParagraph,
      durationMs,
      estimatedCostUsd: durationMs === null ? 0 : estimateRenderCostUsd(durationMs / 1000, 'short'),
      render: render
        ? {
            id: render.id,
            status: render.status,
            progressPct: render.progressPct,
            costUsd: render.costUsd,
            error: (render.error ?? null) as ShortRenderProp['error'],
          }
        : null,
      teaser:
        row.kind === 'teaser'
          ? await teaserModel(row, sourceParsed?.success ? sourceParsed.data : null)
          : null,
    })
  }

  return { shorts }
}
