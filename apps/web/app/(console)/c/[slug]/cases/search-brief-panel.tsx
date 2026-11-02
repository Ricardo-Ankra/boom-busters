'use client'

import type { CaseSummary } from '@boom-busters/db'
import {
  CASE_RESEARCH_CREDITS,
  briefIsStale,
  caseResearchJobIsRunning,
  keywordHasFigure,
} from '@boom-busters/schemas'
import type { SearchBrief, SearchKeyword } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/input'
import { channelHref } from '@/lib/channel-href'
import {
  caseResearchEstimate,
  chooseAngleAction,
  researchCaseAction,
  setTargetKeywordAction,
  startProjectFromCase,
} from './actions'
import type { CaseResearchEstimate } from './actions'

/**
 * What the case row shows of its VidIQ research: the `Research with VidIQ`
 * control, the collapsed `Search brief` panel, and the `New project` button
 * that asks first when the brief has gone stale. Kept out of
 * `case-library.tsx` so the row itself stays small.
 */

type Run = (
  action: () => Promise<{ ok: boolean; error?: string }>,
  success: string,
) => Promise<boolean>

/** How often a row refreshes while its research runs, as the Bible tab does. */
const POLL_MS = 3000
const DAY_MS = 86_400_000

const number = new Intl.NumberFormat('en-US')
const fmt = (value: number): string => number.format(value)

const sameSubject = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Whether the brief still describes the case. The owner can edit the subject
 * after researching; the brief then belongs to the old one, and the database
 * freezes none of it onto a project (Review Focus 3).
 */
export function briefMatchesSubject(brief: SearchBrief, subject: string | null): boolean {
  return subject !== null && sameSubject(brief.subject, subject)
}

const researchLabel = (again: boolean): string =>
  `${again ? 'Research again' : 'Research'} with VidIQ (about ${CASE_RESEARCH_CREDITS} credits)`

