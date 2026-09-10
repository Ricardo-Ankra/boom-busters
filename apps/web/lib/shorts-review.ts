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
  teaserTextHash,
  TeaserScriptRecordSchema,
  TeaserShotsRecordSchema,
  TeaserVoiceRecordSchema,
  TimelineSchema,
} from '@boom-busters/schemas'
import type { Timeline, TimelineSlot } from '@boom-busters/schemas'
import { masterChapterIds, pickTeaserSlot, teaserShotPool } from '@boom-busters/timeline'

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

/** One offerable shot in a beat's picker (decision 230). */
export interface TeaserShotOption {
  kind: 'image' | 'video' | 'chart' | 'map'
  /** Presigned (or external) preview; null for mock keys, charts and maps. */
  url: string | null
  /** The full slot snapshot the save action stores. */
  slot: TimelineSlot
  /** True when this option IS the stored choice. */
  selected: boolean
}

/** One spoken beat, as the teaser studio shows it (decisions 227, 230). */
export interface TeaserBeatProp {
  text: string
  chapterIndex: number
  /** The chapter whose visuals the beat is cut over, by name. */
  chapterTitle: string | null
  /** Presigned URL of the beat's current audio; null in mock mode or unvoiced. */
  audioUrl: string | null
  durationMs: number | null
  /** True when stored audio exists AND still speaks the current text. */
  voiced: boolean
  /** What the auto-pick takes today — the default the picker starts from. */
  auto: { kind: string; url: string | null } | null
  /** True while no explicit choice is stored — the auto-pick applies. */
  autoSelected: boolean
  /** The chapter's offerable shots, capped for the strip. */
  pool: TeaserShotOption[]
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

  /** Presign a URL for an audio r2Key; mock bookmarks stay unplayable. */
  const audioUrlOf = async (r2Key: string | undefined): Promise<string | null> =>
    r2Key && !r2Key.startsWith(MOCK_KEY_PREFIX) && options.presign ? options.presign(r2Key) : null

  /** A slot's preview URL: external as-is, R2 presigned, charts/maps none. */
  const shotUrlOf = async (slot: TimelineSlot): Promise<string | null> => {
    if (slot.payload.kind !== 'image' && slot.payload.kind !== 'video') return null
    const src = slot.payload.src
    if (src.externalUrl) return src.externalUrl
    if (src.r2Key && !src.r2Key.startsWith(MOCK_KEY_PREFIX) && options.presign) {
      return options.presign(src.r2Key)
    }
    return null
  }

  /** Two slots show the same footage when their payloads agree exactly. */
  const sameShot = (a: TimelineSlot, b: TimelineSlot): boolean =>
    JSON.stringify(a.payload) === JSON.stringify(b.payload)

  /** How many of a chapter's shots the picker strip offers per beat. */
  const POOL_CAP = 12

  /**
   * The studio's model (decisions 227, 230): beats from the stored script,
   * each carrying its voice state (stored audio vs the current text's hash),
   * its shot choice, and the chapter's offerable pool from the master board.
   */
  const teaserModel = async (
    row: { teaserScript: unknown; teaserVoice: unknown; teaserShots: unknown },
    source: Timeline | null,
  ): Promise<TeaserStudioModel> => {
    const stored = TeaserScriptRecordSchema.safeParse(row.teaserScript)
    if (!stored.success) return { hasScript: false, beats: [] }

    const voice = TeaserVoiceRecordSchema.safeParse(row.teaserVoice)
    const shots = TeaserShotsRecordSchema.safeParse(row.teaserShots)
    const narration = source ? [...source.narration].sort((a, b) => a.startMs - b.startMs) : []
    const chapterIds = master ? masterChapterIds(master) : []

    const beats: TeaserBeatProp[] = []
    for (const [index, paragraph] of stored.data.paragraphs.entries()) {
      const voiceBeat = voice.success ? voice.data.beats[index] : undefined
      const voiced =
        voiceBeat !== undefined && voiceBeat.textHash === teaserTextHash(paragraph.text)
      // Voiced-and-current audio first; the assembled cut's segment second.
      const segment = narration[index]
      const audioUrl = voiced ? await audioUrlOf(voiceBeat.r2Key) : await audioUrlOf(segment?.r2Key)

      const chapterId = master
        ? chapterIds[Math.min(Math.max(paragraph.chapterIndex, 0), chapterIds.length - 1)]
        : undefined
      const poolSlots =
        master && chapterId ? teaserShotPool(master, chapterId).slice(0, POOL_CAP) : []
      const chosen = shots.success ? (shots.data.choices[index] ?? null) : null
      const autoSlot = master && chapterId ? pickTeaserSlot(master, chapterId) : undefined

      const pool: TeaserShotOption[] = []
      for (const slot of poolSlots) {
        pool.push({
          kind: slot.payload.kind,
          url: await shotUrlOf(slot),
          slot,
          selected: chosen !== null && sameShot(chosen, slot),
        })
      }

      beats.push({
        text: paragraph.text,
        chapterIndex: paragraph.chapterIndex,
        chapterTitle: sources.chapters[paragraph.chapterIndex]?.title ?? null,
        audioUrl,
        durationMs: voiced ? voiceBeat.durationMs : (segment?.durationMs ?? null),
        voiced,
        auto: autoSlot ? { kind: autoSlot.payload.kind, url: await shotUrlOf(autoSlot) } : null,
        autoSelected: chosen === null,
        pool,
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
