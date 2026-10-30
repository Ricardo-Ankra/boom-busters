'use client'

import { PREVIEW_STAGES } from '@boom-busters/providers'
import type { ChannelBible } from '@boom-busters/schemas'
import * as React from 'react'
import { Label } from '@/components/ui/input'
import { previewStagePromptAction } from './bible-actions'

/** The preview waits this long after the last change before it asks. */
const DEBOUNCE_MS = 500

type Shown = { ok: true; text: string } | { ok: false; error: string } | null

/**
 * "What the models are told": the composed system prompt of one stage, built
 * from the draft as it stands, so the owner reads what the models will be
 * told before saving.
 */
export function BiblePreview({ channelId, bible }: { channelId: string; bible: ChannelBible }) {
  const [stage, setStage] = React.useState<string>(PREVIEW_STAGES[0])
  const [shown, setShown] = React.useState<Shown>(null)
  const requests = React.useRef(0)

  React.useEffect(() => {
    const timer = setTimeout(async () => {
      const mine = ++requests.current
      const result = await previewStagePromptAction(channelId, stage, bible)
      // A newer request has gone out since: its answer is the one to show.
      if (mine === requests.current) setShown(result)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [channelId, stage, bible])

  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-4">
      <h3 className="text-[14px] font-semibold">What the models are told</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bible-preview-stage">Stage</Label>
        <select
          id="bible-preview-stage"
          value={stage}
          onChange={(event) => setStage(event.target.value)}
          className="h-10 w-48 rounded-[8px] border border-[var(--color-border-strong)] bg-transparent px-3 text-[13px]"
        >
          {PREVIEW_STAGES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      {shown && !shown.ok ? (
        <p role="alert" className="text-[13px] text-[var(--color-danger)]">
          {shown.error}
        </p>
      ) : null}
      {shown?.ok ? (
        <pre className="max-h-96 overflow-auto rounded-[8px] bg-[var(--color-surface-raised)] p-3 font-mono text-[12px] whitespace-pre-wrap">
          {shown.text}
        </pre>
      ) : null}
    </div>
  )
}
