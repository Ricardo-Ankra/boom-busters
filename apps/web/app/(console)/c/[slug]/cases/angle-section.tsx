'use client'

import type { CaseSummary } from '@boom-busters/db'
import { angleDemand, briefNeedsResearch, caseResearchJobIsRunning } from '@boom-busters/schemas'
import type { AngleOption, SearchBrief } from '@boom-busters/schemas'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/input'
import { chooseAngleAction, rateAnglesAction, rateAnglesEstimate, testAngleAction } from './actions'
import type { RateAnglesEstimate } from './actions'
import { briefMatchesSubject } from './search-brief-panel'
import type { Run } from './search-brief-panel'
import { EvidenceItem } from './search-demand-section'

/**
 * The panel's Angle section: one card per option with its Demand score, the
 * model's recommendation, and the choices the owner makes from them.
 */

const RESEARCH_SUGGESTION =
  'This brief has no strong keyword to aim at. Research again to measure fresh terms.'

type Demand = ReturnType<typeof angleDemand>

const number = new Intl.NumberFormat('en-ZA')
const fmt = (value: number): string => number.format(value)

/** What the target did when an angle was chosen: said when it moved, and why when it stayed. */
function targetChangeNotice(change: { to: string } | { keptBecause: string } | null | undefined) {
  if (change === null || change === undefined) return 'Angle chosen'
  return 'to' in change ? `Target keyword is now ${change.to}` : change.keptBecause
}

/** The niche test for exactly this angle's text, or undefined. */
const nicheTestFor = (brief: SearchBrief, option: AngleOption) =>
  (brief.nicheTests ?? []).find((t) => t.angle === option.angle)

const searchedQuestions = (n: number): string =>
  n === 0 ? 'no searched questions' : `${n} searched ${n === 1 ? 'question' : 'questions'}`

/** What Demand was made of, in plain words; shown as text so touch and screen readers get it too. */
function demandBreakdown(demand: Demand, option: AngleOption): string {
  const questions = searchedQuestions(demand.answers)
  if (demand.servesSearchedTerm) return `Serves a searched title, ${questions}`
  const served = demand.keyword ?? option.keyword
  if (demand.keywordOverall === null || served === '') return `No keyword score, ${questions}`
  return `overall ${demand.keywordOverall} for ${served}, ${questions}`
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
  const evidence = option.evidence ?? []
  const test = nicheTestFor(brief, option)

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
      </div>

      <div className="flex flex-col gap-0.5 sm:w-[180px] sm:items-end sm:text-right">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[26px] leading-none font-semibold tabular-nums">
            {demand.score}
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)]">Demand</span>
        </div>
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          {demandBreakdown(demand, option)}
        </p>
        <div
          aria-hidden="true"
          className="mt-1.5 h-1 w-full overflow-hidden rounded-[2px] bg-[var(--color-surface-raised)]"
        >
          <div
            className="h-full bg-[var(--color-accent-text)]"
            style={{ width: `${demand.score}%` }}
          />
        </div>
      </div>

      {evidence.length > 0 ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[13px] sm:col-span-2">
          {evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {test === undefined ? null : (
        <div className="flex flex-col gap-1 text-[13px] sm:col-span-2">
          <p className="font-semibold">{test.verdict}</p>
          {test.evidence.length > 0 ? (
            <ul className="flex list-disc flex-col gap-0.5 pl-5">
              {test.evidence.map((line) => (
                <li key={line.text}>
                  {line.text}
                  {line.count === null ? '' : ` (${fmt(line.count)})`}
                </li>
              ))}
            </ul>
          ) : null}
          {test.notes === '' ? null : (
            <p className="text-[12px] text-[var(--color-text-muted)]">{test.notes}</p>
          )}
        </div>
      )}

      {actions === null ? null : (
        <div className="flex flex-wrap gap-2 sm:col-span-2">{actions}</div>
      )}
    </li>
  )
}