/** The research button, or what the run is doing, or why it failed with Try again. */
export function ResearchControl({ item, run }: { item: CaseSummary; run: Run }) {
  const router = useRouter()
  const [estimate, setEstimate] = React.useState<CaseResearchEstimate | null>(null)
  const job = item.searchJob
  const running = job !== null && job.state === 'running' && caseResearchJobIsRunning(job)

  // The server's job wins whenever the page refreshes.
  React.useEffect(() => {
    if (!running) return
    const timer = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [running, router])

  if (running) {
    return (
      <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">
        Researching: {job.current ?? 'Starting'}
      </p>
    )
  }

  const failure =
    job === null || job.state === 'done'
      ? null
      : job.state === 'failed'
        ? (job.error ?? 'The research run failed')
        : 'The research run stopped answering'
  const subject = item.subject?.trim() ?? ''
  const mismatched = item.searchBrief !== null && !briefMatchesSubject(item.searchBrief, subject)

  const consequence =
    estimate === null
      ? 'Checking the cost.'
      : estimate.ok
        ? `About ${estimate.credits} credits. ${fmt(estimate.capLeft)} left of this month's cap; VidIQ balance ${fmt(estimate.balance)}.`
        : estimate.error

  return (
    <>
      {failure === null ? null : (
        <p className="text-[13px] text-[var(--color-danger)]">Research failed: {failure}</p>
      )}
      <ConfirmButton
        label={failure === null ? researchLabel(mismatched) : 'Try again'}
        confirmLabel="Start research"
        confirmVariant="primary"
        consequence={consequence}
        disabled={subject === ''}
        title={subject === '' ? 'Give the case a subject first' : undefined}
        onArm={() => {
          setEstimate(null)
          caseResearchEstimate(item.id).then(setEstimate, () =>
            setEstimate({ ok: false, error: 'Could not check the cost' }),
          )
        }}
        onConfirm={() => run(() => researchCaseAction(item.id), 'Research started')}
      />
    </>
  )
}

/** `New project`: with a brief over 30 days old it asks whether to refresh the research first. */
export function NewProjectButton({
  slug,
  blocked,
  item,
  run,
}: {
  slug: string
  /** Why a project cannot start, or null when it can. */
  blocked: string | null
  item: CaseSummary
  run: Run
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [asking, setAsking] = React.useState(false)
  const brief = item.searchBrief
  // A brief for another subject freezes onto nothing, so its age does not matter.
  const stale = brief !== null && briefMatchesSubject(brief, item.subject) && briefIsStale(brief)

  const start = async () => {
    setBusy(true)
    try {
      const result = await startProjectFromCase(item.id)
      if (result.ok) {
        router.push(channelHref(slug, '/projects'))
      } else {
        await run(async () => result, '')
      }
    } finally {
      setBusy(false)
    }
  }

  if (asking && brief) {
    const days = Math.floor((Date.now() - Date.parse(brief.measuredAt)) / DAY_MS)
    return (
      <div className="flex w-full flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
        <span className="text-[14px]">The search research is {days} days old.</span>
        <Button
          variant="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true)
            try {
              if (await run(() => researchCaseAction(item.id), 'Research started')) {
                setAsking(false)
              }
            } finally {
              setBusy(false)
            }
          }}
        >
          Refresh research (about {CASE_RESEARCH_CREDITS} credits)
        </Button>
        <Button variant="outline" busy={busy} onClick={start}>
          Start without refreshing
        </Button>
        <Button variant="ghost" onClick={() => setAsking(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="primary"
      busy={busy}
      disabled={blocked !== null}
      title={blocked ?? undefined}
      onClick={() => (stale ? setAsking(true) : void start())}
    >
      New project
    </Button>
  )
}

function KeywordNumbers({ keyword }: { keyword: SearchKeyword }) {
  const parts = [
    keyword.volume === null ? null : `volume ${fmt(keyword.volume)}`,
    keyword.competition === null ? null : `competition ${fmt(keyword.competition)}`,
    keyword.overall === null ? null : `overall ${fmt(keyword.overall)}`,
    keyword.estimatedMonthlySearch === null
      ? null
      : `about ${fmt(keyword.estimatedMonthlySearch)} searches a month`,
    keyword.growthPct === null ? null : `growth ${keyword.growthPct}%`,
  ].filter((part) => part !== null)
  return (
    <span className="text-[var(--color-text-secondary)]">
      {parts.length === 0 ? 'no figures measured' : parts.join(', ')}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[13px] font-medium">{title}</h3>
      {children}
    </div>
  )
}

const measuredOn = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** The row's `Search brief`: collapsed, with the choices the owner makes from it. */
export function SearchBriefPanel({ item, run }: { item: CaseSummary; run: Run }) {
  const brief = item.searchBrief
  const [writing, setWriting] = React.useState(false)
  const [own, setOwn] = React.useState(item.angle ?? '')
  const [busy, setBusy] = React.useState(false)
  if (brief === null) return null

  const current = briefMatchesSubject(brief, item.subject)

  return (
    <div className="flex w-full flex-col gap-2">
      {current ? null : (
        <p role="status" className="text-[13px] text-[var(--color-warning)]">
          This research is for {brief.subject}. Research again for {item.subject?.trim() ?? ''}.
        </p>
      )}
      <details className="rounded-[8px] border border-[var(--color-border)] p-3 text-[13px]">
        <summary className="cursor-pointer text-[14px] font-medium">Search brief</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[var(--color-text-secondary)]">
            Measured {measuredOn(brief.measuredAt)} for {brief.subject}
          </p>

          <Section title="Target keyword">
            {brief.targetKeyword ? (
              <p>
                <span className="font-medium">{brief.targetKeyword.keyword}</span>:{' '}
                <KeywordNumbers keyword={brief.targetKeyword} />
              </p>
            ) : (
              <p className="text-[var(--color-text-secondary)]">
                No searched keyword was measured for this subject.
              </p>
            )}
          </Section>

          {brief.secondaryKeywords.length > 0 ? (
            <Section title="Secondary keywords">
              <ul className="flex flex-col gap-1">
                {brief.secondaryKeywords.map((keyword) => (
                  <li key={keyword.keyword} className="flex flex-wrap items-center gap-2">
                    <span>
                      <span className="font-medium">{keyword.keyword}</span>:{' '}
                      <KeywordNumbers keyword={keyword} />
                    </span>
                    {current && !keywordHasFigure(keyword.keyword) ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void run(
                            () => setTargetKeywordAction(item.id, keyword.keyword),
                            'Target keyword set',
                          )
                        }
                      >
                        Make target
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {brief.searchedQuestions.length > 0 ? (
            <Section title="Searched questions">
              <ul className="list-disc pl-5">
                {brief.searchedQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </Section>
          ) : null}

          {brief.outliers.length > 0 ? (
            <Section title="Winning videos">
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
            </Section>
          ) : null}

          {brief.toldAlready.length > 0 ? (
            <Section title="Told already">
              <ul className="list-disc pl-5">
                {brief.toldAlready.map((told) => (
                  <li key={told}>{told}</li>
                ))}
              </ul>
            </Section>
          ) : null}

          {brief.angleOptions.length > 0 ? (
            <Section title="Angle options">
              <ul className="flex flex-col gap-2">
                {brief.angleOptions.map((option, at) => (
                  <li
                    key={option.angle}
                    className="flex flex-col gap-1 rounded-[8px] border border-[var(--color-border)] p-2"
                  >
                    <p>
                      {option.angle}
                      {brief.chosenAngle === at ? (
                        <span className="ml-2 font-medium text-[var(--color-accent)]">Chosen</span>
                      ) : null}
                    </p>
                    <p className="text-[var(--color-text-secondary)]">
                      Searched as {option.keyword}. {option.gap}
                    </p>
                    {option.answers.length > 0 ? (
                      <p className="text-[var(--color-text-secondary)]">
                        Answers: {option.answers.join('; ')}
                      </p>
                    ) : null}
                    {current && brief.chosenAngle !== at ? (
                      <div>
                        <Button
                          variant="outline"
                          onClick={() =>
                            void run(
                              () => chooseAngleAction(item.id, { option: at }),
                              'Angle chosen',
                            )
                          }
                        >
                          Use this angle
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {current ? (
                writing ? (
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
                    <Button variant="outline" onClick={() => setWriting(true)}>
                      Keep my own angle
                    </Button>
                  </div>
                )
              ) : null}
            </Section>
          ) : null}
        </div>
      </details>
    </div>
  )
}
