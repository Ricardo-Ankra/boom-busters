import {
  getRender,
  latestScriptParagraphSources,
  latestTimeline,
  listShorts,
} from '@boom-busters/db'
import type { Database, RenderRow } from '@boom-busters/db'
import { estimateRenderCostUsd, TimelineSchema } from '@boom-busters/schemas'
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

export interface ShortCardModel {
  id: string
  title: string
  description: string
  ending: 'loop' | 'cta'
  relatedLinkChecked: boolean
  chapterTitle: string | null
  fromParagraph: number
  toParagraph: number
  /** The segment's runtime, from the master's narration. Null: no master. */
  durationMs: number | null
  estimatedCostUsd: number
  render: ShortRenderProp | null
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

export async function shortsModel(db: Database, projectId: string): Promise<ShortsModel> {
  const rows = await listShorts(db, projectId)
  if (rows.length === 0) return emptyShortsModel()

  const [timelineRow, sources] = await Promise.all([
    latestTimeline(db, projectId),
    latestScriptParagraphSources(db, projectId),
  ])
  const master = timelineRow ? TimelineSchema.parse(timelineRow.json) : null
  const chapterTitles = new Map(sources.chapters.map((chapter) => [chapter.id, chapter.title]))

  const shorts: ShortCardModel[] = []
  for (const row of rows) {
    const render = row.renderId ? await getRender(db, row.renderId) : undefined
    const durationMs = segmentDurationMs(master, row.segmentRef)
    shorts.push({
      id: row.id,
      title: row.title,
      description: row.description,
      ending: row.ending,
      relatedLinkChecked: row.relatedLinkChecked,
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
    })
  }

  return { shorts }
}
