'use server'

import {
  editChapter,
  flagTake,
  getChapter,
  getSettings,
  getVoiceTake,
  unflagTake,
} from '@boom-busters/db'
import { narrationUnits } from '@boom-busters/providers'
import {
  UlidSchema,
  estimateRuntimeSec,
  replaceParagraph,
  takeIdempotencyKey,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import { db } from '@/lib/db'
import { voiceKeyFacts } from '@/lib/voice-identity'
import { voiceReviewModel } from '@/lib/voice-review'
import type { ActionResult } from '../actions'

/**
 * The buttons on a voice review row (build spec section 11.3).
 *
 * **Flagging is a verdict, not a repair, and it no longer spends.** Spec §11.3
 * says "flagging opens a note field and enqueues the retake immediately", and
 * that was built and used before the flaw showed: a retake is the same text in
 * the same voice at the same speaking rate, and on Cloud Text-to-Speech that is
 * *by construction* the same audio — the request carries plain text and a
 * speaking rate and exposes no sampling control. So every flag quietly bought a
 * byte-for-byte re-run of the take just rejected, and the note explaining what
 * was wrong went into the row and nowhere near the vendor.
 *
 * What flagging is genuinely for is the gate: `voiceApprovalBlockedReason`
 * refuses approval while any take is flagged, so a listen-through can mark six
 * problems and the stage stays shut until each is dealt with. That is a review
 * ledger and it is worth keeping. The repair is an explicit second press:
 *
 *  - **`rereadParagraph`** — fix the words and read them again. The precise
 *    lever, and on ElevenLabs it carries the direction too: audio tags, pause
 *    tags and respellings all live in the text.
 *  - **`retakeVoiceTake`** — the same words performed again. ElevenLabs
 *    samples, so this is a genuine second take, not a re-purchase of the one
 *    just rejected.
 */

async function requireOwner(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!email) throw new Error('Not signed in')
  return email
}

function refresh(projectId: string): void {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
}

export async function flagVoiceTake(takeId: string, note: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(takeId).success) return { ok: false, error: 'Unknown take' }

  const trimmed = note.trim()
  if (trimmed === '') {
    return {
      ok: false,
      error: 'Say what was wrong with it, so the row still means something later.',
    }
  }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  // No event, and nothing bought. The flag holds the gate shut; the repair is
  // a separate, deliberate press. See the note at the top of this file.
  await flagTake(db, takeId, trimmed)

  refresh(take.projectId)
  return { ok: true }
}

/**
 * Fix the words of one paragraph and read it again.
 *
 * The edit goes through `editChapter`, the same path the Script Studio uses, so
 * it lands in the edit trail as a `human` edit and the diff is reviewable. It is
 * emphatically not a second way to write `chapters.contentMd` — this project has
 * already been bitten once by growing a private path to a field that had a
 * shared one.
 *
 * Only the target paragraph's bytes change: `replaceParagraph` keeps every other
 * block exactly as it was, because a re-flowed chapter would arrive in the trail
 * as a diff touching every line and hide the one word that actually moved.
 */
export async function rereadParagraph(takeId: string, text: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(takeId).success) return { ok: false, error: 'Unknown take' }

  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, error: 'The words cannot be empty.' }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  const chapter = await getChapter(db, take.chapterId)
  if (!chapter) return { ok: false, error: 'The chapter this take belongs to is gone.' }

  const unit = narrationUnits({
    chapters: [{ id: chapter.id, title: chapter.title, contentMd: chapter.contentMd }],
  }).find((candidate) => candidate.unitIndex === take.paragraphIndex)

  if (!unit) {
    return {
      ok: false,
      error:
        'That paragraph is no longer in the chapter — it has been edited since this take was ' +
        'made. Re-run the voice stage to narrate the script as it stands.',
    }
  }

  if (unit.text === trimmed) {
    return {
      ok: false,
      error:
        'Those are the same words. To change the reading without changing them, use ' +
        '"Another take" — otherwise change something: a tag like [pause] or [sighs], or the ' +
        'punctuation, is what changes the delivery.',
    }
  }

  // Byte-preserving, and refuses splits: every later paragraph's narration is
  // addressed by its index.
  const contentMd = replaceParagraph(chapter.contentMd, take.paragraphIndex, trimmed)
  if (contentMd === undefined) {
    return {
      ok: false,
      error:
        'A paragraph cannot be split in two from here: every later paragraph would shift by ' +
        'one and lose the narration addressed to it. Split it in the Script Studio and re-run ' +
        'the voice stage.',
    }
  }

  await editChapter(db, {
    chapterId: take.chapterId,
    afterText: contentMd,
    editType: 'human',
    note: `Re-read of paragraph ${take.paragraphIndex + 1}`,
    estRuntimeSec: estimateRuntimeSec(contentMd),
  })

  return enqueueRetake(take.projectId, takeId, 'Re-read after an edit')
}

