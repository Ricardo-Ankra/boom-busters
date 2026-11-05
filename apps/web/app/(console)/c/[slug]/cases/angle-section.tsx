'use client'

import type { CaseSummary } from '@boom-busters/db'
import { angleDemand, briefNeedsResearch, caseResearchJobIsRunning } from '@boom-busters/schemas'
import type { AngleOption, SearchBrief } from '@boom-busters/schemas'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/input'
import { chooseAngleAction, rateAnglesAction, rateAnglesEstimate } from './actions'
import type { RateAnglesEstimate } from './actions'
import { briefMatchesSubject } from './search-brief-panel'
import type { Run } from './search-brief-panel'

/**
 * The panel's Angle section: one card per option with its Demand score, the
 * model's recommendation, and the choices the owner makes from them.
 */

const RESEARCH_SUGGESTION =
  'This brief has no strong keyword to aim at. Research again to measure fresh terms.'

type Demand = ReturnType<typeof angleDemand>

const demandKeyword = (demand: Demand): string =>
  demand.keywordOverall === null ? 'no keyword score' : `keyword ${demand.keywordOverall}`

/** Demand's parts in words, for the line shown below `sm` where the hover title cannot be reached. */
function demandParts(demand: Demand): string {
  return `${demandKeyword(demand)}, ${demand.answers} ${demand.answers === 1 ? 'answer' : 'answers'}`
}

function AngleCard({
  option,
  brief,
  at,
  actions,
}: {
  option: AngleOption
  brief: SearchBrief
  at: number
  /** The Use this angle button, or null when the card offers none. */
  actions: React.ReactNode
}) {
  const demand = angleDemand(option, brief)
  const recommended = brief.recommendedAngle === at
  const chosen = brief.chosenAngle === at
  const served = demand.keyword ?? option.keyword
  const questions =
    demand.answers === 0
      ? 'answers no searched questions'
      : `answers ${demand.answers} searched ${demand.answers === 1 ? 'question' : 'questions'}`

  return (
    <li
      className={
        'grid grid-cols-1 gap-x-5 gap-y-2 rounded-[10px] border p-4 sm:grid-cols-[1fr_auto] ' +
        (recommended
          ? 'border-[var(--color-accent-text)] bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-surface))]'
          : 'border-[var(--color-border)]')
      }
    >
      {recommended || chosen ? (
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          {recommended ? (
            <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-accent-foreground)]">
              Recommended
            </span>
          ) : null}
          {chosen ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-success)]">
              Chosen
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-[14px] leading-relaxed">{option.angle}</p>
        <p className="text-[13px] text-[var(--color-text-primary)]">
          <span className="text-[var(--color-text-secondary)]">The gap:</span> {option.gap}
        </p>
        {recommended && brief.recommendationReason !== null ? (
          <p className="text-[13px] text-[var(--color-accent-text)]">
            {`Why recommended: ${brief.recommendationReason}`}
          </p>
        ) : null}
        <p className="text-[12px] text-[var(--color-text-muted)]">
          {demand.servesSearchedTerm ? (
            <span>Serves a searched title, not a keyword</span>
          ) : served === '' ? null : (
            <span>
              Serves <span className="font-mono">{served}</span>
            </span>
          )}
          {demand.servesSearchedTerm || served !== '' ? ' · ' : ''}
          <span>{questions}</span>
        </p>
      </div>

      <div className="flex items-baseline gap-3 sm:min-w-[92px] sm:flex-col sm:items-end sm:gap-0 sm:text-right">
        <div
          title={`Demand ${demand.score}: 0.7 x ${demandKeyword(demand)} + 6 x ${demand.answers} answered`}
        >
          <span className="font-mono text-[26px] leading-none font-semibold tabular-nums">
            {demand.score}
          </span>
        </div>
        <span className="text-[11px] text-[var(--color-text-muted)] sm:mt-0.5">Demand</span>
        <span className="text-[12px] text-[var(--color-text-secondary)] sm:hidden">
          From {demandParts(demand)}
        </span>
        <div
          aria-hidden="true"
          className="mt-1.5 hidden h-1 w-full overflow-hidden rounded-[2px] bg-[var(--color-surface-raised)] sm:block"
        >
          <div
            className="h-full bg-[var(--color-accent-text)]"
            style={{ width: `${demand.score}%` }}
          />
        </div>
      </div>

      {actions === null ? null : <div className="flex gap-2 sm:col-span-2">{actions}</div>}
    </li>
  )
}

