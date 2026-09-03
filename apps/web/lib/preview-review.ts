import { listMusicBeds, latestRender, latestTimeline } from '@boom-busters/db'
import type { Database, RenderRow } from '@boom-busters/db'
import { estimateRenderCostUsd, timelineDurationMs, TimelineSchema } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'

/**
 * What the Preview & render screen (build spec section 11.3, Gate 5a) needs
 * to know, in one read: the latest compiled timeline, its stats, the music
 * library for the picker, and the newest master render if one exists.
 */

export interface PreviewChapter {
  title: string
  startMs: number
  durationMs: number
}

export interface PreviewStats {
  durationMs: number
  slotCount: number
  chapters: PreviewChapter[]
}

export interface PreviewModel {
  timeline: Timeline | null
  version: number
  stats: PreviewStats
  beds: { r2Key: string; title: string }[]
  currentBedKey: string | null
  render: RenderRow | undefined
  /** The newest half-resolution draft — assembly requests one automatically. */
  draft: RenderRow | undefined
  estimatedCostUsd: number
  estimatedDraftCostUsd: number
}

/**
 * Chapter list from the timeline alone: runtimes from the narration
 * segments, titles from the chapter-card overlays. The compiler numbers
 * each card (decision 215 moved cards ahead of their chapter's first words,
 * so start times no longer line up), and that number is the match key. A
 * chapter whose card was edited away still gets a positional name rather
 * than disappearing from the stats.
 */
export function timelineChapters(timeline: Timeline): PreviewChapter[] {
  const chapters: (PreviewChapter & { chapterId: string })[] = []
  for (const segment of timeline.narration) {
    const existing = chapters.find((chapter) => chapter.chapterId === segment.chapterId)
    if (existing) {
      existing.durationMs += segment.durationMs
      continue
    }
    const position = chapters.length + 1
    const card = timeline.overlays.find(
      (overlay) => overlay.kind === 'chapterCard' && overlay.props.index === position,
    )
    chapters.push({
      chapterId: segment.chapterId,
      title: card?.kind === 'chapterCard' ? card.props.title : `Chapter ${position}`,
      startMs: segment.startMs,
      durationMs: segment.durationMs,
    })
  }
  return chapters.map(({ chapterId: _dropped, ...chapter }) => chapter)
}

/**
 * The shape for screens that have no business paying preview queries — a
 * project that has not reached assembly has no timeline, no renders and no
 * use for the music library. The page loads this instead of querying.
 */
export function emptyPreviewModel(): PreviewModel {
  return {
    timeline: null,
    version: 0,
    stats: { durationMs: 0, slotCount: 0, chapters: [] },
    beds: [],
    currentBedKey: null,
    render: undefined,
    draft: undefined,
    estimatedCostUsd: 0,
    estimatedDraftCostUsd: 0,
  }
}

export async function previewModel(db: Database, projectId: string): Promise<PreviewModel> {
  const [timelineRow, beds, render, draft] = await Promise.all([
    latestTimeline(db, projectId),
    listMusicBeds(db),
    latestRender(db, projectId, 'master'),
    latestRender(db, projectId, 'draft'),
  ])

  const timeline = timelineRow ? TimelineSchema.parse(timelineRow.json) : null
  const durationMs = timeline ? timelineDurationMs(timeline) : 0

  return {
    timeline,
    version: timelineRow?.version ?? 0,
    stats: {
      durationMs,
      slotCount: timeline?.slots.length ?? 0,
      chapters: timeline ? timelineChapters(timeline) : [],
    },
    beds: beds.map((bed) => ({
      r2Key: bed.r2Key,
      title: bed.title ?? bed.r2Key.split('/').pop() ?? bed.r2Key,
    })),
    currentBedKey: timeline?.music?.r2Key ?? null,
    render,
    draft,
    estimatedCostUsd: estimateRenderCostUsd(durationMs / 1000),
    estimatedDraftCostUsd: estimateRenderCostUsd(durationMs / 1000, 'draft'),
  }
}
