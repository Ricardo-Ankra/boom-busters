'use client'

import { slugFromName } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { channelHref } from '@/lib/channel-href'
import { createChannelAction } from './channel-actions'

/**
 * Start a channel: a name, a handle, an address and where its settings begin.
 * The address follows the name until it is edited by hand. The bible starts
 * blank either way; it is the first thing the new channel's setup asks for.
 */
export function NewChannelForm({ channels }: { channels: { id: string; name: string }[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [name, setName] = React.useState('')
  const [handle, setHandle] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [slugEdited, setSlugEdited] = React.useState(false)
  const [copy, setCopy] = React.useState(false)
  const [copyFrom, setCopyFrom] = React.useState(channels[0]?.id ?? '')
  const [busy, setBusy] = React.useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const trimmedHandle = handle.trim()
      const result = await createChannelAction({
        name,
        handle: trimmedHandle === '' ? null : trimmedHandle,
        slug,
        startFrom: copy ? { copyFromChannelId: copyFrom } : 'defaults',
      })
      if (!result.ok || !result.slug) {
        toast({
          title: 'Could not create the channel',
          description: result.error,
          variant: 'error',
        })
        return
      }
      router.push(channelHref(result.slug, '/settings', { tab: 'channel' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New channel</CardTitle>
        <CardDescription>
          The address is permanent: an archived channel keeps it, so it can never name another.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-channel-name">Name</Label>
            <Input
              id="new-channel-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (!slugEdited) setSlug(slugFromName(event.target.value))
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-channel-handle">Handle</Label>
            <Input
              id="new-channel-handle"
              value={handle}
              placeholder="@yourchannel"
              onChange={(event) => setHandle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-channel-slug">Address</Label>
            <Input
              id="new-channel-slug"
              value={slug}
              className="font-mono"
              onChange={(event) => {
                setSlug(event.target.value)
                setSlugEdited(true)
              }}
            />
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
            Start from
          </legend>
          <label className="flex min-h-10 items-center gap-2 text-[14px]">
            <input type="radio" name="start-from" checked={!copy} onChange={() => setCopy(false)} />
            House defaults
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-10 items-center gap-2 text-[14px]">
              <input type="radio" name="start-from" checked={copy} onChange={() => setCopy(true)} />
              Copy from
            </label>
            <Select
              aria-label="Channel to copy from"
              value={copyFrom}
              disabled={!copy}
              onChange={(event) => setCopyFrom(event.target.value)}
              className="w-56"
            >
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            A copy carries the brand kit, voice, model routing, render and publishing settings. It
            never carries the bible, logos or the YouTube connection.
          </p>
        </fieldset>

        <div>
          <Button
            variant="primary"
            busy={busy}
            disabled={name.trim() === '' || slug === '' || (copy && copyFrom === '')}
            onClick={() => void create()}
          >
            Create channel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
