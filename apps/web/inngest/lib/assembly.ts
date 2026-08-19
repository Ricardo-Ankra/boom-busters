import { latestTakes, ShotBriefSchema, splitParagraphs } from '@boom-busters/schemas'
import type { Caption, WordTiming } from '@boom-busters/schemas'
import type { VoiceTakeRow } from '@boom-busters/db'
import { offsetCaptions, snapToScript } from '@boom-busters/timeline'
import type { CompileParagraph, CompileSlot, SnapGap } from '@boom-busters/timeline'

/**
 * The assembly-runner's pure logic (build spec section 7.5): approved DB
 * rows in, compiler inputs out. Everything here is deterministic and
 * unit-tested; the runner just sequences it between Inngest steps.
 */

// ---------------------------------------------------------------------------
// Narration plan
// ---------------------------------------------------------------------------

export interface AssemblyParagraph extends CompileParagraph {
  /** Script ground truth for this paragraph — what captions must say. */
  text: string
  /** Word timings captured at synthesis (M6.3), if this take has them. */
  timings: WordTiming[] | null
  /** The take the audio comes from — the whisper fallback's input. */
  takeId: string
}

export interface NarrationPlan {
  paragraphs: AssemblyParagraph[]
  /** Paragraphs the script expects that have no usable take. */
  missing: { chapterTitle: string; paragraphIndex: number }[]
}

/**
 * One entry per script paragraph, in script order, each carrying its
 * current take. The voice gate guarantees takes exist; this re-checks
 * anyway, because compiling silence would be worse than failing.
 */
export function narrationPlan(input: {
  chapters: { id: string; title: string; contentMd: string }[]
  takes: VoiceTakeRow[]
}): NarrationPlan {
  const current = latestTakes(
    input.takes.map((take) => ({
      chapterId: take.chapterId,
      paragraphIndex: take.paragraphIndex,
      takeNumber: take.takeNumber,
      status: take.status,
      row: take,
    })),
  )
  const byParagraph = new Map(
    current.map((take) => [`${take.chapterId}:${take.paragraphIndex}`, take.row]),
  )

  const paragraphs: AssemblyParagraph[] = []
  const missing: NarrationPlan['missing'] = []

  input.chapters.forEach((chapter, chapterIndex) => {
    splitParagraphs(chapter.contentMd).forEach((text, paragraphIndex) => {
      const take = byParagraph.get(`${chapter.id}:${paragraphIndex}`)
      if (!take || take.r2Key === null || take.durationMs === null || take.durationMs <= 0) {
        missing.push({ chapterTitle: chapter.title, paragraphIndex })
        return
      }
      paragraphs.push({
        chapterId: chapter.id,
        chapterIndex,
        chapterTitle: chapter.title,
        paragraphIndex,
        r2Key: take.r2Key,
        durationMs: take.durationMs,
        text,
        timings: (take.timings as WordTiming[] | null) ?? null,
        takeId: take.id,
      })
    })
  })

  return { paragraphs, missing }
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export interface AssemblyCaptions {
  words: Caption[]
  gaps: (SnapGap & { chapterTitle: string; paragraphIndex: number })[]
}

/**
 * Snap every paragraph's heard words to its script text, then shift onto
 * the board clock (takes laid end to end, same as the compiler). The snap
 * runs even when the timings came from ElevenLabs input-text alignment —
 * one pipeline, one QC-gap definition, regardless of where timings came
 * from (decision 136).
 */
export function assembleCaptions(
  paragraphs: readonly (AssemblyParagraph & { words: WordTiming[] })[],
): AssemblyCaptions {
  const words: Caption[] = []
  const gaps: AssemblyCaptions['gaps'] = []
  let clock = 0

  for (const paragraph of paragraphs) {
    const snapped = snapToScript(paragraph.text, paragraph.words)
    words.push(...offsetCaptions(snapped.captions, clock))
    for (const gap of snapped.gaps) {
      gaps.push({
        ...gap,
        startMs: gap.startMs + clock,
        endMs: gap.endMs + clock,
        chapterTitle: paragraph.chapterTitle,
        paragraphIndex: paragraph.paragraphIndex,
      })
    }
    clock += paragraph.durationMs
  }

  return { words, gaps }
}

/**
 * The whisper fallback for takes without stored timings, mocked: words
 * spread evenly across the take's measured duration. Deterministic, so CI
 * and unit tests exercise the exact snap/offset path live audio would.
 */
export function evenlySpacedWords(text: string, durationMs: number): WordTiming[] {
  const words = text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && !/^\[[^\]]+\]$/.test(word))
  if (words.length === 0) return []
  const step = durationMs / words.length
  return words.map((word, index) => ({
    text: word,
    startMs: Math.round(index * step),
    endMs: Math.round((index + 1) * step),
  }))
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * The slot fields assembly reads — structural, because rows cross an
 * Inngest step boundary and arrive JSON-serialised (Dates become strings).
 */
