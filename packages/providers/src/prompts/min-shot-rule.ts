import { MIN_SHOT_SECONDS, minShotSeconds } from '@boom-busters/schemas'

/**
 * The planning-rules line for the per-type minimum on-screen time (the stretch
 * re-plan design). Built from `MIN_SHOT_SECONDS`, grouped by seconds, so a
 * change to the constant changes what the planner is told. The format's shot
 * hold multiplies every number; at 1 the text is the same as ever. Lives apart from
 * `stretch.ts` so the chapter's planning rules and the stretch request can
 * both read it without importing each other.
 */
export function minShotRule(shotHold = 1): string {
  const byTime = new Map<number, string[]>()
  for (const type of Object.keys(MIN_SHOT_SECONDS) as (keyof typeof MIN_SHOT_SECONDS)[]) {
    const seconds = minShotSeconds(type, shotHold)
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
