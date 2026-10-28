import type { Route } from 'next'

/**
 * Hrefs into one channel's console (`/c/<slug>/...`). No server imports, so
 * client components can build links with it too.
 */

export type ChannelSection = '' | '/projects' | '/cases' | '/calendar' | '/costs' | '/settings'

/** The cookie the proxy writes so `/` can land on the channel last used. */
export const LAST_CHANNEL_COOKIE = 'bb-last-channel'

export function channelHref(
  slug: string,
  section: ChannelSection = '',
  query?: Record<string, string>,
): Route {
  const search = query ? new URLSearchParams(query).toString() : ''
  return `/c/${slug}${section}${search ? `?${search}` : ''}` as Route
}

/** The slug in a `/c/<slug>` path, or null when the path is not inside a channel. */
export function slugFromPath(pathname: string): string | null {
  const match = /^\/c\/([^/]+)(?:\/|$)/.exec(pathname)
  return match?.[1] ?? null
}
