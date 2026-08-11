import { CaseSuggestionsSchema } from '@boom-busters/schemas'
import type { CaseSuggestion } from '@boom-busters/schemas'
import { parseJsonCompletion } from './json'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The `Suggest cases` prompt (spec section 11.3).
 *
 * Routed at the `research` task, so it uses whatever Settings → Models points
 * research at. The alternative was adding a seventh task to the routing
 * matrix, but section 4 fixes the six, and proposing real cases with demand
 * evidence is research work by any reading.
 */

export interface SuggestCasesInput {
  /** Titles already in the library, so the model does not re-propose them. */
  existingTitles: readonly string[]
  count: number
  /** Optional steer from the human: "1990s", "aviation", "nothing US-centric". */
  steer?: string
}

const SYSTEM = `You propose case studies for a YouTube channel about corporate
collapses, frauds, meltdowns and turnarounds.

A good case has: a documented paper trail (court filings, regulator actions,
major-outlet reporting), a clear turn where the story changes, and consequences
that can be shown rather than described. A bad case is one where the only
sources are other YouTube videos, or where the interesting part is speculation
about what someone was thinking.

Rules:
- Only real, documented events. Never invent a company, a person or a figure.
- Prefer cases with primary sources available: filings, judgments, inquiries.
- The angle must say what THIS telling does that existing coverage does not.
- priorityScore is 0-100: how strongly you would recommend making it next,
  weighing documentation quality, story shape and evident audience demand.

Answer with JSON only, no prose around it:
{"suggestions": [{"title": string, "category": "collapse"|"con"|"meltdown"|"turnaround"|"empire",
  "angle": string, "demandNotes": string, "competitorLinks": [{"url": string, "note": string}],
  "priorityScore": number}]}`

export function buildSuggestCasesRequest(input: SuggestCasesInput): LLMTaskRequest {
  const avoid =
    input.existingTitles.length > 0
      ? `\n\nAlready in the library — do not propose these again:\n${input.existingTitles
          .map((title) => `- ${title}`)
          .join('\n')}`
      : ''

  const steer = input.steer?.trim() ? `\n\nThe human asks specifically for: ${input.steer.trim()}` : ''

  return {
    task: 'research',
    system: SYSTEM,
    messages: [{ role: 'user', content: `Propose ${input.count} cases.${steer}${avoid}` }],
    // Roughly 250 output tokens per suggestion with headroom; a truncated
    // answer is a parse failure, and re-running research is the expensive
    // kind of retry.
    maxTokens: Math.min(8000, 400 * input.count + 500),
  }
}

export function parseSuggestedCases(text: string): CaseSuggestion[] {
  return parseJsonCompletion(text, CaseSuggestionsSchema, 'case suggestions').suggestions
}

/**
 * Deterministic mock output for `MOCK_PROVIDERS=1`.
 *
 * Real-looking case titles would be dangerous here: mock suggestions get
 * accepted into the library during a demo, then researched for real weeks
 * later by someone who has forgotten where they came from. Every mock case
 * says what it is in its own title.
 */
export function mockSuggestedCases(count: number): CaseSuggestion[] {
  const categories = ['collapse', 'con', 'meltdown', 'turnaround', 'empire'] as const

  return Array.from({ length: count }, (_, index) => ({
    title: `[mock suggestion ${index + 1}] not a real case`,
    category: categories[index % categories.length]!,
    angle:
      'Placeholder produced in mock-provider mode. Nothing was researched and ' +
      'no provider was called. Dismiss this row.',
    demandNotes: 'No demand evidence exists for a case that does not exist.',
    competitorLinks: [],
    // Descending so the sort-by-priority column has something to sort.
    priorityScore: Math.max(0, 50 - index * 3),
  }))
}
