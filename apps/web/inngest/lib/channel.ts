import { isBibleComplete } from '@boom-busters/schemas'
import type { BibleInUse } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { FROZEN_BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'

/**
 * A project whose frozen bible version is incomplete must not spend on
 * research: the prompts read the bible, and a blank one writes about
 * nothing. The dossier stage is the first stage of every project, so gating
 * it gates them all, and every later step that builds a prompt from the
 * bible repeats the check inside its own step, so a project frozen to an
 * incomplete version sends nothing. Gates sit before any mock or live
 * branch, so MOCK_PROVIDERS refuses the same way. The check uses the slot ids that version was saved
 * with, so a slot added since cannot fail a project that started before it.
 * Non-retriable, because no retry fills in a form.
 */
export function requireCompleteBible<T extends BibleInUse & { slug: string }>(inUse: T): T {
  if (!isBibleComplete(inUse.bible, inUse.slotIds)) {
    throw new NonRetriableError(FROZEN_BIBLE_INCOMPLETE_MESSAGE)
  }
  return inUse
}
