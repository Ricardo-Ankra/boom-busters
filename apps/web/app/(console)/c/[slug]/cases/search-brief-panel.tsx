'use client'

import type { CaseSummary } from '@boom-busters/db'
import {
  briefIsStale,
  caseResearchCredits,
  caseResearchJobIsRunning,
  keywordHasFigure,
  leadKeyword,
  resolveFormat,
  RUNTIME_OUTER_MIN,
  RUNTIME_START_MAX,
} from '@boom-busters/schemas'
import type { ChannelFormat, SearchBrief, SearchKeyword } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Label, NumberInput, Select } from '@/components/ui/input'
import { fitWarning } from '@/lib/brief-fit'
import { channelHref } from '@/lib/channel-href'
import {
  caseResearchEstimate,
  chooseAngleAction,
  estimateStartCostAction,
  researchCaseAction,
  setCaseFormatAction,
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

/** What the researcher is doing, by the step id it reports; an unknown id reads as plain Researching. */
const STEP_LABELS: Record<string, string> = {
  load: 'Starting',
  'keywords-terms': 'Finding search terms',
  'keywords-format': 'Finding search terms for the format',
  'keywords-filter': 'Keeping the terms about the subject',
  fit: 'Checking the subject fits the channel',
  'keywords-questions': 'Finding the questions people search',
  outliers: 'Finding the winning videos',
  'outlier-details': 'Reading the winning videos',
  winners: 'Studying the winning titles',
  angles: 'Drafting angle options',
  'save-brief': 'Saving the brief',
}

export function researchStepLabel(step: string | null): string {
  const label = step !== null && Object.hasOwn(STEP_LABELS, step) ? STEP_LABELS[step] : undefined
  return label ?? 'Researching'
}

/** The channel's current formats, for the picker and the estimate; empty reads as no formats. */
export const FormatsContext = React.createContext<readonly ChannelFormat[]>([])

/** Whether the case's format, resolved against the current bible, has a lead keyword to search. */
function useFormatSeed(item: CaseSummary): boolean {
  const formats = React.useContext(FormatsContext)
  return formats.length > 0 && leadKeyword(resolveFormat(formats, item.formatKey)) !== null
}

/** The length a format starts at: its default, kept inside its range and the start limit. */
function startRuntime(format: ChannelFormat | null): number {
  if (format === null) return 15
  const max = Math.min(format.runtime.max, RUNTIME_START_MAX)
  return Math.min(Math.max(format.runtime.default, format.runtime.min), max)
}

const NOT_SUPPORTED_NOTE = `Videos longer than ${RUNTIME_START_MAX} minutes are not supported yet`

const researchLabel = (again: boolean, credits: number): string =>
  `${again ? 'Research again' : 'Research'} with VidIQ (about ${credits} credits)`

/** `Format`: which of the channel's formats this case is made as; hidden for a one-format channel. */
export function FormatPicker({ item, run }: { item: CaseSummary; run: Run }) {
  const formats = React.useContext(FormatsContext)
  const [busy, setBusy] = React.useState(false)
  if (formats.length < 2) return null
  // A stored key the bible no longer has reads as the primary, as the pipeline resolves it.
  const selected = resolveFormat(formats, item.formatKey).key
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={`format-${item.id}`}>Format</Label>
      <Select
        id={`format-${item.id}`}
        value={selected}
        disabled={busy}
        onChange={async (event) => {
          setBusy(true)
          try {
            await run(() => setCaseFormatAction(item.id, event.target.value), 'Format updated')
          } finally {
            setBusy(false)
          }
        }}
        className="w-40"
      >
        {formats.map((format) => (
          <option key={format.key} value={format.key}>
            {format.name}
          </option>
        ))}
      </Select>
    </div>
  )
}

