'use client'

import type { ChannelBible } from '@boom-busters/schemas'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { missingBibleFields } from '@/lib/bible-fields'
import { channelHref } from '@/lib/channel-href'
import { archiveChannelAction } from './channel-actions'
import { NewChannelForm } from './new-channel-form'

export interface ChannelView {
  id: string
  slug: string
  name: string
  handle: string | null
  bible: ChannelBible
  archived: boolean
}

export interface ChannelPatch {
  name?: string
  handle?: string
}

/**
 * The Channel tab: who the channel is (name, handle), where its bible stands
 * and the way to archive it. `commit` saves a patch through the form,
 * which owns the channel's state the way it owns the settings.
 */
export function ChannelTab({
  channel,
  channels,
  showNew,
  saving,
  commit,
}: {
  channel: ChannelView
  /** Every live channel, for the New channel form's Copy from list. */
  channels: { id: string; name: string }[]
  /** `?new=1`: the New channel form opens above the rest. */
  showNew: boolean
  saving: boolean
  commit: (patch: ChannelPatch) => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-3">
      {showNew ? <NewChannelForm channels={channels} /> : null}
      {/* An archived channel is read-only. */}
      <IdentityCard channel={channel} saving={saving || channel.archived} commit={commit} />
      <BibleStatusCard channel={channel} />
      {channel.archived ? null : <ArchiveCard channel={channel} />}
    </div>
  )
}

function IdentityCard({
  channel,
  saving,
  commit,
}: {
  channel: ChannelView
  saving: boolean
  commit: (patch: ChannelPatch) => Promise<void>
}) {
  const [name, setName] = React.useState(channel.name)
  const [handle, setHandle] = React.useState(channel.handle ?? '')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Name and handle</CardTitle>
        <CardDescription>
          The address <span className="font-mono">/c/{channel.slug}</span> is fixed at creation.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-handle">Handle</Label>
            <Input
              id="channel-handle"
              value={handle}
              disabled={saving}
              placeholder="@yourchannel"
              onChange={(event) => setHandle(event.target.value)}
            />
          </div>
        </div>
        <div>
          <Button
            variant="outline"
            disabled={saving || name.trim() === ''}
            onClick={() => void commit({ name, handle })}
          >
            Save name and handle
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Where the bible stands, with the way to the tab that edits it. */
function BibleStatusCard({ channel }: { channel: ChannelView }) {
  const missing = missingBibleFields(channel.bible)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Channel bible</CardTitle>
        <CardDescription>
          Until it is complete this channel cannot suggest cases, start a project or run research.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <p
          role="status"
          className={
            missing.length === 0
              ? 'text-[13px] text-[var(--color-success)]'
              : 'text-[13px] text-[var(--color-warning)]'
          }
        >
          {missing.length === 0 ? 'Bible complete' : `Bible incomplete: ${missing.length} missing`}
        </p>
        <Link href="?tab=bible" className="text-[13px] text-[var(--color-accent-text)] underline">
          Open the Bible tab
        </Link>
      </CardContent>
    </Card>
  )
}

function ArchiveCard({ channel }: { channel: ChannelView }) {
  const router = useRouter()
  const { toast } = useToast()
  const [typed, setTyped] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const archive = async () => {
    setBusy(true)
    try {
      const result = await archiveChannelAction(channel.id, typed)
      if (!result.ok || !result.slug) {
        toast({
          title: 'Could not archive the channel',
          description: result.error,
          variant: 'error',
        })
        return
      }
      toast({ title: `${channel.name} archived` })
      router.push(channelHref(result.slug))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Archive channel</CardTitle>
        <CardDescription>
          Hides the channel from the switcher. Nothing is deleted and its address stays reserved.
          Refused while a run is running, a budget gate is open or a publish is scheduled here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="archive-confirm">{`Type ${channel.slug} to confirm`}</Label>
          <Input
            id="archive-confirm"
            value={typed}
            className="w-64 font-mono"
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <Button
          variant="danger"
          busy={busy}
          disabled={typed !== channel.slug}
          onClick={() => void archive()}
        >
          Archive channel
        </Button>
      </CardContent>
    </Card>
  )
}
