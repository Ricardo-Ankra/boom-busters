'use client'

import * as React from 'react'
import { channelHref } from '@/lib/channel-href'
import type { ChannelSection } from '@/lib/channel-href'

/**
 * The slug of the channel whose shell a client component sits in. A project
 * page lives at `/projects/<id>`, outside `/c/<slug>`, so a component there
 * cannot read its channel off the URL; the shell provides it instead.
 */
const ChannelSlugContext = React.createContext<string | null>(null)

export function ChannelSlugProvider({
  slug,
  children,
}: {
  slug: string
  children: React.ReactNode
}) {
  return <ChannelSlugContext.Provider value={slug}>{children}</ChannelSlugContext.Provider>
}

/** A link into the current channel; outside a shell it falls back to the old address, which redirects. */
export function useChannelHref(section: ChannelSection): string {
  const slug = React.useContext(ChannelSlugContext)
  return slug ? channelHref(slug, section) : section || '/'
}