/** `Test this angle`: buys one niche test for the chosen angle and keeps its verdict on the brief. */
function TestAngleButton({ item, option, run }: { item: CaseSummary; option: number; run: Run }) {
  const [busy, setBusy] = React.useState(false)
  const job = item.searchJob
  const running = job !== null && caseResearchJobIsRunning(job)
  return (
    <ConfirmButton
      label="Test this angle"
      confirmLabel="Test it"
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
              return await testAngleAction(item.id, option)
            } catch {
              return { ok: false, error: 'Could not test the angle. Try again.' }
            }
          }, 'Angle tested')
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}

/** `Rate the angles`: asks the model to pick one; shown only while there is no recommendation. */
function RateAnglesButton({ item, run }: { item: CaseSummary; run: Run }) {
  const [estimate, setEstimate] = React.useState<RateAnglesEstimate | null>(null)
  // Each arm bumps this; an answer from an earlier arm is ignored.
  const armed = React.useRef(0)
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
        const arm = ++armed.current
        const settle = (result: RateAnglesEstimate) => {
          if (arm === armed.current) setEstimate(result)
        }
        rateAnglesEstimate(item.id).then(settle, () =>
          settle({ ok: false, error: 'Could not check the cost' }),
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
      let change: Awaited<ReturnType<typeof chooseAngleAction>>['targetChange']
      await run(
        async () => {
          const result = await chooseAngleAction(item.id, { option })
          change = result.targetChange
          return result
        },
        () => targetChangeNotice(change),
      )
    } finally {
      setPending(null)
    }
  }

  const current = briefMatchesSubject(brief, item.subject)
  const options = brief.angleOptions
  // Only the chosen angle is tested on demand, and only once, against the brief's niche.
  const testable = (option: AngleOption, at: number): boolean =>
    brief.chosenAngle === at && Boolean(brief.niche) && nicheTestFor(brief, option) === undefined
  const themes = brief.commentThemes ?? []
  const read = brief.commentsRead

  return (
    <section id="evidence-angle" className="flex scroll-mt-4 flex-col gap-3">
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
              key={at}
              option={option}
              brief={brief}
              at={at}
              actions={
                current && (brief.chosenAngle !== at || testable(option, at)) ? (
                  <>
                    {brief.chosenAngle !== at ? (
                      <Button
                        variant="outline"
                        aria-label={`Use this angle: ${option.angle.slice(0, 60)}`}
                        busy={pending === `angle:${at}`}
                        disabled={pending !== null}
                        onClick={() => void choose(`angle:${at}`, at)}
                      >
                        Use this angle
                      </Button>
                    ) : null}
                    {testable(option, at) ? (
                      <TestAngleButton item={item} option={at} run={run} />
                    ) : null}
                  </>
                ) : null
              }
            />
          ))}
        </ul>
      ) : null}

      {read === undefined ? null : (
        <EvidenceItem
          title="What viewers asked for"
          summary={`${themes.length} ${themes.length === 1 ? 'theme' : 'themes'}`}
        >
          <p className="text-[var(--color-text-secondary)]">
            {`Read ${fmt(read.comments)} comments on ${read.videos} videos${themes.length === 0 ? '; no clear requests.' : '.'}`}
          </p>
          {themes.length === 0 ? null : (
            <ul className="mt-2 flex flex-col gap-2">
              {themes.map((theme) => (
                <li key={theme.theme}>
                  <span className="font-medium">{theme.theme}</span>
                  <span className="font-mono text-[12px] text-[var(--color-text-secondary)] tabular-nums">
                    {` · ${fmt(theme.count)} ${theme.count === 1 ? 'comment' : 'comments'}`}
                  </span>
                  {theme.quote === null ? null : (
                    <q className="mt-0.5 block text-[var(--color-text-secondary)]">{theme.quote}</q>
                  )}
                </li>
              ))}
            </ul>
          )}
        </EvidenceItem>
      )}

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
