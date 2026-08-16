import { getSettings, latestScriptParagraphSources, listVoiceTakes } from '@boom-busters/db'
import type { Database, VoiceTakeRow } from '@boom-busters/db'
import { narrationUnits } from '@boom-busters/providers'
import { voiceKeyFacts } from '@/lib/voice-identity'
import {
  takeIdempotencyKey,
  voiceApprovalBlockedReason,
  voiceCoverage,
} from '@boom-busters/schemas'
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
  /**
   * The audio on this row is not what these words would buy today.
   *
   * Decided by the take fingerprint, not by guessing at causes: the current
   * take's stored key is compared against the key this paragraph would be
   * claimed under right now — same text, same voice, same stability, same
   * applicable pronunciations. Any of those moving after the take was bought
   * makes the row stale, which is precisely the set of changes that alter how
   * a paragraph is spoken. The audio still plays; it is just of the old
   * version, and re-running the stage re-buys exactly the stale rows.
   */
  stale: boolean
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
  /** How many rows are `stale` — audio of an older text, voice, stability or pronunciation. */
  staleParagraphs: number
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
    // The same units the runner would buy, so a row is a purchasable thing.
    const units = narrationUnits({
      chapters: [{ id: chapter.id, title: chapter.title, contentMd: chapter.contentMd }],
    })

    const paragraphs = units.map((row) => {
      expectedParagraphs += 1
      seen.add(`${chapter.id}:${row.unitIndex}`)

      const history = takesFor(takes, chapter.id, row.unitIndex)
      const [current, previous] = history

      // The key this unit would be claimed under if the stage ran now —
      // computed by the same function the runner buys with, so the screen and
      // the purchase can never disagree about what "changed" means.
      const expectedKey = takeIdempotencyKey({
        projectId,
        chapterId: chapter.id,
        paragraphIndex: row.unitIndex,
        text: row.text,
        ...voiceKeyFacts(settings.tts),
      })

      return {
        chapterId: chapter.id,
        paragraphIndex: row.unitIndex,
        text: row.text,
        current: current ? takeView(current) : undefined,
        previous: previous ? takeView(previous) : undefined,
        takeCount: history.length,
        stale: current !== undefined && current.idempotencyKey !== expectedKey,
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

  const staleParagraphs = chapters.reduce(
    (total, chapter) => total + chapter.paragraphs.filter((paragraph) => paragraph.stale).length,
    0,
  )

  /**
   * Staleness blocks approval, after the harder blockers have had their say.
   *
   * Approving is a statement about the audio that will be assembled, and audio
   * of words the script no longer says — or a voice, speed or pronunciation
   * the settings no longer choose — is not that audio. Without this, changing
   * the pacing slider was approvable silence: every row still read
   * "generated", the gate opened, and the change never reached your ears.
   */
  const blockedReason =
    voiceApprovalBlockedReason(live, expectedParagraphs) ??
    (staleParagraphs > 0
      ? `${staleParagraphs} paragraph${staleParagraphs === 1 ? ' has' : 's have'} changed since ` +
        'being read — the words, the voice, its stability or a pronunciation moved on, so the ' +
        'audio is of the old version. Press Regenerate on each changed row' +
        (staleParagraphs > 1 ? ', or regenerate them all from the button above the list.' : '.')
      : undefined)

  return {
    chapters,
    coverage: voiceCoverage(live),
    expectedParagraphs,
    totalDurationMs: currentTakes.reduce((total, take) => total + (take.durationMs ?? 0), 0),
    blockedReason,
    orphanedTakes: takes.length - live.length,
    staleParagraphs,
  }
}

/** The gate's refusal, read by `approveGate` before it sends anything. */
export async function voiceGateBlockedReason(
  db: Database,
  projectId: string,
): Promise<string | undefined> {
  return (await voiceReviewModel(db, projectId)).blockedReason
}
