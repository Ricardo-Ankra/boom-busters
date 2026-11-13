'use client'

import type { CaseSummary } from '@boom-busters/db'
import {
  briefIsStale,
  caseResearchCredits,
  exactPhrases,
  caseResearchJobIsRunning,
  leadKeyword,
  resolveFormat,
  RUNTIME_OUTER_MAX,
  RUNTIME_OUTER_MIN,
} from '@boom-busters/schemas'
import type { ChannelFormat, SearchBrief } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Label, NumberInput, Select } from '@/components/ui/input'
import { channelHref } from '@/lib/channel-href'
import {
  caseResearchEstimate,
  estimateStartCostAction,
  researchCaseAction,
  setCaseFormatAction,
  startProjectFromCase,
} from './actions'
import type { CaseResearchEstimate } from './actions'
import { researchStepLabel } from './research-steps'

/**
 * What the case panel shows of its VidIQ research and start controls: the
 * `Research with VidIQ` control, the `Format` picker, and the `New project`
 * button that asks first when the brief has gone stale. The Angle and Search
 * demand sections live in `angle-section.tsx` and `search-demand-section.tsx`.
 */

export type Run = (
  action: () => Promise<{ ok: boolean; error?: string }>,
  /** The success toast; a function is read after the action, so it can say what the result was. */
  success: string | (() => string),
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

/** The channel's current formats, for the picker and the estimate; empty reads as no formats. */
export const FormatsContext = React.createContext<readonly ChannelFormat[]>([])

/** Whether the case's format, resolved against the current bible, has a lead keyword to search. */
function useFormatSeed(item: CaseSummary): boolean {
  const formats = React.useContext(FormatsContext)
  return formats.length > 0 && leadKeyword(resolveFormat(formats, item.formatKey)) !== null
}

/** The length a format starts at: its default, kept inside its own range. */
function startRuntime(format: ChannelFormat | null): number {
  if (format === null) return 15
  return Math.min(Math.max(format.runtime.default, format.runtime.min), format.runtime.max)
}

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
  const credits = caseResearchCredits({
    formatSeed: useFormatSeed(item),
    people: item.people.length,
    exactPhrases: exactPhrases(item.subject ?? '', item.seedKeywords).length,
  })
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
  const credits = caseResearchCredits({
    formatSeed: useFormatSeed(item),
    people: item.people.length,
    exactPhrases: exactPhrases(item.subject ?? '', item.seedKeywords).length,
  })
  const [busy, setBusy] = React.useState(false)
  const caseFormat = formats.length > 0 ? resolveFormat(formats, item.formatKey) : null
  const [formatKey, setFormatKey] = React.useState<string | null>(caseFormat?.key ?? null)
  const format = formats.length > 0 && formatKey !== null ? resolveFormat(formats, formatKey) : null
  const [runtimeText, setRuntimeText] = React.useState(String(startRuntime(caseFormat)))
  // The row's own picker changed the case's format: the start control follows it.
  const [seenCaseKey, setSeenCaseKey] = React.useState(caseFormat?.key ?? null)
  if ((caseFormat?.key ?? null) !== seenCaseKey) {
    setSeenCaseKey(caseFormat?.key ?? null)
    setFormatKey(caseFormat?.key ?? null)
    setRuntimeText(String(startRuntime(caseFormat)))
  }
  const [estimate, setEstimate] = React.useState<string | null>(null)
  const minRuntime = format?.runtime.min ?? RUNTIME_OUTER_MIN
  const maxRuntime = format?.runtime.max ?? RUNTIME_OUTER_MAX
  const runtime = Number(runtimeText)
  const runtimeValid =
    runtimeText.trim() !== '' &&
    Number.isInteger(runtime) &&
    runtime >= minRuntime &&
    runtime <= maxRuntime
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
          This format runs {minRuntime} to {maxRuntime} minutes
        </p>
      )}
      {/* A warning only: the brief's keywords were measured for another format's lead keyword. */}
      {brief?.formatKey && format !== null && brief.formatKey !== format.key ? (
        <p className="w-full text-[13px] text-[var(--color-text-secondary)]">
          Researched for the{' '}
          {formats.find((f) => f.key === brief.formatKey)?.name ?? brief.formatKey} format.
        </p>
      ) : null}
    </div>
  )
}
