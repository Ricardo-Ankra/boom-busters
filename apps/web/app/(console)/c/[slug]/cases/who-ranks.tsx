'use client'

import type { CaseSummary } from '@boom-busters/db'
import {
  OPEN_DOOR_MAX_SUBSCRIBERS,
  OPEN_DOOR_MIN_VIEWS,
  SHORT_MAX_SECONDS,
  briefHasFullChecks,
  caseResearchJobIsRunning,
  openDoors,
} from '@boom-busters/schemas'
import type { FieldCheck, FieldResult } from '@boom-busters/schemas'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { checkWhoRanksAction } from './actions'
import type { Run } from './search-brief-panel'

/**
 * The Who ranks now block: the top ten for the target keyword as compact
 * rows, the other candidates behind a toggle, and a paid check for a target
 * that has none yet. It is the evidence behind the Competition verdict.
 */

const YEAR_MS = 365.25 * 86_400_000

const grouped = new Intl.NumberFormat('en-ZA')
const fmt = (value: number): string => grouped.format(value)

const keyOf = (term: string): string => term.trim().toLowerCase()

/** `m:ss`, or `h:mm:ss` from an hour up. */
export function lengthLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Years between publication and the research date, so the figure does not drift with the viewing date. */
function ageYears(result: FieldResult, checkedAt: string): number | null {
  if (result.publishedAt === null) return null
  const published = Date.parse(result.publishedAt)
  const at = Date.parse(checkedAt)
  if (Number.isNaN(published) || Number.isNaN(at)) return null
  return Math.max(0, (at - published) / YEAR_MS)
}

const isOpenDoor = (r: FieldResult): boolean =>
  r.subscribers !== null &&
  r.views !== null &&
  r.subscribers < OPEN_DOOR_MAX_SUBSCRIBERS &&
  r.views >= OPEN_DOOR_MIN_VIEWS

function ResultRow({ result, checkedAt }: { result: FieldResult; checkedAt: string }) {
  const age = ageYears(result, checkedAt)
  const figures = [
    result.subscribers === null ? null : `${fmt(result.subscribers)} subscribers`,
    result.views === null ? null : `${fmt(result.views)} views`,
    age === null ? null : `${age.toFixed(1)} years`,
    result.seconds === null ? null : lengthLabel(result.seconds),
  ].filter((part) => part !== null)
  const short = result.seconds !== null && result.seconds <= SHORT_MAX_SECONDS
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--color-border)] py-2 text-[13px]">
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
        {result.channelTitle ?? 'Unknown channel'}
      </span>
      <span className="font-mono text-[12px] text-[var(--color-text-secondary)] tabular-nums">
        {figures.join(' · ')}
      </span>
      {short ? (
        <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
          Short
        </span>
      ) : null}
      {isOpenDoor(result) ? (
        <span className="rounded-full bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-success)]">
          Open door
        </span>
      ) : null}
    </li>
  )
}

function Field({ check }: { check: FieldCheck }) {
  const doors = openDoors(check)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[12px] text-[var(--color-text-muted)]">
        Top {check.results.length} for <span className="font-mono">{check.keyword}</span>
        {` · ${doors} ${doors === 1 ? 'open door' : 'open doors'}`}
      </p>
      {check.results.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">No videos came back.</p>
      ) : (
        <ul aria-label={`Who ranks for ${check.keyword}`} className="flex flex-col">
          {check.results.map((result) => (
            <ResultRow key={result.videoId} result={result} checkedAt={check.checkedAt} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function WhoRanks({ item, run }: { item: CaseSummary; run: Run }) {
  const brief = item.searchBrief
  const [others, setOthers] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  if (brief === null || brief.targetKeyword === null || !briefHasFullChecks(brief)) return null

  const checks = brief.fieldChecks ?? []
  const wanted = keyOf(brief.targetKeyword.keyword)
  const target = checks.find((c) => keyOf(c.keyword) === wanted)
  const rest = checks.filter((c) => c !== target)
  const running = item.searchJob !== null && caseResearchJobIsRunning(item.searchJob)

  return (
    <section id="evidence-competition" className="flex scroll-mt-4 flex-col gap-2">
      <h4 className="text-[13px] font-semibold">Who ranks now</h4>
      <p className="text-[12px] text-[var(--color-text-muted)]">
        An open door is a channel under {fmt(OPEN_DOOR_MAX_SUBSCRIBERS)} subscribers with{' '}
        {fmt(OPEN_DOOR_MIN_VIEWS)} views or more on its video.
      </p>

      {target !== undefined ? (
        <Field check={target} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Not checked for this keyword.
          </p>
          <ConfirmButton
            label="Check who ranks now"
            confirmLabel="Check now"
            confirmVariant="primary"
            consequence="About 5 VidIQ credits."
            disabled={running}
            title={running ? 'Research is running' : undefined}
            busy={busy}
            onConfirm={async () => {
              if (busy) return
              setBusy(true)
              try {
                await run(async () => {
                  try {
                    return await checkWhoRanksAction(item.id)
                  } catch {
                    return { ok: false, error: 'Could not check who ranks. Try again.' }
                  }
                }, 'Who ranks is checked')
              } finally {
                setBusy(false)
              }
            }}
          />
        </div>
      )}

      {rest.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div>
            <Button variant="ghost" aria-expanded={others} onClick={() => setOthers(!others)}>
              {others ? 'Hide the other keywords checked' : 'Show the other keywords checked'}
            </Button>
          </div>
          {others ? rest.map((check) => <Field key={check.keyword} check={check} />) : null}
        </div>
      ) : null}
    </section>
  )
}
