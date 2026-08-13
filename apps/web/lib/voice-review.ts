import { getSettings, latestScriptParagraphSources, listVoiceTakes } from '@boom-busters/db'
import type { Database, VoiceTakeRow } from '@boom-busters/db'
import { rereadCanDiffer } from '@boom-busters/providers'
import { splitParagraphs, voiceApprovalBlockedReason, voiceCoverage } from '@boom-busters/schemas'
import type { VoiceCoverage } from '@boom-busters/schemas'

/**
 * What the voice review screen shows, and what the voice gate refuses on.
 *
 * One model behind both, for the reason `lib/claim-review.ts` exists: a
 * disabled button and a server-side refusal that disagree are worse than
 * either alone, because the one you can see is the one that is wrong.
 *
 * The paragraphs come from the script, not from the takes. That direction
 * matters — a chapter that gained a paragraph after narration should read as
 * "one paragraph has no audio", which is only visible if the script is the
 * spine and the takes hang off it. Building the screen from the takes would
 * show a complete-looking list that silently omits the new paragraph.
 */

/**
 * A take as the review screen needs it — plain data, no `Date`s, no key.
 *
 * The screen is a client component, so what crosses the boundary is chosen
 * rather than inherited: `r2Key` in particular stays server-side, because the
 * browser reaches audio through the session-checked route and never through a
 * storage path it was handed.
 */
export interface TakeView {
  id: string
  takeNumber: number
  status: VoiceTakeRow['status']
  durationMs: number | null
  waveform: number[]
  note: string | null
  hasAudio: boolean
}

function takeView(take: VoiceTakeRow): TakeView {
  return {
    id: take.id,
    takeNumber: take.takeNumber,
    status: take.status,
    durationMs: take.durationMs,
    waveform: Array.isArray(take.waveform) ? take.waveform : [],
    note: take.note,
    hasAudio: take.r2Key !== null,
  }
}

export interface ParagraphRow {
  chapterId: string
  paragraphIndex: number
  text: string
  /** The take that will be assembled: the highest take number. */
  current: TakeView | undefined
  /** The one before it, for the A/B toggle. Absent until a retake exists. */
  previous: TakeView | undefined
  takeCount: number
}

export interface ChapterGroup {
  chapterId: string
  title: string
  paragraphs: ParagraphRow[]
}

export interface VoiceReviewModel {
  chapters: ChapterGroup[]
  coverage: VoiceCoverage
  /** How many paragraphs the current script expects narration for. */
  expectedParagraphs: number
  /** Runtime of the current takes, which is not the sum of every take made. */
  totalDurationMs: number
  /** Why Approve is refused, or `undefined` when it is not. */
  blockedReason: string | undefined
  /** Takes whose paragraph no longer exists — the script was edited after narration. */
  orphanedTakes: number
  /**
   * Whether this narrator can read the same words differently a second time.
   *
   * Resolved on the server because the answer is a property of the configured
   * provider, and carried in the model so the review screen can offer "try
   * again" only where pressing it is not a purchase of what was just rejected.
   */
  rereadCanDiffer: boolean
}

/** Group takes by the paragraph they belong to, newest take number first. */
function takesFor(
  takes: readonly VoiceTakeRow[],
  chapterId: string,
  paragraphIndex: number,
): VoiceTakeRow[] {
  return takes
    .filter((take) => take.chapterId === chapterId && take.paragraphIndex === paragraphIndex)
    .sort((a, b) => b.takeNumber - a.takeNumber)
}

export async function voiceReviewModel(db: Database, projectId: string): Promise<VoiceReviewModel> {
  const [sources, takes, settings] = await Promise.all([
    latestScriptParagraphSources(db, projectId),
    listVoiceTakes(db, projectId),
    getSettings(db),
  ])

  let expectedParagraphs = 0
  const seen = new Set<string>()

  const chapters: ChapterGroup[] = sources.chapters.map((chapter) => {
    const paragraphs = splitParagraphs(chapter.contentMd).map((text, paragraphIndex) => {
      expectedParagraphs += 1
      seen.add(`${chapter.id}:${paragraphIndex}`)

      const history = takesFor(takes, chapter.id, paragraphIndex)
      const [current, previous] = history

      return {
        chapterId: chapter.id,
        paragraphIndex,
        text,
        current: current ? takeView(current) : undefined,
        previous: previous ? takeView(previous) : undefined,
        takeCount: history.length,
      }
    })

    return { chapterId: chapter.id, title: chapter.title, paragraphs }
  })

  /**
   * Coverage counts the takes that belong to paragraphs the script still has.
   *
   * Without the filter, editing a chapter down to fewer paragraphs would leave
   * takes behind that keep the coverage bar reading complete — and a flagged
   * one among them would block the gate forever with no row on screen to
   * unflag.
   */
  const live = takes.filter((take) => seen.has(`${take.chapterId}:${take.paragraphIndex}`))

  const currentTakes = chapters.flatMap((chapter) =>
    chapter.paragraphs.map((paragraph) => paragraph.current).filter((take) => take !== undefined),
  )

  return {
    chapters,
    coverage: voiceCoverage(live),
    expectedParagraphs,
    totalDurationMs: currentTakes.reduce((total, take) => total + (take.durationMs ?? 0), 0),
    blockedReason: voiceApprovalBlockedReason(live, expectedParagraphs),
    orphanedTakes: takes.length - live.length,
    rereadCanDiffer: rereadCanDiffer(settings.tts.provider),
  }
}

/** The gate's refusal, read by `approveGate` before it sends anything. */
export async function voiceGateBlockedReason(
  db: Database,
  projectId: string,
): Promise<string | undefined> {
  return (await voiceReviewModel(db, projectId)).blockedReason
}
