'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  CHECKPOINTS,
  holdSec,
  normaliseTerm,
  OUTCOME_COPY,
  REPORT_LAG_DAYS,
} from '@boom-busters/schemas'
import type { BaselineBasis, Checkpoint, SearchReport } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { SearchReportsModel } from '@/lib/publish-review'
import {
  addTermToKeywordsAction,
  checkRankAction,
  dismissTermAction,
} from './search-report-actions'

/**
 * The Search report card on the publish screen: what YouTube search did for
 * the master, frozen at day 7, 28 and 90, or live as of the latest snapshot.
 * The live view judges nothing, so it carries no verdict. Every action is a
 * visible labelled button.
 */

/** VidIQ's price for the one search a rank check buys. */
const RANK_CREDITS = 5
const DAY_MS = 86_400_000

type View = Checkpoint | 'latest'

const number = (n: number): string => n.toLocaleString('en-US')
const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`
const one = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('en-US')

/** A day as the rest of the screen words it, fixed so the server and browser agree. */
function dayLabel(moment: Date | string): string {
  return new Date(moment).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** The day a checkpoint's report is fetched: publish day, plus N, plus the lag. */
function dueLabel(publishedAt: string | null | undefined, checkpoint: Checkpoint): string {
  if (!publishedAt) return 'Not due yet'
  const published = new Date(publishedAt)
  const start = Date.UTC(
    published.getUTCFullYear(),
    published.getUTCMonth(),
    published.getUTCDate(),
  )
  return `Due ${dayLabel(new Date(start + (checkpoint + REPORT_LAG_DAYS) * DAY_MS))}`
}

function basisWords(baseline: { basis: BaselineBasis; count?: number | undefined }): string {
  const { basis, count } = baseline
  if (basis === 'band') {
    return count === undefined
      ? 'against videos of similar length'
      : `against ${count} videos of similar length`
  }
  if (basis === 'channel') {
    return count === undefined
      ? 'against all earlier videos'
      : `against all ${count} earlier videos`
  }
  return "against this video's own average"
}

function rankWords(keyword: string, position: number | null): string {
  return position === null
    ? `Not in the top 10 for ${keyword}`
    : `Ranked ${position} for ${keyword}`
}

const GROUPS = [
  { bucket: 'target', title: 'The target' },
  { bucket: 'researched', title: 'Researched terms' },
  { bucket: 'unresearched', title: 'Unresearched terms' },
  { bucket: 'unmatched', title: 'Not matched to the research' },
] as const

export function SearchReportCard({
  projectId,
  reports,
}: {
  projectId: string
  reports: SearchReportsModel
}) {
  const router = useRouter()
  const frozenAt = (checkpoint: Checkpoint) =>
    reports.frozen.find((report) => report.checkpoint === checkpoint)
  const [view, setView] = React.useState<View>(() => (frozenAt(28) ? 28 : 'latest'))
  const [busy, setBusy] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<Record<string, { text: string; error: boolean }>>({})
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(new Set())
  const [fresh, setFresh] = React.useState<{ keyword: string; position: number | null } | null>(
    null,
  )
  const [rankError, setRankError] = React.useState<string | null>(null)

  if (reports.live === null && reports.frozen.length === 0) return null

  const report = view === 'latest' ? reports.live : (frozenAt(view) ?? null)
  const dismissed = new Set(reports.dismissed)
  const keyOf = (term: string) => normaliseTerm(term, reports.language).join(' ')
  const isHidden = (term: string) => dismissed.has(keyOf(term)) || hidden.has(keyOf(term))

  const runAdd = async (term: string) => {
    setBusy(`add:${term}`)
    try {
      const result = await addTermToKeywordsAction(projectId, term)
      setNotes((prev) => ({
        ...prev,
        [term]: result.ok
          ? { text: result.message ?? 'Added.', error: false }
          : { text: result.error ?? 'That did not work.', error: true },
      }))
      if (result.ok) router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const runDismiss = async (term: string) => {
    setBusy(`dismiss:${term}`)
    try {
      const result = await dismissTermAction(projectId, term)
      if (result.ok) {
        setHidden((prev) => new Set(prev).add(keyOf(term)))
        router.refresh()
      } else {
        setNotes((prev) => ({
          ...prev,
          [term]: { text: result.error ?? 'That did not work.', error: true },
        }))
      }
    } finally {
      setBusy(null)
    }
  }

  const runRank = async () => {
    setBusy('rank')
    setRankError(null)
    try {
      const result = await checkRankAction(projectId)
      if (result.ok && result.keyword !== undefined) {
        setFresh({ keyword: result.keyword, position: result.position ?? null })
        router.refresh()
      } else {
        setRankError(result.error ?? 'That did not work.')
      }
    } finally {
      setBusy(null)
    }
  }

  const verdict = (() => {
    if (view !== 'latest') {
      if (!report) return null
      return OUTCOME_COPY[report.outcome]
    }
    return reports.frozen.length === 0
      ? { label: 'Too early to judge', advice: 'The live numbers are shown meanwhile.' }
      : {
          label: 'Live numbers, not a verdict',
          advice: 'These run from the publish day to today. The frozen days carry the verdicts.',
        }
  })()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search report</CardTitle>
        <CardDescription>
          What YouTube search did for this video, at day 7, 28 and 90 after it went public.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Report day">
          {CHECKPOINTS.map((checkpoint) => {
            const frozen = frozenAt(checkpoint)
            return (
              <Button
                key={checkpoint}
                variant={view === checkpoint ? 'selected' : 'outline'}
                aria-pressed={view === checkpoint}
                disabled={!frozen}
                title={frozen ? undefined : dueLabel(reports.publishedAt, checkpoint)}
                onClick={() => setView(checkpoint)}
              >
                {`Day ${checkpoint}`}
              </Button>
            )
          })}
          <Button
            variant={view === 'latest' ? 'selected' : 'outline'}
            aria-pressed={view === 'latest'}
            onClick={() => setView('latest')}
          >
            Latest
          </Button>
        </div>

        {report === null ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            There are no search numbers for this view yet.
          </p>
        ) : (
          <ReportBody
            report={report}
            verdict={verdict}
            frozenView={view !== 'latest'}
            isHidden={isHidden}
            notes={notes}
            busy={busy}
            onAdd={(term) => void runAdd(term)}
            onDismiss={(term) => void runDismiss(term)}
          />
        )}

        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
          <RankBlock
            report={report}
            reports={reports}
            fresh={fresh}
            rankError={rankError}
            busy={busy === 'rank'}
            disabled={busy !== null}
            onCheck={() => void runRank()}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function ReportBody({
  report,
  verdict,
  frozenView,
  isHidden,
  notes,
  busy,
  onAdd,
  onDismiss,
}: {
  report: SearchReport
  verdict: { label: string; advice: string } | null
  frozenView: boolean
  isHidden: (term: string) => boolean
  notes: Record<string, { text: string; error: boolean }>
  busy: string | null
  onAdd: (term: string) => void
  onDismiss: (term: string) => void
}) {
  const holdBase = report.baselines.searchHoldSec.value
  const held = (hold: number | null): boolean =>
    holdBase !== null && hold !== null && hold >= report.thresholds.holdRatio * holdBase
  const overallHold = (() => {
    let views = 0
    let seconds = 0
    for (const bucket of Object.values(report.buckets)) {
      if (bucket.holdSec === null) continue
      views += bucket.views
      seconds += bucket.views * bucket.holdSec
    }
    return views > 0 ? seconds / views : null
  })()
  const muted = 'text-[12px] text-[var(--color-text-muted)]'

  return (
    <>
      <div className="flex flex-col gap-1">
        {verdict ? (
          <>
            <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {verdict.label}
            </p>
            <p className="text-[13px] text-[var(--color-text-secondary)]">{verdict.advice}</p>
          </>
        ) : null}
        <p className={muted}>
          {`${report.range.start} to ${report.range.end} · ${number(report.views)} views`}
          {report.matching === 'deterministic-only'
            ? ' · The terms were matched by words only, because the model call failed.'
            : null}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-[var(--color-text-primary)]">
          {report.searchShare === null
            ? 'Search share: not known yet'
            : `Search share: ${percent(report.searchShare)} (${number(report.searchViews)} of ${number(report.views)} views)`}
        </p>
        {report.targetKeyword ? (
          <p className={muted}>{`Target keyword: ${report.targetKeyword}`}</p>
        ) : (
          <p className={muted}>This video has no researched target keyword.</p>
        )}
      </div>

      {GROUPS.map(({ bucket, title }) => {
        const rows = report.terms.filter((row) => row.bucket === bucket && !isHidden(row.term))
        if (rows.length === 0) return null
        return (
          <div key={bucket} className="flex flex-col gap-1.5">
            <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">{title}</p>
            <ul className="flex flex-col gap-1.5">
              {rows.map((row) => {
                const hold = holdSec(row.views, row.minutes)
                const offer = frozenView && bucket === 'unresearched' && held(hold)
                const note = notes[row.term]
                return (
                  <li
                    key={row.term}
                    className="flex flex-col gap-1 rounded-[8px] border border-[var(--color-border)] p-2"
                  >
                    <p className="text-[13px] text-[var(--color-text-primary)]">
                      <span className="font-medium">{row.term}</span>
                      <span className="text-[var(--color-text-muted)]">
                        {` · ${number(row.views)} views`}
                        {hold === null ? '' : ` · ${number(Math.round(hold))} s hold`}
                      </span>
                    </p>
                    {row.reason ? <p className={muted}>{row.reason}</p> : null}
                    {offer ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          busy={busy === `add:${row.term}`}
                          disabled={busy !== null}
                          onClick={() => onAdd(row.term)}
                        >
                          Add to channel keywords
                        </Button>
                        <Button
                          variant="ghost"
                          busy={busy === `dismiss:${row.term}`}
                          disabled={busy !== null}
                          onClick={() => onDismiss(row.term)}
                        >
                          Not for us
                        </Button>
                      </div>
                    ) : null}
                    {note ? (
                      <p
                        role={note.error ? 'alert' : 'status'}
                        className={
                          note.error
                            ? 'text-[12px] text-[var(--color-danger)]'
                            : 'text-[12px] text-[var(--color-text-secondary)]'
                        }
                      >
                        {note.text}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      <p className={muted}>
        YouTube lists the top 25 search terms and hides rare ones, so the terms here are not all of
        the search views.
      </p>

      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">Delivery</p>
        <DeliveryRow
          label="Search hold (search viewers)"
          value={overallHold === null ? 'not known yet' : `${number(Math.round(overallHold))} s`}
          baseline={
            holdBase === null
              ? null
              : `${number(Math.round(holdBase))} s, ${basisWords(report.baselines.searchHoldSec)}`
          }
        />
        <DeliveryRow
          label="Early drop (all viewers)"
          value={report.earlyDrop === null ? 'not known yet' : percent(report.earlyDrop)}
          baseline={
            report.baselines.earlyDrop.value === null
              ? null
              : `${percent(report.baselines.earlyDrop.value)}, ${basisWords(report.baselines.earlyDrop)}`
          }
        />
        <DeliveryRow
          label="Subscribers per 1,000 views (whole video)"
          value={
            report.engagement.subscribersPer1k === null
              ? 'not known yet'
              : one(report.engagement.subscribersPer1k)
          }
          baseline={
            report.baselines.subscribersPer1k.value === null
              ? null
              : `${one(report.baselines.subscribersPer1k.value)}, ${basisWords(report.baselines.subscribersPer1k)}`
          }
        />
        <DeliveryRow
          label="Likes per 1,000 views (whole video)"
          value={
            report.engagement.likesPer1k === null
              ? 'not known yet'
              : one(report.engagement.likesPer1k)
          }
          baseline={null}
        />
        <DeliveryRow
          label="Comments per 1,000 views (whole video)"
          value={
            report.engagement.commentsPer1k === null
              ? 'not known yet'
              : one(report.engagement.commentsPer1k)
          }
          baseline={null}
        />
      </div>
    </>
  )
}

function DeliveryRow({
  label,
  value,
  baseline,
}: {
  label: string
  value: string
  baseline: string | null
}) {
  return (
    <p className="text-[13px] text-[var(--color-text-primary)]">
      {`${label}: ${value}`}
      {baseline ? (
        <span className="text-[var(--color-text-muted)]">{` · baseline ${baseline}`}</span>
      ) : null}
    </p>
  )
}

function RankBlock({
  report,
  reports,
  fresh,
  rankError,
  busy,
  disabled,
  onCheck,
}: {
  report: SearchReport | null
  reports: SearchReportsModel
  fresh: { keyword: string; position: number | null } | null
  rankError: string | null
  busy: boolean
  disabled: boolean
  onCheck: () => void
}) {
  const target = report?.targetKeyword ?? reports.live?.targetKeyword ?? null
  const latestCheck = reports.rankChecks[0]
  const current =
    fresh ??
    (report?.rank
      ? { keyword: report.rank.keyword, position: report.rank.position }
      : latestCheck
        ? { keyword: latestCheck.keyword, position: latestCheck.position }
        : null)

  return (
    <>
      <p className="text-[13px] text-[var(--color-text-primary)]">
        {current ? rankWords(current.keyword, current.position) : 'Rank: not checked yet'}
      </p>
      {target ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" busy={busy} disabled={disabled} onClick={onCheck}>
            {`Check where it ranks (${RANK_CREDITS} credits)`}
          </Button>
        </div>
      ) : null}
      {rankError ? (
        <p role="alert" className="text-[12px] text-[var(--color-danger)]">
          {rankError}
        </p>
      ) : null}
      {reports.rankChecks.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {reports.rankChecks.map((check) => (
            <li
              key={`${check.checkedAt}-${check.keyword}`}
              className="text-[12px] text-[var(--color-text-muted)]"
            >
              {`${dayLabel(check.checkedAt)} · ${rankWords(check.keyword, check.position)}`}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
