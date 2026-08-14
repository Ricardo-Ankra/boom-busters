'use server'

import { editChapter, flagTake, getChapter, getSettings, getVoiceTake, unflagTake } from '@boom-busters/db'
import { narrationUnitKind, narrationUnits, rereadCanDiffer } from '@boom-busters/providers'
import {
  UlidSchema,
  estimateRuntimeSec,
  replaceParagraph,
  splitParagraphs,
  takeIdempotencyKey,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import { db } from '@/lib/db'
import { voiceKeyFacts } from '@/lib/voice-identity'
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
 * ledger and it is worth keeping. The repair is now an explicit second press:
 *
 *  - **`rereadParagraph`** — fix the words and read them again. The only lever
 *    that exists on Chirp, and the right one for a missing pause, an awkward
 *    line, or a name the narrator mangles.
 *  - **`retakeVoiceTake`** — read the same words again, offered only where that
 *    can differ (`rereadCanDiffer`): ElevenLabs samples, Gemini prompts, Chirp
 *    does neither.
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
    return { ok: false, error: 'Say what was wrong with it, so the row still means something later.' }
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

  const settings = await getSettings(db)
  const unitKind = narrationUnitKind(settings.tts.provider)

  const unit = narrationUnits({
    provider: settings.tts.provider,
    chapters: [{ id: chapter.id, title: chapter.title, contentMd: chapter.contentMd }],
  }).find((candidate) => candidate.unitIndex === take.paragraphIndex)

  if (!unit) {
    return {
      ok: false,
      error:
        `That ${unitKind} is no longer in the chapter — it has been edited since this take was ` +
        'made. Re-run the voice stage to narrate the script as it stands.',
    }
  }

  if (unit.text === trimmed) {
    return {
      ok: false,
      error:
        'Those are the same words. To change the reading without changing them, use ' +
        '"Another take" where it is offered — otherwise change something; punctuation is what ' +
        'buys a pause.',
    }
  }

  let contentMd: string | undefined
  if (unitKind === 'paragraph') {
    // Byte-preserving, and refuses splits: in paragraph mode every later
    // paragraph's narration is addressed by its index.
    contentMd = replaceParagraph(chapter.contentMd, take.paragraphIndex, trimmed)
    if (contentMd === undefined) {
      return {
        ok: false,
        error:
          'A paragraph cannot be split in two from here: every later paragraph would shift by ' +
          'one and lose the narration addressed to it. Split it in the Script Studio and re-run ' +
          'the voice stage.',
      }
    }
  } else {
    /**
     * A scene covers a run of source paragraphs; the edit replaces exactly
     * that span. Splits are fine here — the scene is re-packed from whatever
     * paragraphs it now contains, and only this chapter's later scenes (rare:
     * most chapters are one scene) can shift.
     */
    const paragraphs = splitParagraphs(chapter.contentMd)
    const [start, end] = unit.paragraphSpan
    contentMd = [...paragraphs.slice(0, start), trimmed, ...paragraphs.slice(end)].join('\n\n')
  }

  await editChapter(db, {
    chapterId: take.chapterId,
    afterText: contentMd,
    editType: 'human',
    note: `Re-read of ${unitKind} ${take.paragraphIndex + 1}`,
    estRuntimeSec: estimateRuntimeSec(contentMd),
  })

  return enqueueRetake(take.projectId, takeId, 'Re-read after an edit')
}

/**
 * Buy this paragraph again — as another performance, or as a regeneration.
 *
 * Two distinct reasons arrive at the same purchase, and the server sorts out
 * which is which rather than trusting the UI:
 *
 *  - **Another take** (`direction` optional): the same words performed again,
 *    only meaningful where `rereadCanDiffer`. On Gemini the direction travels
 *    into the prompt, so "slower on the dates" is a steer, not a hope.
 *  - **Regenerate a stale row**: the paragraph's fingerprint no longer matches
 *    its audio — the words, voice, pacing or a pronunciation moved on — so a
 *    fresh read is different *by input* and every narrator qualifies. The
 *    retaker recomputes the key from the current text and settings, which is
 *    exactly the regeneration wanted.
 *
 * Refused only when neither holds: identical input on a deterministic narrator
 * would buy the take just rejected, and the honest answer is to say so and
 * point at the words.
 */
export async function retakeVoiceTake(takeId: string, direction?: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(takeId).success) return { ok: false, error: 'Unknown take' }

  const trimmedDirection = direction?.trim() ?? ''
  if (trimmedDirection.length > 500) {
    return {
      ok: false,
      error: 'Keep the direction under 500 characters — it is a steer, not a brief.',
    }
  }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  const settings = await getSettings(db)
  const canDiffer = rereadCanDiffer(settings.tts.provider)

  // The same staleness the review screen shows: does the audio still match
  // what this unit would buy today?
  const chapter = await getChapter(db, take.chapterId)
  const unit = chapter
    ? narrationUnits({
        provider: settings.tts.provider,
        chapters: [{ id: chapter.id, title: chapter.title, contentMd: chapter.contentMd }],
      }).find((candidate) => candidate.unitIndex === take.paragraphIndex)
    : undefined
  if (!unit) {
    return {
      ok: false,
      error:
        'That section is no longer in the chapter — it has been edited since this take was ' +
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

  if (!stale && !canDiffer) {
    return {
      ok: false,
      error:
        `${settings.tts.provider} reads the same words the same way every time, so this would ` +
        'buy the take you just rejected. Edit the words instead.',
    }
  }

  const note =
    trimmedDirection !== ''
      ? trimmedDirection
      : stale
        ? 'Regenerated after a change'
        : (take.note ?? 'Retake')

  // Direction only where a narrator can act on it — sending "less cheerful" to
  // a vendor with no prompt field would be recorded as honoured and wasn't.
  return enqueueRetake(
    take.projectId,
    takeId,
    note,
    canDiffer && trimmedDirection !== '' ? trimmedDirection : undefined,
  )
}

async function enqueueRetake(
  projectId: string,
  takeId: string,
  note: string,
  direction?: string,
): Promise<ActionResult> {
  try {
    await inngest.send(
      events.voiceRetakeRequested.create({
        projectId,
        takeId,
        note,
        ...(direction ? { direction } : {}),
      }),
    )
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
