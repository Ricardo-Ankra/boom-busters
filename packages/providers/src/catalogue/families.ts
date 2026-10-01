import type { LlmProvider } from '@boom-busters/schemas'

/**
 * Which priced model a live-only id stands in for (decision 287).
 *
 * List endpoints return no prices, and an unpriced model would walk through
 * every budget cap. A new id that plainly belongs to a known line is charged
 * at that line's representative: a catalogued model named here, never the
 * first match in a list, because the image catalogue is ordered default
 * first (2.5 Flash, unsized, $0.04) rather than best first.
 *
 * Patterns are tried top to bottom and the first match wins. An id matching
 * none has no family on purpose: `claude-fable-5-1` costs twice any Opus, so
 * any guess would underprice it and it must be priced by hand.
 *
 * This file imports no adapter, so the adapters can import it.
 */

export interface Family {
  family: string
  /** A catalogued id whose price, tier and request flags the family inherits. */
  representative: string
}

interface FamilyRule extends Family {
  matches: (id: string) => boolean
}

const LLM_FAMILIES: Record<LlmProvider, readonly FamilyRule[]> = {
  anthropic: [
    {
      family: 'opus',
      matches: (id) => id.startsWith('claude-opus-'),
      representative: 'claude-opus-5',
    },
    {
      family: 'sonnet',
      matches: (id) => id.startsWith('claude-sonnet-'),
      representative: 'claude-sonnet-5',
    },
    {
      family: 'haiku',
      matches: (id) => id.startsWith('claude-haiku-'),
      representative: 'claude-haiku-4-5-20251001',
    },
  ],
  openai: [
    {
      family: 'gpt-5-mini',
      matches: (id) => id.startsWith('gpt-5') && id.includes('-mini'),
      representative: 'gpt-5-mini',
    },
    {
      family: 'gpt-5',
      matches: (id) => id.startsWith('gpt-5') && !id.includes('-mini') && !id.includes('-nano'),
      representative: 'gpt-5',
    },
  ],
  google: [
    {
      family: 'flash-lite',
      matches: (id) => id.includes('-flash-lite'),
      representative: 'gemini-3.5-flash-lite',
    },
    {
      family: 'flash',
      matches: (id) => id.includes('-flash'),
      representative: 'gemini-3.6-flash',
    },
    {
      family: 'pro',
      matches: (id) => id.includes('-pro'),
      representative: 'gemini-pro-latest',
    },
  ],
}

const GEMINI_IMAGE_FAMILIES: readonly FamilyRule[] = [
  {
    family: 'pro-image',
    matches: (id) => id.includes('-pro-image'),
    representative: 'gemini-3-pro-image',
  },
  {
    family: 'flash-image',
    matches: (id) => id.includes('-flash-image'),
    representative: 'gemini-3.1-flash-image',
  },
]

function first(rules: readonly FamilyRule[], id: string): Family | undefined {
  const rule = rules.find((candidate) => candidate.matches(id))
  return rule ? { family: rule.family, representative: rule.representative } : undefined
}

export function llmFamily(provider: LlmProvider, id: string): Family | undefined {
  return first(LLM_FAMILIES[provider], id)
}

export function geminiImageFamily(id: string): Family | undefined {
  return first(GEMINI_IMAGE_FAMILIES, id)
}

/** For the test that pins every representative to a catalogued id. */
export const FAMILY_REPRESENTATIVES = {
  llm: Object.fromEntries(
    Object.entries(LLM_FAMILIES).map(([provider, rules]) => [
      provider,
      rules.map((rule) => rule.representative),
    ]),
  ) as Record<LlmProvider, string[]>,
  geminiImage: GEMINI_IMAGE_FAMILIES.map((rule) => rule.representative),
}
