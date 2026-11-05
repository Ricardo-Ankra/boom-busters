import { classifySearchTerms } from './search-terms'
import {
  type FieldCheck,
  type FieldResult,
  type SearchBrief,
  type SearchKeyword,
} from './search-brief'

/** An open door: a channel under this many subscribers... */
export const OPEN_DOOR_MAX_SUBSCRIBERS = 100_000
/** ...whose video has at least this many views. Ranking alone is not winnability. */
export const OPEN_DOOR_MIN_VIEWS = 10_000
/** A field is stale when STALE_MIN of its results are STALE_YEARS or more old. */
export const STALE_YEARS = 3
export const STALE_MIN = 6
/** A Short runs 60 seconds or less. */
export const SHORT_MAX_SECONDS = 60
export const SHORTS_BAD = 6
export const DEMAND_OK = 5_000
export const DEMAND_WARN = 1_000
/** Growth at or above this percentage reads as a news spike. */
export const SPIKE_GROWTH = 200

export type VerdictCheck = 'intent' | 'angle' | 'fit' | 'demand' | 'competition'
export type VerdictState = 'ok' | 'warn' | 'bad'
export interface VerdictLine {
  check: VerdictCheck
  state: VerdictState
  reason: string
}

const keyOf = (term: string) => term.trim().toLowerCase()

/** The brief carries intent, fit or field data, so it came from the full checks. */
export function briefHasFullChecks(brief: SearchBrief): boolean {
  const rows = [...(brief.targetKeyword ? [brief.targetKeyword] : []), ...brief.secondaryKeywords]
  return rows.some((r) => r.fit !== undefined) || brief.fieldChecks !== undefined
}

/**
 * Monthly searches added up over the target's topic: target and secondary
 * rows whose topic matches, that are keywords (figure rows count, titles and
 * other languages do not) and whose fit is not `off`. Growth is the target's.
 * A target with no topic stands alone. Searches stay null when no row has one.
 */
export function topicDemand(brief: SearchBrief): {
  topic: string | null
  searches: number | null
  growth: number | null
} {
  const target = brief.targetKeyword
  if (target === null) return { topic: null, searches: null, growth: null }
  const topic = target.topic ?? null
  const rows: SearchKeyword[] = [target, ...brief.secondaryKeywords]
  const kinds = classifySearchTerms(
    rows.map((r) => r.keyword),
    { language: brief.language },
  )
  const counted =
    topic === null
      ? [target]
      : rows.filter(
          (r) =>
            // The target always counts: intent already flags an off target, demand still shows it.
            r === target ||
            (r.topic === topic && r.fit !== 'off' && kinds.get(keyOf(r.keyword)) === 'keyword'),
        )
  let searches: number | null = null
  for (const r of counted) {
    if (r.estimatedMonthlySearch !== null) searches = (searches ?? 0) + r.estimatedMonthlySearch
  }
  return { topic, searches, growth: target.growthPct }
}

function isOpenDoor(r: FieldResult): boolean {
  return (
    r.subscribers !== null &&
    r.views !== null &&
    r.subscribers < OPEN_DOOR_MAX_SUBSCRIBERS &&
    r.views >= OPEN_DOOR_MIN_VIEWS
  )
}

export function openDoors(check: FieldCheck): number {
  return check.results.filter(isOpenDoor).length
}

/** Six or more of the results published three or more years before `now`; unknown dates do not count. */
export function isStaleField(check: FieldCheck, now: Date): boolean {
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - STALE_YEARS)
  const old = check.results.filter((r) => {
    const at = r.publishedAt === null ? Number.NaN : Date.parse(r.publishedAt)
    return at <= cutoff.getTime()
  })
  return old.length >= STALE_MIN
}

export function shortCount(check: FieldCheck): number {
  return check.results.filter((r) => r.seconds !== null && r.seconds <= SHORT_MAX_SECONDS).length
}

/**
 * The Competition rule for one field check. Staleness is judged against the
 * research date (`checkedAt`), so the verdict does not drift with the viewing
 * date. A check with no results is not a judgement: warn.
 */
