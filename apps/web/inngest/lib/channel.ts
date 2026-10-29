import { isBibleComplete } from '@boom-busters/schemas'
import type { BibleInUse } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'

/**
 * A project whose frozen bible version is incomplete must not spend on
 * research: the prompts read the bible, and a blank one writes about
 * nothing. The dossier stage is the first stage of every project, so gating
 * it gates them all. The check uses the slot ids that version was saved
 * with, so a slot added since cannot fail a project that started before it.
 * Non-retriable, because no retry fills in a form.
 */
export function requireCompleteBible(inUse: BibleInUse & { slug: string }): void {
  if (!isBibleComplete(inUse.bible, inUse.slotIds)) {
    throw new NonRetriableError(
      `channel bible incomplete: complete it in the ${inUse.slug} channel settings`,
    )
  }
}
