import { MIN_SHOT_SECONDS } from '@boom-busters/schemas'

/**
 * The planning-rules line for the per-type minimum on-screen time (the stretch
 * re-plan design). Built from `MIN_SHOT_SECONDS`, grouped by seconds, so a
 * change to the constant changes what the planner is told. Lives apart from
 * `stretch.ts` so the chapter's planning rules and the stretch request can
 * both read it without importing each other.
 */
function minShotRule(): string {
  const byTime = new Map<number, string[]>()
  for (const [type, seconds] of Object.entries(MIN_SHOT_SECONDS)) {
    byTime.set(seconds, [...(byTime.get(seconds) ?? []), type])
  }
  const groups = [...byTime.entries()].sort(([a], [b]) => b - a)
  const parts = groups.map(([seconds, types], at) => {
    if (groups.length > 1 && at === groups.length - 1) return `every other type ${seconds}`
    const names = types.join(' and ')
    return at === 0 ? `${names} ${seconds} seconds` : `${names} ${seconds}`
  })
  return `- Once timed, a slot must stay on screen at least: ${parts.join(', ')}.`
}

export const MIN_SHOT_RULE = minShotRule()
