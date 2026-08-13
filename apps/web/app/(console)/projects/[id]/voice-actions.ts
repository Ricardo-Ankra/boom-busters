'use server'

import { editChapter, flagTake, getChapter, getSettings, getVoiceTake, unflagTake } from '@boom-busters/db'
import { rereadCanDiffer } from '@boom-busters/providers'
import {
  UlidSchema,
  estimateRuntimeSec,
  replaceParagraph,
  splitParagraphs,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import { db } from '@/lib/db'
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
  if (trimmed === '') return { ok: false, error: 'The paragraph cannot be empty.' }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  const chapter = await getChapter(db, take.chapterId)
  if (!chapter) return { ok: false, error: 'The chapter this take belongs to is gone.' }

  const current = splitParagraphs(chapter.contentMd)[take.paragraphIndex]
  if (current === undefined) {
    return {
      ok: false,
      error:
        'That paragraph is no longer in the chapter — it has been edited since this take was ' +
        'made. Re-run the voice stage to narrate the script as it stands.',
    }
  }

  if (current === trimmed) {
    return {
      ok: false,
      error:
        'Those are the same words. On this narrator the same words give the same reading, so ' +
        'change something — punctuation is what buys a pause.',
    }
  }

  const contentMd = replaceParagraph(chapter.contentMd, take.paragraphIndex, trimmed)
  if (contentMd === undefined) {
    return {
      ok: false,
      error:
        'A paragraph cannot be split in two from here: every later paragraph would shift by one ' +
        'and lose the narration addressed to it. Split it in the Script Studio and re-run the ' +
        'voice stage.',
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
 * Read the same words again, on a narrator whose reading can differ.
 *
 * Refused where it cannot, rather than taking the money to return what was just
 * rejected. The UI hides the button there too, but a server that only trusts the
 * UI is a server with no rule.
 */
export async function retakeVoiceTake(takeId: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(takeId).success) return { ok: false, error: 'Unknown take' }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  const settings = await getSettings(db)
  if (!rereadCanDiffer(settings.tts.provider)) {
    return {
      ok: false,
      error:
        `${settings.tts.provider} reads the same words the same way every time, so this would ` +
        'buy the take you just rejected. Edit the words instead.',
    }
  }

  return enqueueRetake(take.projectId, takeId, take.note ?? 'Retake')
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
