import type { CaseSummary } from '@boom-busters/db'
import { angleIsChosen, caseResearchJobIsRunning } from '@boom-busters/schemas'
import { researchStepLabel } from './research-steps'

/** The Case Library's small pure helpers: the next-step strip, the list row signal and score words. */

export type StepState = 'done' | 'current' | 'todo'

type StepLabel = 'Researched' | 'Angle chosen' | 'Start a project'

/** Three steps and one sentence on what comes next; the first step not done is the current one. */
export function caseProgress(item: CaseSummary): {
  steps: { label: StepLabel; state: StepState }[]
  next: string
} {
  const brief = item.searchBrief
  const chosen = brief !== null && angleIsChosen(brief)
  const projectStarted =
    item.projectCount > 0 || item.status === 'in_production' || item.status === 'published'

  const done: [StepLabel, boolean][] = [
    ['Researched', brief !== null],
    ['Angle chosen', chosen],
    ['Start a project', projectStarted],
  ]
  // A retired or finished case has nothing live to do, so no step is current.
  const live = item.status !== 'retired' && !projectStarted
  const currentAt = live ? done.findIndex(([, isDone]) => !isDone) : -1
  const steps = done.map(([label, isDone], i) => ({
    label,
    state: isDone ? ('done' as const) : i === currentAt ? ('current' as const) : ('todo' as const),
  }))

  return { steps, next: nextSentence(item, chosen, projectStarted) }
}

function nextSentence(item: CaseSummary, chosen: boolean, projectStarted: boolean): string {
  if (item.status === 'retired') return 'Retired'
  if (projectStarted) return 'Nothing waiting on you here'
  if (!item.subject || item.subject.trim() === '') {
    return 'Next: give the case a subject, then research it'
  }
  if (item.searchBrief === null) return 'Next: research the subject with VidIQ'
  if (!chosen) return 'Next: choose an angle'
  if (item.status === 'shortlisted') return 'Next: start a project from the chosen angle'
  return 'Next: shortlist the case to start a project'
}

/** What a list row shows beside the title: the searched keyword and an angle signal. */
export function listSignal(item: CaseSummary): {
  keyword: string | null
  angle: { text: string; tone: 'success' | 'warning' | 'muted' } | null
} {
  const brief = item.searchBrief
  const keyword = brief?.targetKeyword?.keyword ?? null
  const job = item.searchJob
  if (job !== null && job.state === 'running' && caseResearchJobIsRunning(job)) {
    return { keyword, angle: { text: researchStepLabel(job.current), tone: 'muted' } }
  }
  if (brief === null) return { keyword, angle: { text: 'Not researched', tone: 'muted' } }
  if (angleIsChosen(brief)) return { keyword, angle: { text: 'Angle chosen', tone: 'success' } }
  const n = brief.angleOptions.length
  if (n === 0) return { keyword, angle: null }
  return {
    keyword,
    angle: { text: `${n} ${n === 1 ? 'angle' : 'angles'}, pick one`, tone: 'warning' },
  }
}

/** A 0 to 100 VidIQ score as a word: 0 to 33 low, 34 to 66 medium (volume: moderate), 67 up high. */
export function scoreWord(value: number, kind: 'competition' | 'volume'): string {
  if (value <= 33) return 'low'
  if (value <= 66) return kind === 'volume' ? 'moderate' : 'medium'
  return 'high'
}

/**
 * The open case: the one the URL names when it is in the list, else the first
 * backlog case, else the first suggestion. `explicit` is true only for the
 * first, so a phone shows the list until the owner picks a case.
 */
export function resolveSelected(
  cases: readonly Pick<CaseSummary, 'id' | 'status'>[],
  param: string | undefined,
): { selectedId: string | null; explicit: boolean } {
  if (param !== undefined && cases.some((item) => item.id === param)) {
    return { selectedId: param, explicit: true }
  }
  const fallback = cases.find((item) => item.status !== 'idea') ?? cases[0] ?? null
  return { selectedId: fallback?.id ?? null, explicit: false }
}

/** The status words the list, the panel and the status select share. */
export const STATUS_LABELS: Record<string, string> = {
  idea: 'Suggested',
  shortlisted: 'Shortlisted',
  in_production: 'In production',
  published: 'Published',
  retired: 'Retired',
}

/** An ISO date as the owner reads it: 20 October 2026. */
export const measuredOn = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
