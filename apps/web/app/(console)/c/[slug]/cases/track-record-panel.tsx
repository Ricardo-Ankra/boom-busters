'use client'

import type { ResearchThresholds, VerdictCheck } from '@boom-busters/schemas'
import { ChevronDown, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import type { Run } from './search-brief-panel'
import type { TrackRecordData } from './track-record-data'
import { applySuggestionAction, dismissSuggestionAction, resetTuningAction } from './tuning-actions'

/**
 * The Search track record: how each research check did against what the
 * published videos showed at day 28, the threshold changes that evidence
 * supports, the values already applied, and which intents held. Everything
 * changes through a visible button; the intent list is information only.
 */

const CHECK_LABEL: Record<VerdictCheck, string> = {
  demand: 'Demand',
  competition: 'Competition',
  intent: 'Intent',
  angle: 'Angle',
  fit: 'Fit',
}

const KEY_LABEL: Record<keyof ResearchThresholds, string> = {
  demandWarn: 'Demand warning line',
  demandOk: 'Strong demand line',
  openDoorMaxSubscribers: 'Open door size',
  openDoorMinViews: 'Open door views',
  pickFloor: 'Pick floor',
  searchShareMin: 'Search share minimum',
  targetShareMin: 'Target share minimum',
  targetViewsMin: 'Target views minimum',
  listedViewsMin: 'Listed views minimum',
  holdRatio: 'Hold ratio',
  tooEarlyViews: 'Too early views',
}

const fmt = (n: number) => n.toLocaleString('en-US')
const videosWord = (n: number) => `${fmt(n)} ${n === 1 ? 'video' : 'videos'}`
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

const SECTION = 'flex flex-col gap-2 rounded-[10px] border border-[var(--color-border)] p-4'

function CheckRow({ row }: { row: TrackRecordData['checks'][number] }) {
  const [open, setOpen] = React.useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-left text-[14px] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      >
        <Chevron aria-hidden className="size-4" />
        {`${CHECK_LABEL[row.check]} called it right on ${fmt(row.right)} of ${videosWord(row.counted)}`}
      </button>
      {open ? (
        <ul className="ml-6 flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
          {row.videos.map((v) => (
            <li key={v.projectId} className="flex gap-2">
              <span>{v.title}</span>
              <span>{v.right ? 'Right' : 'Wrong'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function TrackRecordPanel({
  channelId,
  data,
  run,
  onClose,
}: {
  channelId: string
  data: TrackRecordData
  run: Run
  onClose: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const act = async (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(true)
    try {
      await run(action, success)
    } finally {
      setBusy(false)
    }
  }
  const waiting = data.counted < 5

  return (
    <section aria-labelledby="track-record" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="track-record" className="text-[20px] font-semibold">
          Search track record
        </h2>
        <Button variant="outline" onClick={onClose}>
          Back to the case
        </Button>
      </div>

      {waiting ? (
        <p className={`${SECTION} text-[14px]`}>
          {`The track record starts after 5 videos have a day-28 report. So far: ${fmt(data.counted)}.`}
        </p>
      ) : (
        <div className={SECTION}>
          <h3 className="text-[15px] font-semibold">How each check did</h3>
          <ul className="flex flex-col gap-2">
            {data.checks.map((row) => (
              <CheckRow key={row.check} row={row} />
            ))}
          </ul>
        </div>
      )}

      {data.suggestions.length === 0 ? null : (
        <div className={SECTION}>
          <h3 className="text-[15px] font-semibold">Suggestions</h3>
          <ul className="flex flex-col gap-3">
            {data.suggestions.map((s) => (
              <li key={`${s.key}-${s.direction}`} className="flex flex-col gap-2">
                <p className="text-[14px]">{s.sentence}</p>
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  {`${KEY_LABEL[s.key]}: ${fmt(s.from)} to ${fmt(s.to)}, from ${videosWord(s.support.length)}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => applySuggestionAction(channelId, s.key, s.direction),
                        `${KEY_LABEL[s.key]} is now ${fmt(s.to)}`,
                      )
                    }
                  >
                    Apply
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => dismissSuggestionAction(channelId, s.key, s.direction),
                        'Suggestion dismissed',
                      )
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.applied.length === 0 ? null : (
        <div className={SECTION}>
          <h3 className="text-[15px] font-semibold">Applied values</h3>
          <ul className="flex flex-col gap-3">
            {data.applied.map((a) => (
              <li key={a.key} className="flex flex-col gap-2">
                <p className="text-[14px]">
                  {`${KEY_LABEL[a.key]}: ${fmt(a.value)}`}
                  {a.previous === null ? '' : `, was ${fmt(a.previous)}`}
                  {`, applied ${dateOf(a.appliedAt)}`}
                </p>
                {a.evidence ? (
                  <p className="text-[12px] text-[var(--color-text-secondary)]">{a.evidence}</p>
                ) : null}
                <div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      act(() => resetTuningAction(channelId, a.key), `${KEY_LABEL[a.key]} reset`)
                    }
                  >
                    Reset to default
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.intents.length === 0 ? null : (
        <div className={SECTION}>
          <h3 className="text-[15px] font-semibold">Intents and topics that held</h3>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            For information only. Nothing here changes a threshold.
          </p>
          <ul className="flex flex-col gap-1 text-[14px]">
            {data.intents.map((i) => (
              <li key={i.label} className="flex gap-2">
                <span>{i.label}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {`${fmt(i.good)} of ${videosWord(i.total)} held well`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
