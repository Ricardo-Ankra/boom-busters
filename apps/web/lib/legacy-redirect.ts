import { redirect } from 'next/navigation'
import 'server-only'
import { channelHref } from './channel-href'
import type { ChannelSection } from './channel-href'
import { landingSlug } from './channel-context'

export type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * The old list addresses (`/projects`, `/cases`, `/settings?tab=voice`, ...)
 * still work: they send the owner to the same screen in the channel they last
 * used, keeping every query parameter so a bookmark or an old notification
 * lands where it always did.
 */
export async function redirectToLandingChannel(
  section: ChannelSection,
  searchParams: SearchParams,
): Promise<never> {
  const params = await searchParams
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first !== undefined) query[key] = first
  }
  const slug = await landingSlug()
  redirect(channelHref(slug, section, Object.keys(query).length > 0 ? query : undefined))
}