/**
 * Buy this paragraph again — as another performance, or as a regeneration.
 *
 * Two distinct reasons arrive at the same purchase:
 *
 *  - **Another take**: the same words performed again. ElevenLabs samples, so
 *    a second reading is a genuine second performance. To *steer* it, edit
 *    the words instead — tags and punctuation are the direction channel.
 *  - **Regenerate a stale row**: the paragraph's fingerprint no longer
 *    matches its audio — the words, voice, stability or a pronunciation
 *    moved on. The retaker recomputes the key from the current text and
 *    settings, which is exactly the regeneration wanted.
 *
 * The distinction only decides the note on the new take; the server computes
 * it rather than trusting the UI.
 */
export async function retakeVoiceTake(takeId: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(takeId).success) return { ok: false, error: 'Unknown take' }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  const settings = await getSettings(db)

  // The same staleness the review screen shows: does the audio still match
  // what this unit would buy today? Only the note depends on the answer.
  const chapter = await getChapter(db, take.chapterId)
  const unit = chapter
    ? narrationUnits({
        chapters: [{ id: chapter.id, title: chapter.title, contentMd: chapter.contentMd }],
      }).find((candidate) => candidate.unitIndex === take.paragraphIndex)
    : undefined
  if (!unit) {
    return {
      ok: false,
      error:
        'That paragraph is no longer in the chapter — it has been edited since this take was ' +
        'made. Re-run the voice stage to narrate the script as it stands.',
    }
  }

  const stale =
    take.idempotencyKey !==
    takeIdempotencyKey({
      projectId: take.projectId,
      chapterId: take.chapterId,
      paragraphIndex: take.paragraphIndex,
      text: unit.text,
      ...voiceKeyFacts(settings.tts),
    })

  const note = stale ? 'Regenerated after a change' : (take.note ?? 'Another take')

  return enqueueRetake(take.projectId, takeId, note)
}

async function enqueueRetake(
  projectId: string,
  takeId: string,
  note: string,
): Promise<ActionResult> {
  try {
    await inngest.send(events.voiceRetakeRequested.create({ projectId, takeId, note }))
  } catch (error) {
    console.error('[voice] could not enqueue the retake', error)
    refresh(projectId)
    return {
      ok: false,
      error:
        'Could not queue it: Inngest is unreachable. Start the dev server with ' +
        '`npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }

  refresh(projectId)
  return { ok: true }
}

/**
 * Regenerate every paragraph that changed since it was read, in one press.
 *
 * The per-row Regenerate is right for one paragraph; after a settings change
 * (a new voice, a moved stability tier, an added pronunciation) *dozens* of
 * rows go stale at once, and the repair was N presses spread across collapsed
 * chapters. The stale set is computed server-side by the same fingerprint the
 * review screen shows and the runner buys with, so this can only ever re-buy
 * exactly what changed.
 */
export async function regenerateChangedParagraphs(projectId: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(projectId).success) return { ok: false, error: 'Unknown project' }

  const model = await voiceReviewModel(db, projectId)
  const staleTakeIds = model.chapters.flatMap((chapter) =>
    chapter.paragraphs
      .filter((paragraph) => paragraph.stale && paragraph.current?.hasAudio)
      .map((paragraph) => paragraph.current!.id),
  )

  if (staleTakeIds.length === 0) {
    return { ok: false, error: 'Nothing has changed since it was read.' }
  }

  try {
    await inngest.send(
      staleTakeIds.map((takeId) =>
        events.voiceRetakeRequested.create({
          projectId,
          takeId,
          note: 'Regenerated after a change',
        }),
      ),
    )
  } catch (error) {
    console.error('[voice] could not enqueue the regeneration', error)
    return {
      ok: false,
      error:
        'Could not queue it: Inngest is unreachable. Start the dev server with ' +
        '`npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }

  refresh(projectId)
  return { ok: true }
}

/**
 * Clear a flag without buying anything.
 *
 * The way back from a mis-click, and from a second listen that changed your
 * mind. Without it the only route past an accidental flag is to pay for a
 * retake of audio that was fine.
 */
export async function clearVoiceFlag(takeId: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(takeId).success) return { ok: false, error: 'Unknown take' }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  if (take.status !== 'flagged') return { ok: false, error: 'That take is not flagged.' }

  await unflagTake(db, takeId)
  refresh(take.projectId)
  return { ok: true }
}