export interface AssemblySlotRow {
  id: string
  type: 'stock' | 'archival' | 'still' | 'chart' | 'map' | 'hero'
  status: 'unresolved' | 'resolved' | 'placeholder'
  brief: Record<string, unknown>
  candidates: Record<string, unknown>[]
  chosenAssetId: string | null
  startMs: number
  durationMs: number
}

export interface SlotPlan {
  slots: CompileSlot[]
  /** Slots on the board that could not be compiled, with the reason. */
  skipped: { slotId: string; reason: string }[]
}

interface ChosenCandidate {
  kind: 'image' | 'video'
  assetId?: string
  r2Key?: string
  sourceUrl: string
  width?: number
  height?: number
}

function chosenCandidate(row: AssemblySlotRow): ChosenCandidate | null {
  const candidates = row.candidates as unknown as (ChosenCandidate & { chosen?: boolean })[]
  return candidates.find((candidate) => candidate.chosen === true) ?? null
}

/**
 * Board rows → compiler slots. Chart and map slots carry their brief's
 * data; media slots carry a storage key (our bytes win over any URL) or
 * the stable provider URL. Placeholders, hero slots (feature-flagged off)
 * and anything unresolvable are skipped AND counted — the gate summary
 * shows the human exactly what the preview lacks.
 */
export function slotPlan(input: {
  slots: AssemblySlotRow[]
  assetsById: Map<string, { r2Key: string }>
}): SlotPlan {
  const slots: CompileSlot[] = []
  const skipped: SlotPlan['skipped'] = []

  for (const row of input.slots) {
    if (row.type === 'hero') {
      skipped.push({ slotId: row.id, reason: 'hero slots are feature-flagged off' })
      continue
    }
    if (row.status !== 'resolved') {
      skipped.push({ slotId: row.id, reason: `status ${row.status}` })
      continue
    }

    const parsed = ShotBriefSchema.safeParse(row.brief)
    if (!parsed.success) {
      skipped.push({ slotId: row.id, reason: 'brief does not parse' })
      continue
    }
    const brief = parsed.data

    const base = {
      startMs: row.startMs,
      durationMs: row.durationMs,
      transition: brief.transition,
      motion: brief.motion,
    }

    if (brief.type === 'chart') {
      slots.push({
        ...base,
        type: 'chart',
        chart: {
          chartKind: brief.chartKind,
          series: brief.series,
          dataRefs: brief.dataRefs,
          takeaway: brief.takeaway,
          ...(brief.annotations !== undefined ? { annotations: brief.annotations } : {}),
          reveal: brief.reveal,
        },
      })
      continue
    }
    if (brief.type === 'map') {
      slots.push({
        ...base,
        type: 'map',
        map: { locations: brief.locations, route: brief.route },
      })
      continue
    }

    if (brief.type === 'hero') {
      skipped.push({ slotId: row.id, reason: 'hero slots are feature-flagged off' })
      continue
    }

    const candidate = chosenCandidate(row)
    if (!candidate) {
      skipped.push({ slotId: row.id, reason: 'resolved but no chosen candidate' })
      continue
    }

    const asset = row.chosenAssetId ? input.assetsById.get(row.chosenAssetId) : undefined
    const r2Key = asset?.r2Key ?? candidate.r2Key
    const externalUrl =
      r2Key === undefined && /^https?:\/\//.test(candidate.sourceUrl)
        ? candidate.sourceUrl
        : undefined
    if (r2Key === undefined && externalUrl === undefined) {
      skipped.push({ slotId: row.id, reason: 'no storage key and no stable URL' })
      continue
    }

    slots.push({
      ...base,
      type: brief.type,
      media: {
        kind: candidate.kind,
        ...(r2Key !== undefined ? { r2Key } : {}),
        ...(externalUrl !== undefined ? { externalUrl } : {}),
        ...(candidate.width !== undefined ? { width: candidate.width } : {}),
        ...(candidate.height !== undefined ? { height: candidate.height } : {}),
      },
    })
  }

  return { slots, skipped }
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

/**
 * The default bed for the first preview: the newest track in the library,
 * or nothing when the library is empty. The M6.8 preview screen's music
 * picker swaps beds and recompiles for free — this is a starting point,
 * not a verdict.
 */
export function pickMusicBed(beds: readonly { r2Key: string }[]): { r2Key: string } | null {
  const bed = beds[0]
  return bed ? { r2Key: bed.r2Key } : null
}

/** The R2 key a compiled timeline is stored under. */
export function timelineKey(projectId: string, version: number): string {
  return `boom-busters/timelines/${projectId}/v${version}.json`
}
