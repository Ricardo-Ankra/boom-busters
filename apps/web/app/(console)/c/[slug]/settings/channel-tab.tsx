'use client'

import type { ChannelBible } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { BIBLE_TEXT_FIELDS, missingBibleFields } from '@/lib/bible-fields'
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
  bible?: ChannelBible
}

const textareaClass =
  'min-h-24 w-full rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] ' +
  'px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/**
 * The Channel tab: who the channel is (name, handle), the bible the prompts
 * read, and the way to archive it. `commit` saves a patch through the form,
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
      <IdentityCard channel={channel} saving={saving} commit={commit} />
      <BibleCard channel={channel} saving={saving} commit={commit} />
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

function BibleCard({
  channel,
  saving,
  commit,
}: {
  channel: ChannelView
  saving: boolean
  commit: (patch: ChannelPatch) => Promise<void>
}) {
  const [bible, setBible] = React.useState(channel.bible)
  const missing = missingBibleFields(bible)

  const setField = (key: (typeof BIBLE_TEXT_FIELDS)[number]['key'], value: string) =>
    setBible((current) => ({ ...current, [key]: value }))

  const setCategory = (index: number, change: { key?: string; label?: string }) =>
    setBible((current) => ({
      ...current,
      caseCategories: current.caseCategories.map((entry, at) =>
        at === index ? { ...entry, ...change } : entry,
      ),
    }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Channel bible</CardTitle>
        <CardDescription>
          What the prompts used to hard-code. Until it is complete this channel cannot suggest
          cases, start a project or run research.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p
          role="status"
          className={
            missing.length === 0
              ? 'text-[13px] text-[var(--color-success)]'
              : 'text-[13px] text-[var(--color-warning)]'
          }
        >
          {missing.length === 0
            ? 'Bible complete'
            : `Bible incomplete: ${missing.length} field${missing.length === 1 ? '' : 's'}`}
        </p>

        {BIBLE_TEXT_FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`bible-${field.key}`}>{field.label}</Label>
            <textarea
              id={`bible-${field.key}`}
              className={textareaClass}
              value={bible[field.key]}
              disabled={saving}
              onChange={(event) => setField(field.key, event.target.value)}
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">{field.hint}</p>
          </div>
        ))}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium text-[var(--color-text-secondary)]">
            Case categories
          </legend>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            At least two. The key is lower-case letters, digits, dashes or underscores.
          </p>
          {bible.caseCategories.map((category, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Category ${index + 1} key`}
                value={category.key}
                disabled={saving}
                className="w-40 font-mono"
                onChange={(event) => setCategory(index, { key: event.target.value })}
              />
              <Input
                aria-label={`Category ${index + 1} label`}
                value={category.label}
                disabled={saving}
                className="w-56"
                onChange={(event) => setCategory(index, { label: event.target.value })}
              />
              <Button
                variant="ghost"
                disabled={saving}
                aria-label={`Remove category ${index + 1}`}
                onClick={() =>
                  setBible((current) => ({
                    ...current,
                    caseCategories: current.caseCategories.filter((_, at) => at !== index),
                  }))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() =>
                setBible((current) => ({
                  ...current,
                  caseCategories: [...current.caseCategories, { key: '', label: '' }],
                }))
              }
            >
              Add category
            </Button>
          </div>
        </fieldset>

        <div>
          <Button variant="primary" disabled={saving} onClick={() => void commit({ bible })}>
            Save bible
          </Button>
        </div>
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