/** `Rate the angles`: asks the model to pick one; shown only while there is no recommendation. */
function RateAnglesButton({ item, run }: { item: CaseSummary; run: Run }) {
  const [estimate, setEstimate] = React.useState<RateAnglesEstimate | null>(null)
  const job = item.searchJob
  const running = job !== null && job.state === 'running' && caseResearchJobIsRunning(job)
  const consequence =
    estimate === null
      ? 'Checking the cost.'
      : estimate.ok
        ? `About $${estimate.usd.toFixed(2)} on ${estimate.model}. No VidIQ credits.`
        : estimate.error
  return (
    <ConfirmButton
      label="Rate the angles"
      confirmLabel="Rate now"
      confirmVariant="primary"
      consequence={consequence}
      disabled={running}
      title={running ? 'Research is running' : undefined}
      onArm={() => {
        setEstimate(null)
        rateAnglesEstimate(item.id).then(setEstimate, () =>
          setEstimate({ ok: false, error: 'Could not check the cost' }),
        )
      }}
      onConfirm={() => run(() => rateAnglesAction(item.id), 'Angles rated')}
    />
  )
}

export function AngleSection({
  item,
  run,
  researchControl,
}: {
  item: CaseSummary
  run: Run
  /** The panel's research control, offered here when the brief is worth redoing. */
  researchControl: React.ReactNode
}) {
  const brief = item.searchBrief
  const [writing, setWriting] = React.useState(false)
  const [own, setOwn] = React.useState(item.angle ?? '')
  const [busy, setBusy] = React.useState(false)
  // The chooser in flight; the others wait so a double click sends once.
  const [pending, setPending] = React.useState<string | null>(null)
  if (brief === null) return null

  const choose = async (key: string, option: number) => {
    if (pending !== null) return
    setPending(key)
    try {
      await run(() => chooseAngleAction(item.id, { option }), 'Angle chosen')
    } finally {
      setPending(null)
    }
  }

  const current = briefMatchesSubject(brief, item.subject)
  const options = brief.angleOptions

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)]">Angle</h3>

      {briefNeedsResearch(brief) ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--color-border)] p-3">
          <p className="text-[13px] text-[var(--color-text-secondary)]">{RESEARCH_SUGGESTION}</p>
          {researchControl}
        </div>
      ) : null}

      {brief.ownAngle ? (
        <p className="text-[13px] text-[var(--color-success)]">Your own angle is chosen.</p>
      ) : null}

      {options.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {options.map((option, at) => (
            <AngleCard
              key={option.angle}
              option={option}
              brief={brief}
              at={at}
              actions={
                current && brief.chosenAngle !== at ? (
                  <Button
                    variant="outline"
                    aria-label={`Use this angle: ${option.angle.slice(0, 60)}`}
                    busy={pending === `angle:${at}`}
                    disabled={pending !== null}
                    onClick={() => void choose(`angle:${at}`, at)}
                  >
                    Use this angle
                  </Button>
                ) : null
              }
            />
          ))}
        </ul>
      ) : null}

      {current ? (
        <div className="flex flex-col gap-3">
          {options.length >= 2 && brief.recommendedAngle === null ? (
            <div>
              <RateAnglesButton item={item} run={run} />
            </div>
          ) : null}
          {writing ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`own-angle-${item.id}`}>Your angle</Label>
              <textarea
                id={`own-angle-${item.id}`}
                value={own}
                rows={3}
                onChange={(event) => setOwn(event.target.value)}
                className="min-h-[80px] w-full max-w-xl rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 py-2 text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  busy={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const ok = await run(
                        () => chooseAngleAction(item.id, { own }),
                        'Your angle is kept',
                      )
                      if (ok) setWriting(false)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Save my angle
                </Button>
                <Button variant="ghost" onClick={() => setWriting(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="ghost" onClick={() => setWriting(true)}>
                Write my own angle
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
