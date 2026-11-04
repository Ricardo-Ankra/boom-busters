'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { copyMotionFromChannelAction } from './exemplar-actions'

/**
 * "Copy motion from another channel" (spec 2026-11-04, section 9.4): the
 * identity, the references and the approved exemplars of the chosen
 * channel, as a fork. A confirm, since it replaces this channel's identity.
 */

export function CopyMotion({
  channelId,
  sources,
  disabled,
}: {
  channelId: string
  /** Every other channel, archived ones included. */
  sources: readonly { id: string; name: string; archived: boolean }[]
  disabled: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [sourceId, setSourceId] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const copy = async () => {
    setBusy(true)
    try {
      const result = await copyMotionFromChannelAction(channelId, sourceId)
      if (!result.ok) {
        toast({ title: 'Could not copy the motion', description: result.error, variant: 'error' })
        return
      }
      toast({ title: result.note ?? 'Copied' })
      setSourceId('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Copy motion from another channel</CardTitle>
        <CardDescription>
          Start from another channel's pack: its identity, its references and its approved exemplars
          come across as a fork. Later changes to either channel never touch the other.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sources.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            No other channel to copy from.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="copy-motion-source">Copy motion from</Label>
              <Select
                id="copy-motion-source"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                disabled={disabled || busy}
              >
                <option value="">Choose a channel</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.archived ? `${source.name} (archived)` : source.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <ConfirmButton
                label="Copy motion from this channel"
                confirmLabel="Yes, copy it"
                consequence="Replaces this channel's identity, adds the references and the approved exemplars"
                onConfirm={copy}
                disabled={disabled || busy || sourceId === ''}
                busy={busy}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
