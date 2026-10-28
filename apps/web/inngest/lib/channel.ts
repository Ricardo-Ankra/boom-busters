import { isBibleComplete } from '@boom-busters/schemas'
import type { ChannelBible } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'

/**
 * A channel whose bible is incomplete must not spend on research: the
 * prompts read the bible, and a blank one writes about nothing. The dossier
 * stage is the first stage of every project, so gating it gates them all.
 * Non-retriable, because no retry fills in a form.
 */
export function requireCompleteBible(channel: { bible: ChannelBible; slug: string }): void {
  if (!isBibleComplete(channel.bible)) {
    throw new NonRetriableError(
      `channel bible incomplete: complete it in the ${channel.slug} channel settings`,
    )
  }
}