export function fieldCompetition(check: FieldCheck): VerdictState {
  if (check.results.length === 0) return 'warn'
  if (shortCount(check) >= SHORTS_BAD) return 'bad'
  const doors = openDoors(check)
  if (doors >= 3) return 'ok'
  if (doors >= 1) return 'warn'
  return isStaleField(check, new Date(check.checkedAt)) ? 'warn' : 'bad'
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const NOT_CHECKED = 'Not checked for this keyword'
const CREDIT_CAP = 'Not checked: credit cap'

const skippedGroup = (brief: SearchBrief, group: string) =>
  (brief.skipped ?? []).some((s) => keyOf(s).startsWith(group) && keyOf(s).includes('credit cap'))

function intentLine(brief: SearchBrief): VerdictLine {
  const target = brief.targetKeyword
  if (target === null)
    return { check: 'intent', state: 'bad', reason: 'No target keyword was picked' }
  const name = `"${target.keyword}"`
  switch (target.fit) {
    case 'fits':
      return {
        check: 'intent',
        state: 'ok',
        reason: `Searchers for ${name} want what this channel makes`,
      }
    case 'partly':
      return {
        check: 'intent',
        state: 'warn',
        reason: `Searchers for ${name} only partly want what this channel makes`,
      }
    case 'off':
      return {
        check: 'intent',
        state: 'bad',
        reason: `Searchers for ${name} want something this channel does not make`,
      }
    default:
      return { check: 'intent', state: 'warn', reason: 'Intent was not measured' }
  }
}

function angleLine(brief: SearchBrief, checkedAngle: number | null): VerdictLine {
  if (brief.angleOptions.length === 0) {
    return { check: 'angle', state: 'bad', reason: 'There are no angles to check' }
  }
  const option = checkedAngle === null ? undefined : brief.angleOptions[checkedAngle]
  const themes = brief.commentThemes ?? []
  const lines = option?.evidence ?? []
  const tests = (brief.nicheTests ?? []).filter(
    (t) => option !== undefined && t.angle === option.angle,
  )
  if (themes.length > 0 && lines.length > 0) {
    return {
      check: 'angle',
      state: 'ok',
      reason: `Viewer comments back this angle (${plural(lines.length, 'supporting line')})`,
    }
  }
  if (tests.some((t) => t.direct)) {
    return {
      check: 'angle',
      state: 'ok',
      reason: 'A niche test found direct evidence for this angle',
    }
  }
  const anyEvidence = themes.length > 0 || (brief.nicheTests ?? []).length > 0
  if (!anyEvidence && (skippedGroup(brief, 'comments') || skippedGroup(brief, 'niche test'))) {
    return { check: 'angle', state: 'warn', reason: CREDIT_CAP }
  }
  const found =
    themes.length > 0
      ? `${plural(themes.length, 'comment theme')} found, none tied to this angle`
      : tests.length > 0
        ? 'The niche test found only indirect evidence'
        : 'No comment themes or niche test evidence for this angle'
  return { check: 'angle', state: 'warn', reason: found }
}

function fitLine(brief: SearchBrief, caseCategory: string | null): VerdictLine {
  const fit = brief.fit
  if (fit === null) return { check: 'fit', state: 'warn', reason: 'Channel fit was not measured' }
  if (!fit.inScope)
    return { check: 'fit', state: 'bad', reason: 'The subject is outside the channel scope' }
  if (fit.pillarKey === null || fit.pillarKey === caseCategory) {
    return { check: 'fit', state: 'ok', reason: 'The subject is in scope for this channel' }
  }
  return {
    check: 'fit',
    state: 'warn',
    reason: `In scope, but it belongs to the ${fit.pillarKey} pillar`,
  }
}

function demandLine(brief: SearchBrief): VerdictLine {
  const { topic, searches, growth } = topicDemand(brief)
  const target = brief.targetKeyword
  if (target === null)
    return { check: 'demand', state: 'bad', reason: 'Demand was not measured: no target keyword' }
  const name = topic ?? `"${target.keyword}"`
  if (searches === null || searches < DEMAND_WARN) {
    return {
      check: 'demand',
      state: 'bad',
      reason:
        searches === null
          ? `Demand for ${name} was not measured`
          : `Only ${searches.toLocaleString('en-US')} searches a month for ${name}`,
    }
  }
  const figure = `${searches.toLocaleString('en-US')} searches a month for ${name}`
  if (growth !== null && growth >= SPIKE_GROWTH) {
    return {
      check: 'demand',
      state: 'warn',
      reason: `${figure}, up ${Math.round(growth)}%: may be a news spike`,
    }
  }
  return { check: 'demand', state: searches >= DEMAND_OK ? 'ok' : 'warn', reason: figure }
}

function competitionLine(brief: SearchBrief): VerdictLine {
  const target = brief.targetKeyword
  const found =
    target === null
      ? undefined
      : (brief.fieldChecks ?? []).find((c) => keyOf(c.keyword) === keyOf(target.keyword))
  if (found === undefined) {
    return {
      check: 'competition',
      state: 'warn',
      reason: skippedGroup(brief, 'field check') ? CREDIT_CAP : NOT_CHECKED,
    }
  }
  if (found.results.length === 0) {
    return {
      check: 'competition',
      state: 'warn',
      reason: `No results came back for "${found.keyword}"`,
    }
  }
  const state = fieldCompetition(found)
  const doors = openDoors(found)
  const shorts = shortCount(found)
  const name = `"${found.keyword}"`
  const reason =
    shorts >= SHORTS_BAD
      ? `${plural(shorts, 'Short')} in the top ${found.results.length} for ${name}`
      : doors > 0
        ? `${plural(doors, 'open door')} in the top ${found.results.length} for ${name}`
        : isStaleField(found, new Date(found.checkedAt))
          ? `No open doors for ${name}, but most of the field is old`
          : `No open doors for ${name} and the field is recent`
  return { check: 'competition', state, reason }
}

/**
 * The five-check verdict, computed on read and never stored. `checkedAngle`
 * is the chosen option index, else the recommended one.
 */
export function briefVerdict(
  brief: SearchBrief,
  context: { caseCategory: string | null; checkedAngle: number | null },
): VerdictLine[] {
  return [
    intentLine(brief),
    angleLine(brief, context.checkedAngle),
    fitLine(brief, context.caseCategory),
    demandLine(brief),
    competitionLine(brief),
  ]
}
