import { CaseBriefSchema, ClaimsSchema, ResearchTimelineSchema } from '@boom-busters/schemas'
import type { CaseBrief, DraftClaim, TimelineEvent } from '@boom-busters/schemas'
import { parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The dossier-runner's three research passes (build spec section 7.1):
 * case brief → timeline of events → claims extraction with sources.
 *
 * Three passes rather than one, for a reason that survives contact with real
 * output: asking for a brief, a timeline and forty sourced claims in a single
 * completion reliably produces a good brief and a lazy claims list. Each pass
 * also becomes its own `step.run()`, so a failure in claims extraction does not
 * re-run and re-charge the brief.
 */

const HOUSE_RULES = `You research corporate collapses, frauds and meltdowns for
a documentary channel. Real companies and living people are the subject, so:

- Never state as fact anything you cannot attribute to a source.
- Distinguish what a court or regulator FOUND from what was ALLEGED or reported.
- Where you are unsure, say so. An open question is useful; a confident
  invention is a liability.
- Never invent a URL, and never give a search-engine link. Attribute at the
  most specific level you are CERTAIN is real: the exact article if you know
  it, otherwise the publication's or regulator's own site or topic page —
  "https://www.ft.com/wirecard", "https://www.bafin.de/". A reviewer checking
  the claim starts from that link. Omit sourceUrl only when you cannot even
  name where it was reported.

Answer with JSON only, no prose around it.`

export interface CaseContext {
  title: string
  category: string
  angle?: string | null
  demandNotes?: string | null
}

function caseHeader(input: CaseContext): string {
  return [
    `Case: ${input.title}`,
    `Category: ${input.category}`,
    input.angle ? `Angle to pursue: ${input.angle}` : null,
    input.demandNotes ? `Audience notes: ${input.demandNotes}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Pass 1 — the brief
// ---------------------------------------------------------------------------

export function buildBriefRequest(input: CaseContext): LLMTaskRequest {
  return {
    task: 'research',
    system: `${HOUSE_RULES}

Produce a case brief:
{"summary": string, "turningPoint": string,
 "principals": [{"name": string, "role": string}],
 "openQuestions": [string]}`,
    messages: [{ role: 'user', content: `${caseHeader(input)}\n\nWrite the brief.` }],
    maxTokens: outputBudget(3000),
  }
}

export function parseBrief(text: string): CaseBrief {
  return parseJsonCompletion(text, CaseBriefSchema, 'case brief')
}

// ---------------------------------------------------------------------------
// Pass 2 — the timeline
// ---------------------------------------------------------------------------

export function buildTimelineRequest(input: CaseContext, brief: CaseBrief): LLMTaskRequest {
  return {
    task: 'research',
    system: `${HOUSE_RULES}

Produce a timeline of what happened, in order:
{"events": [{"when": string, "what": string, "sourceUrl": string}]}

"when" may be imprecise where the record is ("late 2019", "March 2001").
Include the events that make the turning point make sense, not every event.`,
    messages: [
      { role: 'user', content: caseHeader(input) },
      { role: 'assistant', content: JSON.stringify(brief) },
      { role: 'user', content: 'Now the timeline.' },
    ],
    // The case header is identical across all three passes in a run, so it is
    // worth caching where the provider supports it.
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(6000),
  }
}

export function parseTimeline(text: string): TimelineEvent[] {
  return parseJsonCompletion(text, ResearchTimelineSchema, 'timeline').events
}

// ---------------------------------------------------------------------------
// Pass 3 — the claims
// ---------------------------------------------------------------------------

export function buildClaimsRequest(
  input: CaseContext,
  brief: CaseBrief,
  timeline: readonly TimelineEvent[],
): LLMTaskRequest {
  return {
    task: 'research',
    system: `${HOUSE_RULES}

Extract every factual claim the script will need, each with its source:
{"claims": [{"text": string, "sourceUrl": string,
  "sourceType": "court"|"regulator"|"major_outlet"|"book"|"other",
  "confidence": "sourced"|"single_source"|"unverified",
  "adjudicated": boolean}]}

- Confidence is about the record, not about links. "sourced" means two or more
  independent sources report it; "single_source" means one; "unverified" means
  you cannot say who reported it. Do NOT downgrade a claim to unverified just
  because you lack the exact article URL — name the outlet in sourceType and
  point sourceUrl at its site.
- EVERY claim carries the best real sourceUrl you have, including low-confidence
  ones: an unverified claim with a starting point is checkable; one without a
  URL blocks the whole dossier until a human sources it from nothing.
- "adjudicated" is true ONLY where a court or regulator formally ruled. It is
  what decides whether the script must say "alleged", so do not guess it.
- Figures, dates and quotes each need their own claim. A claim a human cannot
  check against your source is worse than no claim.`,
    messages: [
      { role: 'user', content: caseHeader(input) },
      { role: 'assistant', content: JSON.stringify({ brief, timeline }) },
      { role: 'user', content: 'Now the claims.' },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(8000),
  }
}

export function parseClaims(text: string): DraftClaim[] {
  return parseJsonCompletion(text, ClaimsSchema, 'claims').claims
}

// ---------------------------------------------------------------------------
// The dossier document
// ---------------------------------------------------------------------------

/**
 * Render the three passes into the markdown the review screen shows.
 *
 * A pure function rather than a fourth model call: the dossier document is a
 * presentation of research already done, and paying a model to reformat data
 * it just produced would add cost, latency and an opportunity to hallucinate
 * between the claims table and the document beside it.
 */
export function renderDossierMarkdown(input: {
  caseTitle: string
  brief: CaseBrief
  timeline: readonly TimelineEvent[]
  claims: readonly DraftClaim[]
}): string {
  const lines: string[] = [`# ${input.caseTitle}`, '', '## Summary', '', input.brief.summary, '']

  lines.push('## The turn', '', input.brief.turningPoint, '')

  if (input.brief.principals.length > 0) {
    lines.push('## Principals', '')
    for (const person of input.brief.principals) {
      lines.push(`- **${person.name}** — ${person.role}`)
    }
    lines.push('')
  }

  lines.push('## Timeline', '')
  for (const event of input.timeline) {
    lines.push(
      `- **${event.when}** — ${event.what}${event.sourceUrl ? ` ([source](${event.sourceUrl}))` : ''}`,
    )
  }
  lines.push('')

  if (input.brief.openQuestions.length > 0) {
    // Deliberately in the document, not only in a side panel. What the
    // research could not establish is the part most likely to be written
    // around confidently if nobody sees it.
    lines.push('## Open questions', '')
    for (const question of input.brief.openQuestions) lines.push(`- ${question}`)
    lines.push('')
  }

  const unverified = input.claims.filter((claim) => claim.confidence === 'unverified')
  if (unverified.length > 0) {
    lines.push(
      '## Unverified',
      '',
      `${unverified.length} claim(s) could not be attributed to a source. They are excluded ` +
        'from scripting until you verify or quarantine them.',
      '',
    )
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/**
 * Deterministic mock research. Says loudly that it researched nothing, for the
 * same reason the mock case suggestions do: a dossier that reads plausibly is
 * one somebody will eventually approve by accident.
 */
export function mockBrief(input: CaseContext): CaseBrief {
  return {
    summary:
      `MOCK DOSSIER for "${input.title}". No research was performed and no provider was ` +
      'called. Every statement below is placeholder text generated locally. Do not approve ' +
      'this dossier expecting it to describe anything that happened.',
    turningPoint: 'The mock turning point, which is that this is not a real dossier.',
    principals: [{ name: 'Placeholder Name', role: 'placeholder role' }],
    openQuestions: ['Everything. Nothing here was researched.'],
  }
}

export function mockTimeline(): TimelineEvent[] {
  return [
    { when: 'Mock date 1', what: 'A placeholder event that did not happen.' },
    { when: 'Mock date 2', what: 'A second placeholder event that also did not happen.' },
  ]
}

export function mockClaims(): DraftClaim[] {
  return [
    {
      text: 'This is a mock claim with no source, produced without calling a provider.',
      sourceType: 'other',
      confidence: 'unverified',
      adjudicated: false,
    },
    {
      text: 'A second mock claim, also unsourced and also not a fact about anything.',
      sourceType: 'other',
      confidence: 'unverified',
      adjudicated: false,
    },
  ]
}
