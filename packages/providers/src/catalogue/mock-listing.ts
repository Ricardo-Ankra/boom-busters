import { LLM_MODELS } from '../llm/registry'
import { FAL_MODELS } from '../visuals/fal'
import { GEMINI_IMAGE_MODELS } from '../visuals/gemini'
import type { CatalogueProvider, ListedModel } from './types'

/**
 * The lists `MOCK_PROVIDERS=1` refreshes from (decision 288): every
 * catalogued model, plus live-only ones that exercise each label without a
 * network: a family match, a family-less model, a live Gemini image model,
 * and a priced fal endpoint.
 */

const base = {
  preview: false,
  contextTokens: null,
  maxOutputTokens: null,
  dialect: null,
  pricePerImage: null,
}

const llm = (
  provider: 'anthropic' | 'openai' | 'google',
  id: string,
  label: string,
): ListedModel => ({
  ...base,
  provider,
  id,
  label,
  kind: 'llm',
})

export const MOCK_LIVE_MODEL_IDS = {
  anthropicFamily: 'claude-opus-mock-9',
  anthropicUnpriced: 'claude-mock-unpriced',
  openaiFamily: 'gpt-5-mock',
  googleFamily: 'gemini-9-flash',
  googleImage: 'gemini-9-flash-image',
  falPriced: 'fal-ai/mock-flux',
} as const

export function mockListedModels(provider: CatalogueProvider): ListedModel[] {
  switch (provider) {
    case 'anthropic':
      return [
        ...LLM_MODELS.anthropic.map((m) => llm('anthropic', m.id, m.label)),
        llm('anthropic', MOCK_LIVE_MODEL_IDS.anthropicFamily, 'Claude Opus Mock 9'),
        llm('anthropic', MOCK_LIVE_MODEL_IDS.anthropicUnpriced, 'Claude Mock Unpriced'),
      ]
    case 'openai':
      return [
        ...LLM_MODELS.openai.map((m) => llm('openai', m.id, m.label)),
        llm('openai', MOCK_LIVE_MODEL_IDS.openaiFamily, 'gpt-5-mock'),
      ]
    case 'google':
      return [
        ...LLM_MODELS.google.map((m) => llm('google', m.id, m.label)),
        llm('google', MOCK_LIVE_MODEL_IDS.googleFamily, 'Gemini 9 Flash (mock)'),
        ...GEMINI_IMAGE_MODELS.map((m) => ({
          ...base,
          provider: 'google' as const,
          id: m.id,
          label: m.label,
          kind: 'image' as const,
        })),
        {
          ...base,
          provider: 'google',
          id: MOCK_LIVE_MODEL_IDS.googleImage,
          label: 'Gemini 9 Flash Image (mock)',
          kind: 'image',
        },
      ]
    case 'fal':
      return [
        ...FAL_MODELS.map((m) => ({
          ...base,
          provider: 'fal' as const,
          id: m.id,
          label: m.label,
          kind: 'image' as const,
          dialect: m.dialect ?? 'flux',
          pricePerImage: m.pricePerImage,
        })),
        {
          ...base,
          provider: 'fal',
          id: MOCK_LIVE_MODEL_IDS.falPriced,
          label: 'Mock FLUX',
          kind: 'image',
          dialect: 'flux',
          pricePerImage: 0.02,
        },
      ]
  }
}