/** The research button, or what the run is doing, or why it failed with Try again. */
export function ResearchControl({ item, run }: { item: CaseSummary; run: Run }) {
  const router = useRouter()
  const credits = caseResearchCredits(useFormatSeed(item))
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
        {researchStepLabel(job.current)}
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
  const hasBrief = item.searchBrief !== null

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
        label={failure === null ? researchLabel(hasBrief, credits) : 'Try again'}
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
  channelId,
  blocked,
  item,
  run,
}: {
  slug: string
  channelId: string
  /** Why a project cannot start, or null when it can. */
  blocked: string | null
  item: CaseSummary
  run: Run
}) {
  const router = useRouter()
  const formats = React.useContext(FormatsContext)
  const credits = caseResearchCredits(useFormatSeed(item))
  const [busy, setBusy] = React.useState(false)
  const caseFormat = formats.length > 0 ? resolveFormat(formats, item.formatKey) : null
  const [formatKey, setFormatKey] = React.useState<string | null>(caseFormat?.key ?? null)
  const format = formats.length > 0 && formatKey !== null ? resolveFormat(formats, formatKey) : null
  const [runtimeText, setRuntimeText] = React.useState(String(startRuntime(caseFormat)))
  const [estimate, setEstimate] = React.useState<string | null>(null)
  const minRuntime = format?.runtime.min ?? RUNTIME_OUTER_MIN
  const maxRuntime = Math.min(format?.runtime.max ?? RUNTIME_START_MAX, RUNTIME_START_MAX)
  const runtime = Number(runtimeText)
  const runtimeValid =
    runtimeText.trim() !== '' &&
    Number.isInteger(runtime) &&
    runtime >= minRuntime &&
    runtime <= maxRuntime
  const outOfRange =
    format !== null &&
    (format.runtime.default > RUNTIME_START_MAX || format.runtime.max > RUNTIME_START_MAX)
  const [asking, setAsking] = React.useState(false)
  const brief = item.searchBrief
  // A brief for another subject freezes onto nothing, so its age does not matter.
  const stale = brief !== null && briefMatchesSubject(brief, item.subject) && briefIsStale(brief)

  // A light debounce: the field is typed into, and each stop asks the server once.
  React.useEffect(() => {
    if (!runtimeValid) return
    let current = true
    const timer = setTimeout(() => {
      estimateStartCostAction(channelId, runtime).then(
        (result) => {
          if (current) setEstimate(result?.basis ?? null)
        },
        () => {
          if (current) setEstimate(null)
        },
      )
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [channelId, runtime, runtimeValid])

  const start = async () => {
    setBusy(true)
    try {
      // The format goes only when the owner chose another for this start.
      const result = await startProjectFromCase(
        item.id,
        runtime,
        format !== null && format.key !== caseFormat?.key ? format.key : undefined,
      )
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
          Refresh research (about {credits} credits)
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
    <div className="flex flex-wrap items-center gap-2">
      {formats.length > 1 ? (
        <>
          <Label htmlFor={`start-format-${item.id}`}>Start format</Label>
          <Select
            id={`start-format-${item.id}`}
            value={format?.key ?? ''}
            disabled={busy}
            onChange={(event) => {
              setFormatKey(event.target.value)
              setRuntimeText(String(startRuntime(resolveFormat(formats, event.target.value))))
            }}
            className="w-40"
          >
            {formats.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </Select>
        </>
      ) : null}
      <Label htmlFor={`start-runtime-${item.id}`}>Length in minutes</Label>
      <NumberInput
        id={`start-runtime-${item.id}`}
        value={runtimeText}
        min={minRuntime}
        max={maxRuntime}
        step={1}
        disabled={busy}
        onChange={(event) => setRuntimeText(event.target.value)}
        className="w-24"
      />
      <Button
        variant="primary"
        busy={busy}
        disabled={blocked !== null || !runtimeValid}
        title={blocked ?? undefined}
        onClick={() => (stale ? setAsking(true) : void start())}
      >
        New project
      </Button>
      {runtimeValid ? (
        estimate === null ? null : (
          <p className="w-full text-[13px] text-[var(--color-text-secondary)]">{estimate}</p>
        )
      ) : (
        <p className="w-full text-[13px] text-[var(--color-warning)]">
          This format runs {minRuntime} to {format?.runtime.max ?? RUNTIME_START_MAX} minutes
        </p>
      )}
      {outOfRange ? (
        <p className="w-full text-[13px] text-[var(--color-text-secondary)]">
          {NOT_SUPPORTED_NOTE}
        </p>
      ) : null}
    </div>
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
export function SearchBriefPanel({
  item,
  run,
  pillars = [],
}: {
  item: CaseSummary
  run: Run
  /** The channel's pillars, so a fit that names another one can say its label. */
  pillars?: readonly { key: string; label: string }[]
}) {
  const brief = item.searchBrief
  const [writing, setWriting] = React.useState(false)
  const [own, setOwn] = React.useState(item.angle ?? '')
  const [busy, setBusy] = React.useState(false)
  // The chooser in flight; the others wait so a double click sends once.
  const [pending, setPending] = React.useState<string | null>(null)
  if (brief === null) return null

  const choose = async (
    key: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) => {
    if (pending !== null) return
    setPending(key)
    try {
      await run(action, success)
    } finally {
      setPending(null)
    }
  }

  const current = briefMatchesSubject(brief, item.subject)
  const fit = fitWarning(brief.fit, item.category, pillars)

  return (
    <div className="flex w-full flex-col gap-2">
      {fit ? (
        <p role="status" className="text-[13px] text-[var(--color-warning)]">
          {fit}
        </p>
      ) : null}
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
                        busy={pending === `target:${keyword.keyword}`}
                        disabled={pending !== null}
                        onClick={() =>
                          void choose(
                            `target:${keyword.keyword}`,
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
                      {option.keyword === '' ? '' : `Searched as ${option.keyword}. `}
                      {option.gap}
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
                          busy={pending === `angle:${at}`}
                          disabled={pending !== null}
                          onClick={() =>
                            void choose(
                              `angle:${at}`,
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
