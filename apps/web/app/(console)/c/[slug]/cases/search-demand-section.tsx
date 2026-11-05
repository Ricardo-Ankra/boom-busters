'use client'

import type { CaseSummary } from '@boom-busters/db'
import { keywordHasFigure } from '@boom-busters/schemas'
import type { SearchKeyword } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { setTargetKeywordAction } from './actions'
import { measuredOn, scoreWord } from './case-progress'
import { briefMatchesSubject } from './search-brief-panel'
import type { Run } from './search-brief-panel'

/**
 * The panel's Search demand section: the target keyword with its figures,
 * the other keywords, the searched video titles, and the collapsed evidence.
 */

const number = new Intl.NumberFormat('en-US')
const fmt = (value: number): string => number.format(value)

/** A signed percent: `+38%`, `-12%`. */
const signed = (pct: number): string => {
  const rounded = Math.round(pct)
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : ''}${Math.abs(rounded)}%`
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function Trend({ pct }: { pct: number }) {
  return (
    <span
      className={
        'font-mono tabular-nums ' +
        (pct > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-secondary)]')
      }
    >
      {signed(pct)}
    </span>
  )
}

function Figure({
  label,
  hint,
  testId,
  children,
}: {
  label: string
  hint: string
  testId?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12px] text-[var(--color-text-muted)]">{label}</span>
      <span data-testid={testId} className="font-mono text-[18px] font-semibold tabular-nums">
        {children}
      </span>
      <span className="text-[12px] text-[var(--color-text-secondary)]">{hint}</span>
    </div>
  )
}

const OutOf = () => (
  <span className="text-[12px] font-normal text-[var(--color-text-muted)]">/100</span>
)

function TargetCard({ target }: { target: SearchKeyword }) {
  return (
    <div
      data-testid="target-card"
      className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <p className="text-[12px] text-[var(--color-text-muted)]">Target keyword</p>
      <p className="font-mono text-[17px] font-semibold">{target.keyword}</p>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
        {target.estimatedMonthlySearch === null ? null : (
          <Figure label="Searches a month" hint="VidIQ estimate">
            ~{fmt(target.estimatedMonthlySearch)}
          </Figure>
        )}
        {target.volume === null ? null : (
          <Figure label="Search volume" hint={scoreWord(target.volume, 'volume')} testId="volume">
            {target.volume}
            <OutOf />
          </Figure>
        )}
        {target.competition === null ? null : (
          <Figure
            label="Competition"
            hint={scoreWord(target.competition, 'competition')}
            testId="competition"
          >
            {target.competition}
            <OutOf />
          </Figure>
        )}
        {target.growthPct === null ? null : (
          <Figure
            label="Trend"
            hint={target.growthPct > 0 ? 'searches growing' : 'searches over time'}
          >
            <Trend pct={target.growthPct} />
          </Figure>
        )}
      </div>
    </div>
  )
}

/** A keyword's figures as one line, for the stacked layout below `sm`. */
function stackedFigures(keyword: SearchKeyword): string {
  return [
    keyword.estimatedMonthlySearch === null
      ? null
      : `~${fmt(keyword.estimatedMonthlySearch)} a month`,
    keyword.volume === null ? null : `volume ${keyword.volume}`,
    keyword.competition === null ? null : `competition ${keyword.competition}`,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

const cell = (value: number | null): string => (value === null ? '' : fmt(value))

function EvidenceItem({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="rounded-[10px] border border-[var(--color-border)]">
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 px-3.5 py-3 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
        <span>{title}</span>
        <span className="text-[13px] font-normal text-[var(--color-text-muted)]">{summary}</span>
      </summary>
      <div className="border-t border-[var(--color-border)] px-3.5 py-3 text-[13px]">
        {children}
      </div>
    </details>
  )
}

export function SearchDemandSection({ item, run }: { item: CaseSummary; run: Run }) {
  const brief = item.searchBrief
  // The chooser in flight; the others wait so a double click sends once.
  const [pending, setPending] = React.useState<string | null>(null)
  if (brief === null) return null

  const makeTarget = async (term: string) => {
    if (pending !== null) return
    setPending(term)
    try {
      await run(() => setTargetKeywordAction(item.id, term), 'Target keyword set')
    } finally {
      setPending(null)
    }
  }

  const current = briefMatchesSubject(brief, item.subject)
  const breakouts = brief.outliers.flatMap((o) =>
    o.breakoutScore === null ? [] : [o.breakoutScore],
  )
  const best = breakouts.length === 0 ? null : Math.max(...breakouts)
  const hasEvidence =
    brief.outliers.length > 0 ||
    brief.searchedQuestions.length > 0 ||
    brief.toldAlready.length > 0 ||
    brief.otherLanguages.length > 0

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)]">
          Search demand
        </h3>
        <span className="text-[12px] text-[var(--color-text-muted)]">
          VidIQ, measured {measuredOn(brief.measuredAt)}
        </span>
      </div>

      {brief.targetKeyword ? (
        <TargetCard target={brief.targetKeyword} />
      ) : (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          No keyword people search for this subject was measured; the searched titles below show
          there is interest.
        </p>
      )}

      {brief.secondaryKeywords.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-[13px] font-semibold">Other keywords</h4>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-[var(--color-text-muted)]">
                <th className="border-b border-[var(--color-border)] px-2 py-1.5 font-medium">
                  Keyword
                </th>
                <th className="hidden border-b border-[var(--color-border)] px-2 py-1.5 text-right font-medium sm:table-cell">
                  A month
                </th>
                <th className="hidden border-b border-[var(--color-border)] px-2 py-1.5 text-right font-medium sm:table-cell">
                  Volume
                </th>
                <th className="hidden border-b border-[var(--color-border)] px-2 py-1.5 text-right font-medium sm:table-cell">
                  Competition
                </th>
                <th className="w-px border-b border-[var(--color-border)] px-2 py-1.5">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {brief.secondaryKeywords.map((keyword) => (
                <tr key={keyword.keyword}>
                  <td className="border-b border-[var(--color-border)] px-2 py-2 align-middle">
                    <span className="font-mono">{keyword.keyword}</span>
                    <span className="mt-0.5 block font-mono text-[12px] text-[var(--color-text-secondary)] sm:hidden">
                      {stackedFigures(keyword)}
                    </span>
                  </td>
                  <td className="hidden border-b border-[var(--color-border)] px-2 py-2 text-right font-mono tabular-nums sm:table-cell">
                    {cell(keyword.estimatedMonthlySearch)}
                  </td>
                  <td className="hidden border-b border-[var(--color-border)] px-2 py-2 text-right font-mono tabular-nums sm:table-cell">
                    {cell(keyword.volume)}
                  </td>
                  <td className="hidden border-b border-[var(--color-border)] px-2 py-2 text-right font-mono tabular-nums sm:table-cell">
                    {cell(keyword.competition)}
                  </td>
                  <td className="border-b border-[var(--color-border)] px-2 py-1 text-right align-middle">
                    {current && !keywordHasFigure(keyword.keyword) ? (
                      <Button
                        variant="outline"
                        aria-label={`Make target: ${keyword.keyword}`}
                        busy={pending === keyword.keyword}
                        disabled={pending !== null}
                        onClick={() => void makeTarget(keyword.keyword)}
                      >
                        Make target
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {brief.searchedTitles.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-[13px] font-semibold">Searched video titles</h4>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            People typing the title of one specific video. Proof the subject is pulling searches
            now; not a keyword you can rank for.
          </p>
          <ul className="flex flex-col">
            {brief.searchedTitles.map((title) => (
              <li
                key={title.keyword}
                className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-[var(--color-border)] py-2 text-[13px]"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">{title.keyword}</span>
                <span className="flex items-baseline gap-2 font-mono tabular-nums">
                  {title.estimatedMonthlySearch === null ? null : (
                    <span>~{fmt(title.estimatedMonthlySearch)}</span>
                  )}
                  {title.growthPct === null ? null : <Trend pct={title.growthPct} />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasEvidence ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)]">Evidence</h3>

          {brief.outliers.length > 0 ? (
            <EvidenceItem
              title="Winning videos"
              summary={
                plural(brief.outliers.length, 'video', 'videos') +
                (best === null ? '' : ` · best ${Math.round(best)}x breakout`)
              }
            >
              <ul className="flex flex-col gap-1">
                {brief.outliers.map((outlier) => (
                  <li key={outlier.videoId}>
                    <span className="font-medium">{outlier.title}</span>
                    {outlier.channel ? `, ${outlier.channel}` : ''}
                    {outlier.views === null ? '' : `, ${fmt(outlier.views)} views`}
                    {outlier.breakoutScore === null ? '' : `, ${outlier.breakoutScore}x breakout`}
                  </li>
                ))}
              </ul>
            </EvidenceItem>
          ) : null}

          {brief.searchedQuestions.length > 0 ? (
            <EvidenceItem
              title="Searched questions"
              summary={plural(brief.searchedQuestions.length, 'question', 'questions')}
            >
              <ul className="list-disc pl-5">
                {brief.searchedQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </EvidenceItem>
          ) : null}

          {brief.toldAlready.length > 0 ? (
            <EvidenceItem
              title="Told already"
              summary={`${plural(brief.toldAlready.length, 'beat', 'beats')} to avoid retelling`}
            >
              <ul className="list-disc pl-5">
                {brief.toldAlready.map((told) => (
                  <li key={told}>{told}</li>
                ))}
              </ul>
            </EvidenceItem>
          ) : null}

          {brief.otherLanguages.length > 0 ? (
            <EvidenceItem
              title="Other languages"
              summary={`${plural(brief.otherLanguages.length, 'search', 'searches')} in other languages`}
            >
              <ul className="flex flex-col gap-1">
                {brief.otherLanguages.map((row) => (
                  <li key={row.keyword} className="flex flex-wrap justify-between gap-x-4">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{row.keyword}</span>
                    {row.estimatedMonthlySearch === null ? null : (
                      <span className="font-mono tabular-nums">
                        ~{fmt(row.estimatedMonthlySearch)} a month
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </EvidenceItem>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
