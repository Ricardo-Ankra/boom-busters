import { MIN_SHOT_SECONDS } from '@boom-busters/schemas'
import { anchorWordRanges } from '@boom-busters/timeline'
import type { TimedParagraph } from './shot-list'

/**
 * Timing checks on a planned shot list once narration is timed (the stretch
 * re-plan design, 3.1 and 3.2). A pure module: it reads anchored slots and the
 * timed paragraphs, and says which shots are on screen too briefly or quote a
 * sentence the next shot also quotes. The repair that acts on a finding lives
 * elsewhere; this only names the stretch of shots a repair would re-plan.
 */

export interface TimingSlot {
  chapterId: string
  type: string
  /** Anchored, as `anchoredTimes` returns them. */
  startMs: number
  durationMs: number
  coversText: string | null
}

export type TimingFindingKind = 'too-short' | 'shared-sentence'

export interface TimingFinding {
  kind: TimingFindingKind
  chapterId: string
  /** Input indexes the note is about: one for too-short, two for shared-sentence. */
  slotIndexes: number[]
  /** Input indexes a repair re-plans: contiguous, one chapter, ascending. */
  stretch: number[]
  message: string
}

/** What the viewer sees, as the note names it. */
const TYPE_WORDS: Record<string, string> = {
  headline: 'news headline',
  social: 'Post on X',
  chart: 'chart',
  map: 'map',
  stock: 'stock shot',
  archival: 'real footage shot',
  still: 'AI image',
  graphic: 'graphic',
  hero: 'hero shot',
}

/** The paragraph of the shot's own chapter whose span holds its start. */
function homeParagraph(
  slot: TimingSlot,
  paragraphs: readonly TimedParagraph[],
): TimedParagraph | undefined {
  return paragraphs.find(
    (paragraph) =>
      paragraph.chapterId === slot.chapterId &&
      slot.startMs >= paragraph.startMs &&
      slot.startMs < paragraph.startMs + paragraph.durationMs,
  )
}

/** Slots in screen order (chapter, then index). */
export function timingFindings(
  slots: readonly TimingSlot[],
  paragraphs: readonly TimedParagraph[],
): TimingFinding[] {
  const homes = slots.map((slot) => homeParagraph(slot, paragraphs))
  const sameHome = (a: number, b: number): boolean => {
    const left = homes[a]
    const right = homes[b]
    return left !== undefined && left === right && slots[a]!.chapterId === slots[b]!.chapterId
  }

  const ranges = anchorWordRanges(
    slots.map((slot) => ({
      startMs: slot.startMs,
      durationMs: slot.durationMs,
      ...(slot.coversText ? { coversText: slot.coversText } : {}),
    })),
    paragraphs.flatMap((paragraph) => paragraph.words),
    paragraphs.map((paragraph) => ({
      startMs: paragraph.startMs,
      endMs: paragraph.startMs + paragraph.durationMs,
    })),
  )

  const found: TimingFinding[] = []
  for (const [index, slot] of slots.entries()) {
    const minimum = MIN_SHOT_SECONDS[slot.type as keyof typeof MIN_SHOT_SECONDS]
    if (minimum !== undefined && slot.durationMs < minimum * 1000) {
      const home = homes[index]
      const startingHere = home ? slots.filter((_, other) => homes[other] === home).length : 0
      // A paragraph shorter than the minimum cannot give its only shot more.
      const unavoidable =
        home !== undefined && startingHere === 1 && home.durationMs < minimum * 1000
      if (!unavoidable) {
        const stretch =
          index + 1 < slots.length && sameHome(index, index + 1)
            ? [index, index + 1]
            : index > 0 && sameHome(index - 1, index)
              ? [index - 1, index]
              : [index]
        found.push({
          kind: 'too-short',
          chapterId: slot.chapterId,
          slotIndexes: [index],
          stretch,
          message: `this ${TYPE_WORDS[slot.type] ?? slot.type} is on screen for ${(slot.durationMs / 1000).toFixed(1)} s; it needs at least ${minimum} s`,
        })
      }
    }

    const next = slots[index + 1]
    const here = ranges[index]
    const there = ranges[index + 1]
    if (next && next.chapterId === slot.chapterId && here && there && here.last >= there.first) {
      const opening = (next.coversText ?? '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
      found.push({
        kind: 'shared-sentence',
        chapterId: slot.chapterId,
        slotIndexes: [index, index + 1],
        stretch: [index, index + 1],
        message: `this shot and the next both quote "${opening}…"; one sentence needs one shot`,
      })
    }
  }
  return found
}

/** Stretches merged where they share or touch an index inside one chapter. */
export function repairStretches(findings: readonly TimingFinding[]): number[][] {
  const merged: { chapterId: string; indexes: number[] }[] = []
  const ordered = findings
    .map((finding) => ({
      chapterId: finding.chapterId,
      indexes: [...new Set(finding.stretch)].sort((a, b) => a - b),
    }))
    .filter((stretch) => stretch.indexes.length > 0)
    .sort((a, b) => a.indexes[0]! - b.indexes[0]!)
  for (const stretch of ordered) {
    const last = merged.findLast((entry) => entry.chapterId === stretch.chapterId)
    if (last && Math.max(...last.indexes) + 1 >= stretch.indexes[0]!) {
      last.indexes = [...new Set([...last.indexes, ...stretch.indexes])].sort((a, b) => a - b)
    } else {
      merged.push({ chapterId: stretch.chapterId, indexes: stretch.indexes })
    }
  }
  return merged.map((entry) => entry.indexes).sort((a, b) => a[0]! - b[0]!)
}
