import {
  getRendersByIds,
  latestScriptParagraphSources,
  latestTimeline,
  listShorts,
  MOCK_KEY_PREFIX,
} from '@boom-busters/db'
import type { Database, RenderRow } from '@boom-busters/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import {
  estimateRenderCostUsd,
  teaserTextHash,
  TeaserFetchesRecordSchema,
  TeaserScriptRecordSchema,
  TeaserShotsRecordSchema,
  TeaserVoiceRecordSchema,
  TimelineSchema,
} from '@boom-busters/schemas'
import type { SlotCandidate, TeaserFetchState, Timeline, TimelineSlot } from '@boom-busters/schemas'
import { masterChapterIds, pickTeaserSlot, teaserShotPool } from '@boom-busters/timeline'
import { slotFromTeaserCandidate, teaserCandidateReady } from '@/lib/teaser-fetch'
import { stillSlotEstimateUsd } from '@/lib/visual-assets'

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

/** One fetched or generated option in a beat's new-material strip (decision 231). */
export interface TeaserFetchedOptionProp {
  /** The candidate's provider-scoped id, what the ingest pick names. */
  id: string
  kind: 'image' | 'video'
  /** Where it came from: a free stock search, or a paid generation. */
  origin: 'stock' | 'still'
  /** Provider thumb, data: SVG, or presigned stored bytes; null when nothing shows. */
  url: string | null
  /** What `url` actually is: a video's provider thumb is an image. */
  previewKind: 'image' | 'video'
  /**
   * The pre-built slot snapshot when the bytes are settled, picked via the
   * plain `saveTeaserShot`. Null for live stock not yet ingested: picking
   * those goes through `pickFetchedTeaserShot` (the runner downloads first).
   */
  slot: TimelineSlot | null
  /** True when the beat's stored choice IS this option's footage. */
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
  /** The beat's in-flight or failed new-material request (decision 231). */
  fetchState: TeaserFetchState | null
  /** New material fetched or generated for this beat, oldest first. */
  fetched: TeaserFetchedOptionProp[]
}

/** The teaser studio's model — present on teaser cards only. */
export interface TeaserStudioModel {
  /**
   * False for teasers built before the script was stored (pre-decision-227):
   * the studio then offers only the rebuild, which regenerates and stores one.
   */
  hasScript: boolean
  beats: TeaserBeatProp[]
  /**
   * What one "Generate a still" buys (decision 231): the routed generator's
   * price for the pass, the same number the plan screen quotes.
   */
  stillEstimateUsd: number
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
  const mocked = mockProvidersEnabled()

  /** True when the beat's stored choice is this fetched candidate's footage. */
  const candidatePicked = (chosen: TimelineSlot | null, candidate: SlotCandidate): boolean => {
    if (!chosen || (chosen.payload.kind !== 'image' && chosen.payload.kind !== 'video')) {
      return false
    }
    const src = chosen.payload.src
    if (candidate.r2Key !== undefined && src.r2Key === candidate.r2Key) return true
    const asSlot = slotFromTeaserCandidate(candidate, { mocked })
    if (
      asSlot &&
      (asSlot.payload.kind === 'image' || asSlot.payload.kind === 'video') &&
      src.r2Key !== undefined &&
      src.r2Key === asSlot.payload.src.r2Key
    ) {
      return true
    }
    return src.externalUrl !== undefined && src.externalUrl === candidate.sourceUrl
  }

  /** A fetched option's thumbnail: provider thumb, stored bytes, stable URL. */
  const fetchedUrlOf = async (
    candidate: SlotCandidate,
  ): Promise<{ url: string | null; previewKind: 'image' | 'video' }> => {
    // Provider thumbs are pictures even for clips.
    if (candidate.thumbUrl) return { url: candidate.thumbUrl, previewKind: 'image' }
    if (candidate.r2Key && !candidate.r2Key.startsWith(MOCK_KEY_PREFIX) && options.presign) {
      return { url: await options.presign(candidate.r2Key), previewKind: candidate.kind }
    }
    return {
      url: /^https?:\/\//.test(candidate.sourceUrl) ? candidate.sourceUrl : null,
      previewKind: candidate.kind,
    }
  }

  const teaserModel = async (
    row: {
      teaserScript: unknown
      teaserVoice: unknown
      teaserShots: unknown
      teaserFetches: unknown
    },
    source: Timeline | null,
    stillEstimateUsd: number,
  ): Promise<TeaserStudioModel> => {
    const stored = TeaserScriptRecordSchema.safeParse(row.teaserScript)
    if (!stored.success) return { hasScript: false, beats: [], stillEstimateUsd }

    const voice = TeaserVoiceRecordSchema.safeParse(row.teaserVoice)
    const shots = TeaserShotsRecordSchema.safeParse(row.teaserShots)
    const fetches = TeaserFetchesRecordSchema.safeParse(row.teaserFetches)
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

      // The beat's fetched new material (decision 231): ready candidates
      // carry their pre-built slot so picking them IS `saveTeaserShot`.
      const fetchBeat = fetches.success ? (fetches.data.beats[index] ?? null) : null
      const fetched: TeaserFetchedOptionProp[] = []
      for (const candidate of fetchBeat?.candidates ?? []) {
        const preview = await fetchedUrlOf(candidate)
        fetched.push({
          id: candidate.id,
          kind: candidate.kind,
          origin:
            candidate.provider === 'fal' || candidate.provider === 'google' ? 'still' : 'stock',
          url: preview.url,
          previewKind: preview.previewKind,
          slot: teaserCandidateReady(candidate, mocked)
            ? slotFromTeaserCandidate(candidate, { mocked })
            : null,
          selected: candidatePicked(chosen, candidate),
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
        fetchState: fetchBeat?.state ?? null,
        fetched,
      })
    }
    return { hasScript: true, beats, stillEstimateUsd }
  }

  // Priced once per read, only when a teaser will show the studio at all.
  const stillEstimateUsd = rows.some((row) => row.kind === 'teaser')
    ? await stillSlotEstimateUsd()
    : 0

  // One query for every card's render (decision 237), not one per card.
  const rendersById = await getRendersByIds(
    db,
    rows.flatMap((row) => (row.renderId ? [row.renderId] : [])),
  )

  const shorts: ShortCardModel[] = []
  for (const row of rows) {
    const render = row.renderId ? rendersById.get(row.renderId) : undefined
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
          ? await teaserModel(
              row,
              sourceParsed?.success ? sourceParsed.data : null,
              stillEstimateUsd,
            )
          : null,
    })
  }

  return { shorts }
}
