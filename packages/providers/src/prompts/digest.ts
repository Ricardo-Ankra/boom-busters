import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The Monday digest (build spec section 7.2 item 9): the analytics-runner
 * computes the week's numbers in code — deltas between snapshots, never a
 * model's arithmetic — and the `digest`-routed model only NARRATES them.
 * The output is the body of one plain-text email.
 */

export interface DigestLine {
  label: string
  targetType: 'master' | 'short'
  /** Lifetime views at the end of the week. */
  views: number | null
  /** Views gained across the week, when both endpoints exist. */
  viewsDelta: number | null
  avgViewDurationSec: number | null
  /** The traffic source that brought the most views. */
  topSource: string | null
  /** Where the retention curve dips hardest, as a percent through the video. */
  worstDropPct: number | null
}

export function buildDigestRequest(input: {
  weekOf: string
  lines: readonly DigestLine[]
}): LLMTaskRequest {
  const table = input.lines
    .map((line) =>
      [
        `- ${line.label} (${line.targetType})`,
        `views ${line.views ?? 'n/a'}`,
        `+${line.viewsDelta ?? 'n/a'} this week`,
        `avg view ${line.avgViewDurationSec ?? 'n/a'}s`,
        `top source ${line.topSource ?? 'n/a'}`,
        line.worstDropPct === null ? null : `retention dips at ${line.worstDropPct}%`,
      ]
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n')

  return {
    task: 'digest',
    system: `You write the Monday production digest for a one-person YouTube
channel about corporate collapses. You are given this week's numbers,
already computed. Write the body of a short plain-text email: 3 to 6
sentences, then the numbers back as a compact list. Name what changed and
the single most useful thing to look at. Never invent a number that is not
in the list; never soften a decline. No markdown, no greeting, no sign-off.`,
    messages: [{ role: 'user', content: `Week of ${input.weekOf}:\n\n${table}` }],
    maxTokens: outputBudget(700),
  }
}

/** Deterministic stand-in for `MOCK_PROVIDERS=1`. */
export function mockDigest(input: { weekOf: string; lines: readonly DigestLine[] }): string {
  const total = input.lines.reduce((sum, line) => sum + (line.viewsDelta ?? 0), 0)
  return (
    `[mock] Week of ${input.weekOf}: ${input.lines.length} video(s) tracked, ` +
    `${total} views gained.\n\n` +
    input.lines.map((line) => `- ${line.label}: ${line.views ?? 'n/a'} views`).join('\n')
  )
}
